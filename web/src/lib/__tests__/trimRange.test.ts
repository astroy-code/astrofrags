import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTrimRange, clampTrimRange, MIN_TRIM_SECONDS } from '../trimRange.ts'

test('accepts a normal range', () => {
  assert.deepEqual(validateTrimRange({ start: 2, end: 10 }, 30), { ok: true })
})

test('rejects non-finite or zero duration', () => {
  for (const duration of [NaN, Infinity, 0, -1]) {
    assert.deepEqual(validateTrimRange({ start: 0, end: 5 }, duration), {
      ok: false,
      reason: 'duration-unknown'
    })
  }
})

test('rejects negative start', () => {
  assert.deepEqual(validateTrimRange({ start: -1, end: 5 }, 30), { ok: false, reason: 'start-negative' })
})

test('rejects end <= start', () => {
  assert.deepEqual(validateTrimRange({ start: 5, end: 5 }, 30), { ok: false, reason: 'end-before-start' })
  assert.deepEqual(validateTrimRange({ start: 8, end: 3 }, 30), { ok: false, reason: 'end-before-start' })
})

test('rejects end beyond duration', () => {
  assert.deepEqual(validateTrimRange({ start: 2, end: 31 }, 30), { ok: false, reason: 'beyond-duration' })
})

test('rejects ranges shorter than MIN_TRIM_SECONDS', () => {
  assert.ok(MIN_TRIM_SECONDS > 0.2)
  assert.deepEqual(validateTrimRange({ start: 1, end: 1.2 }, 30), { ok: false, reason: 'too-short' })
})

test('clampTrimRange returns a new object and does not mutate input', () => {
  const input = Object.freeze({ start: -5, end: 99 })
  const result = clampTrimRange(input, 30)
  assert.deepEqual(result, { start: 0, end: 30 })
  assert.notEqual(result, input)
  assert.deepEqual(input, { start: -5, end: 99 })
})
