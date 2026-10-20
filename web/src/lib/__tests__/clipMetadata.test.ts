import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMetadata } from '../clipMetadata.ts'
import { createClip } from '../reel.ts'
import type { VideoMetadata } from '../clipMetadata.ts'

const clip = { id: 1, ...createClip(new File(['x'], 'a.mp4'), 'blob:a') }
const report = (patch: Partial<VideoMetadata> = {}): VideoMetadata => ({
  kind: 'metadata',
  duration: 6,
  videoWidth: 640,
  videoHeight: 360,
  error: null,
  ...patch
})

test('the first report sets duration, size and a full-length range', () => {
  assert.deepEqual(applyMetadata(clip, report()), {
    duration: 6,
    range: { start: 0, end: 6 },
    previewBroken: false,
    videoSize: { width: 640, height: 360 }
  })
})

test('a repeat report with the same duration keeps the user trim', () => {
  const trimmed = { ...clip, duration: 6, range: { start: 1, end: 3 } }
  const patch = applyMetadata(trimmed, report())
  assert.deepEqual(patch.range, { start: 1, end: 3 })
})

test('a new duration (Infinity to finite on some phone files) resets the range', () => {
  const trimmed = { ...clip, duration: 6, range: { start: 1, end: 3 } }
  assert.deepEqual(applyMetadata(trimmed, report({ duration: 8 })).range, { start: 0, end: 8 })
  assert.deepEqual(applyMetadata(clip, report({ duration: Infinity })).range, clip.range)
})

test('zero video size or an error marks the preview broken; a duration event does not judge it', () => {
  assert.equal(applyMetadata(clip, report({ videoWidth: 0, videoHeight: 0 })).previewBroken, true)
  assert.equal(applyMetadata(clip, report({ error: {} })).previewBroken, true)
  assert.equal(applyMetadata(clip, report({ kind: 'duration', videoWidth: 0, videoHeight: 0 })).previewBroken, false)
})

test('an unknown size keeps the size we already had', () => {
  const sized = { ...clip, videoSize: { width: 100, height: 50 } }
  assert.deepEqual(applyMetadata(sized, report({ videoWidth: 0, videoHeight: 0 })).videoSize, {
    width: 100,
    height: 50
  })
})
