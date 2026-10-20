import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPreviewUndecodable, UNDECODABLE_MESSAGE } from '../previewSupport.ts'

test('zero video dimensions mean the video track cannot be decoded', () => {
  assert.equal(isPreviewUndecodable({ videoWidth: 0, videoHeight: 0, error: null }), true)
})

test('a normal decodable video is fine', () => {
  assert.equal(isPreviewUndecodable({ videoWidth: 1280, videoHeight: 720, error: null }), false)
})

test('any media error counts as undecodable', () => {
  assert.equal(isPreviewUndecodable({ videoWidth: 1280, videoHeight: 720, error: { code: 4 } }), true)
  assert.equal(isPreviewUndecodable({ videoWidth: 0, videoHeight: 0, error: { code: 4 } }), true)
})

test('the message points the user to the desktop app', () => {
  assert.ok(UNDECODABLE_MESSAGE.includes('desktop app'))
})
