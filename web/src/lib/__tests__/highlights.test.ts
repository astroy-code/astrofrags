import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseHighlights, findPeaks, peakRange, rmsPerWindow } from '../highlights.ts'
import type { Peak } from '../highlights.ts'

const close = (actual: number, expected: number, tolerance = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

/** A quiet signal of `count` windows with a spike of `height` at each given window index. */
const withSpikes = (count: number, spikes: Readonly<Record<number, number>>): number[] =>
  Array.from({ length: count }, (_, index) => spikes[index] ?? 1)

test('rmsPerWindow gives one value per 0.1 s and a shorter last window', () => {
  const samples = new Int16Array(8000 * 0.25).fill(16384)
  const windows = rmsPerWindow(samples, 8000)
  assert.equal(windows.length, 3)
  windows.forEach((value) => close(value, 0.5))
})

test('rmsPerWindow of no samples is empty', () => {
  assert.deepEqual(rmsPerWindow(new Int16Array(0), 8000), [])
})

test('findPeaks reports a spike at its window time with its score', () => {
  const peaks = findPeaks(withSpikes(100, { 40: 50 }))
  assert.equal(peaks.length, 1)
  close(peaks[0].time, 4)
  assert.equal(peaks[0].score, 50)
})

test('peaks within 3 s of each other merge into the stronger one', () => {
  const peaks = findPeaks(withSpikes(200, { 50: 40, 70: 60 }))
  assert.equal(peaks.length, 1)
  close(peaks[0].time, 7)
  assert.equal(peaks[0].score, 60)
})

test('peaks more than 3 s apart stay separate, strongest first', () => {
  const peaks = findPeaks(withSpikes(200, { 20: 40, 100: 70 }))
  assert.deepEqual(peaks.map((peak) => peak.score), [70, 40])
  close(peaks[0].time, 10)
  close(peaks[1].time, 2)
})

test('only the 12 strongest peaks are kept', () => {
  const spikes: Record<number, number> = {}
  for (let i = 0; i < 15; i += 1) spikes[20 + i * 50] = 100 + i
  const peaks = findPeaks(withSpikes(900, spikes))
  assert.equal(peaks.length, 12)
  assert.equal(peaks[0].score, 114)
  assert.equal(peaks[11].score, 103)
})

test('a flat signal, an empty one and a single window have no peaks', () => {
  assert.deepEqual(findPeaks(withSpikes(50, {})), [])
  assert.deepEqual(findPeaks([]), [])
  assert.deepEqual(findPeaks([5]), [])
})

test('peakRange pads 5 s before and 3 s after', () => {
  assert.deepEqual(peakRange({ time: 20, score: 1 }, 100), { start: 15, end: 23 })
})

test('peakRange clamps to the start and the end of the recording', () => {
  assert.deepEqual(peakRange({ time: 2, score: 1 }, 100), { start: 0, end: 5 })
  assert.deepEqual(peakRange({ time: 99, score: 1 }, 100), { start: 94, end: 100 })
})

test('peakRange with an unknown duration does not clamp the end', () => {
  assert.deepEqual(peakRange({ time: 20, score: 1 }, 0), { start: 15, end: 23 })
})

const peak = (time: number, score: number): Peak => ({ time, score })

test('chooseHighlights takes the strongest peaks and returns them in time order', () => {
  const chosen = chooseHighlights({ peaks: [peak(10, 1), peak(40, 3), peak(70, 2)], duration: 100, taken: [] })
  assert.deepEqual(chosen.map((item) => item.peak.time), [10, 40, 70])
})

test('chooseHighlights skips a peak whose range overlaps a stronger chosen one', () => {
  const chosen = chooseHighlights({ peaks: [peak(30, 5), peak(34, 4), peak(60, 1)], duration: 100, taken: [] })
  assert.deepEqual(chosen.map((item) => item.peak.time), [30, 60])
})

test('chooseHighlights skips a peak that overlaps a range already in the reel', () => {
  const chosen = chooseHighlights({
    peaks: [peak(30, 5), peak(60, 1)],
    duration: 100,
    taken: [{ start: 28, end: 40 }]
  })
  assert.deepEqual(chosen.map((item) => item.peak.time), [60])
})

test('chooseHighlights stops at the clip limit, keeping the strongest', () => {
  const peaks = Array.from({ length: 10 }, (_, i) => peak(i * 20 + 10, i + 1))
  const chosen = chooseHighlights({ peaks, duration: 300, taken: [], maxClips: 3 })
  assert.deepEqual(chosen.map((item) => item.peak.score), [8, 9, 10])
})

test('chooseHighlights never takes more than 8 by default, and none without peaks', () => {
  const peaks = Array.from({ length: 12 }, (_, i) => peak(i * 20 + 10, i + 1))
  assert.equal(chooseHighlights({ peaks, duration: 300, taken: [] }).length, 8)
  assert.deepEqual(chooseHighlights({ peaks: [], duration: 300, taken: [] }), [])
})

test('chooseHighlights never returns two overlapping ranges', () => {
  const peaks = Array.from({ length: 30 }, (_, i) => peak(i * 3, 30 - i))
  const chosen = chooseHighlights({ peaks, duration: 100, taken: [] })
  chosen.forEach((a, i) =>
    chosen.slice(i + 1).forEach((b) => assert.ok(a.range.end <= b.range.start || b.range.end <= a.range.start))
  )
})
