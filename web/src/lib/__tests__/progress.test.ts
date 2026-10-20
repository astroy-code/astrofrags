import { test } from 'node:test'
import assert from 'node:assert/strict'
import { progressRatio } from '../progress.ts'

test('converts output time in microseconds to a ratio of the plan', () => {
  assert.equal(progressRatio(1_500_000, 3), 0.5)
  assert.equal(progressRatio(3_000_000, 3), 1)
})

test('clamps to 0..1', () => {
  assert.equal(progressRatio(-1, 3), 0)
  assert.equal(progressRatio(9_000_000, 3), 1)
})

test('a non-positive plan or a non-finite time gives 0', () => {
  assert.equal(progressRatio(1_000_000, 0), 0)
  assert.equal(progressRatio(1_000_000, -2), 0)
  assert.equal(progressRatio(NaN, 3), 0)
  assert.equal(progressRatio(Infinity, 3), 0)
})
