import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitWithin, layoutScale, MAX_OUTPUT } from '../outputGeometry.ts'

test('MAX_OUTPUT is 1920x1080', () => {
  assert.deepEqual(MAX_OUTPUT, { width: 1920, height: 1080 })
})

test('a 4K source is scaled down to fit within 1080p', () => {
  assert.deepEqual(fitWithin({ width: 3840, height: 2160 }), { width: 1920, height: 1080 })
})

test('a smaller source is never scaled up', () => {
  assert.deepEqual(fitWithin({ width: 1280, height: 720 }), { width: 1280, height: 720 })
})

test('odd dimensions are rounded down to even', () => {
  assert.deepEqual(fitWithin({ width: 321, height: 181 }), { width: 320, height: 180 })
})

test('a portrait source keeps its shape and fits the 1080 height', () => {
  assert.deepEqual(fitWithin({ width: 1080, height: 1920 }), { width: 606, height: 1080 })
})

test('a tiny source never drops below 2x2', () => {
  assert.deepEqual(fitWithin({ width: 1, height: 1 }), { width: 2, height: 2 })
})

test('layoutScale is the shorter side over 1080', () => {
  assert.equal(layoutScale({ width: 1920, height: 1080 }), 1)
  assert.equal(layoutScale({ width: 1280, height: 720 }).toFixed(3), '0.667')
  assert.equal(layoutScale({ width: 606, height: 1080 }).toFixed(3), '0.561')
})
