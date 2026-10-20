import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRANSITION_STYLES,
  effectiveTransitionSeconds,
  parseTransitionStyle,
  reelSeconds,
  resolveJoinStyles
} from '../transitions.ts'

test('effective seconds clamps to 0.1-2 then to half the shortest clip', () => {
  assert.equal(effectiveTransitionSeconds(5, [10, 8]), 2)
  assert.equal(effectiveTransitionSeconds(0.01, [10, 8]), 0.1)
  assert.equal(effectiveTransitionSeconds(2, [1, 9]), 0.5)
  assert.equal(effectiveTransitionSeconds(2, [0.5, 9]), 0.25)
})

test('parseTransitionStyle keeps the eleven styles and falls back for anything else', () => {
  assert.equal(TRANSITION_STYLES.length, 11)
  for (const style of TRANSITION_STYLES) assert.equal(parseTransitionStyle(style, 'fade'), style)
  for (const bad of ['', 'spin', 3, null, undefined, ['fade'], {}]) {
    assert.equal(parseTransitionStyle(bad, 'zoomin'), 'zoomin')
  }
})

test('resolveJoinStyles repeats a fixed style, one per join', () => {
  assert.deepEqual(resolveJoinStyles('wipeleft', 3), ['wipeleft', 'wipeleft', 'wipeleft'])
  assert.deepEqual(resolveJoinStyles('fade', 0), [])
})

test('random is rolled per join from the generator and never returns random', () => {
  const rolls = [0, 0.5, 0.99]
  let next = 0
  const styles = resolveJoinStyles('random', 3, () => rolls[next++])
  // The pool is the ten non-random styles in order: index 0, 5 and 9.
  assert.deepEqual(styles, ['fade', 'slideright', 'zoomin'])
  assert.ok(!styles.includes('random' as never))
})

test('reelSeconds subtracts one transition per join', () => {
  assert.equal(reelSeconds([4, 4, 4], 1), 10)
  assert.equal(reelSeconds([4, 4, 4], null), 12)
  assert.equal(reelSeconds([4], 1), 4)
})
