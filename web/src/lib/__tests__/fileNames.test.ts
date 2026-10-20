import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reelFileName, trimmedFileName } from '../fileNames.ts'

test('sanitizes spaces, dashes and emoji from Medal-style names', () => {
  assert.equal(
    trimmedFileName('Valorant 2026-10-20 – clip 🎯.mp4', 12.4, 30.6),
    'Valorant_2026-10-20_clip-trim-12s-31s.mp4'
  )
})

test('falls back to "clip" when nothing safe remains', () => {
  assert.equal(trimmedFileName('🎯.mov', 0, 5), 'clip-trim-0s-5s.mp4')
})

test('always outputs .mp4 and drops the original extension', () => {
  assert.equal(trimmedFileName('game.webm', 1, 2), 'game-trim-1s-2s.mp4')
})

test('a reel is named after the first clip and the clip count', () => {
  assert.equal(reelFileName('Valorant 2026-10-20 – clip 🎯.mp4', 3), 'Valorant_2026-10-20_clip-reel-3-clips.mp4')
})

test('a reel name falls back to "clip" when nothing safe remains', () => {
  assert.equal(reelFileName('🎯.mov', 2), 'clip-reel-2-clips.mp4')
})
