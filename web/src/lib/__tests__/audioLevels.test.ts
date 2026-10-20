import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSilent, levelToPercent, measureLevel, pickLoudestTrack } from '../audioLevels.ts'

const level = (rms: number) => ({ rms, peak: rms })

test('measureLevel reports zero for silence and for no samples', () => {
  assert.deepEqual(measureLevel(new Int16Array(100)), { rms: 0, peak: 0 })
  assert.deepEqual(measureLevel(new Int16Array(0)), { rms: 0, peak: 0 })
})

test('measureLevel normalizes to full scale', () => {
  const half = measureLevel(Int16Array.from([16384, -16384, 16384, -16384]))
  assert.equal(half.rms, 0.5)
  assert.equal(half.peak, 0.5)
  const full = measureLevel(Int16Array.from([-32768, 32767]))
  assert.equal(full.peak, 1)
  assert.ok(full.rms > 0.99 && full.rms <= 1)
})

test('isSilent separates near-silence from real audio', () => {
  assert.equal(isSilent(level(0)), true)
  assert.equal(isSilent(level(0.001)), true)
  assert.equal(isSilent(level(0.01)), false)
})

test('pickLoudestTrack chooses the loudest track, not the first', () => {
  assert.equal(pickLoudestTrack([level(0), level(0.2)]), 1)
  assert.equal(pickLoudestTrack([level(0.3), level(0.05)]), 0)
  assert.equal(pickLoudestTrack([level(0.01), level(0.02), level(0.015)]), 1)
})

test('pickLoudestTrack falls back to the first track when nothing is audible', () => {
  assert.equal(pickLoudestTrack([]), 0)
  assert.equal(pickLoudestTrack([level(0), level(0.0005)]), 0)
})

test('pickLoudestTrack prefers the earlier track on a tie', () => {
  assert.equal(pickLoudestTrack([level(0.1), level(0.1)]), 0)
})

test('levelToPercent maps -60 dBFS..0 dBFS onto 0..100', () => {
  assert.equal(levelToPercent(level(0)), 0)
  assert.equal(levelToPercent(level(0.001)), 0)
  assert.equal(levelToPercent(level(1)), 100)
  assert.equal(levelToPercent(level(0.1)), 67)
})
