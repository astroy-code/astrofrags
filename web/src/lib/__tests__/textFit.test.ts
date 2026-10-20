import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncateToWidth } from '../textFit.ts'

// Ten pixels per code point, so widths are easy to reason about.
const measure = (text: string): number => Array.from(text).length * 10

test('text that fits is returned unchanged', () => {
  assert.equal(truncateToWidth(measure, 'hello', 60), 'hello')
  assert.equal(truncateToWidth(measure, '', 60), '')
})

test('text that is too wide is cut and gets an ellipsis that fits the width', () => {
  const cut = truncateToWidth(measure, 'hello world', 60)
  assert.equal(cut, 'hello…')
  assert.ok(measure(cut) <= 60)
})

test('trailing spaces are not left before the ellipsis', () => {
  assert.equal(truncateToWidth(measure, 'hello world', 70), 'hello…')
})

test('emoji are never split in half', () => {
  const cut = truncateToWidth(measure, '🎯🎯🎯🎯🎯', 30)
  assert.equal(cut, '🎯🎯…')
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut), 'no lone surrogate')
})

test('when even the ellipsis does not fit, only the ellipsis is returned', () => {
  assert.equal(truncateToWidth(measure, 'hello', 5), '…')
})
