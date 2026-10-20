import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime } from '../formatTime.ts'

test('formats seconds as m:ss.t', () => {
  assert.equal(formatTime(0), '0:00.0')
  assert.equal(formatTime(65.25), '1:05.3')
  assert.equal(formatTime(59.96), '1:00.0')
  assert.equal(formatTime(600), '10:00.0')
})

test('treats negative and non-finite values as zero', () => {
  assert.equal(formatTime(-4), '0:00.0')
  assert.equal(formatTime(NaN), '0:00.0')
  assert.equal(formatTime(Infinity), '0:00.0')
})
