import { test } from 'node:test'
import assert from 'node:assert/strict'
import { musicFadeSeconds } from '../musicFade.ts'

test('long clips fade for two seconds', () => {
  assert.equal(musicFadeSeconds(60), 2)
})

test('short clips fade for at most half their length', () => {
  assert.equal(musicFadeSeconds(3), 1.5)
  assert.equal(musicFadeSeconds(0.5), 0.25)
})

test('empty or negative durations give no fade', () => {
  assert.equal(musicFadeSeconds(0), 0)
  assert.equal(musicFadeSeconds(-5), 0)
})
