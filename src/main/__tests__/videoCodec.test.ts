import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVideoStream, isChromiumPlayable } from '../videoCodec.ts'

const HEVC_STDERR = `  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1280x720 [SAR 1:1 DAR 16:9], 14506 kb/s, 59.67 fps, 60 tbr, 10000k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)`
const H264_STDERR = `  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 20000 kb/s, 60 fps`
const H264_10BIT_STDERR = `  Stream #0:0: Video: h264 (High 10) (avc1 / 0x31637661), yuv420p10le(tv), 1920x1080, 20000 kb/s, 60 fps`

test('parses codec and pixel format from ffmpeg stderr', () => {
  assert.deepEqual(parseVideoStream(HEVC_STDERR), { codec: 'hevc', pixFmt: 'yuv420p' })
})

test('returns null when there is no video stream', () => {
  assert.equal(parseVideoStream('Stream #0:0: Audio: aac, 48000 Hz'), null)
})

test('HEVC is not playable in Chromium', () => {
  assert.equal(isChromiumPlayable(parseVideoStream(HEVC_STDERR)), false)
})

test('8-bit H.264 is playable', () => {
  assert.equal(isChromiumPlayable(parseVideoStream(H264_STDERR)), true)
})

test('10-bit H.264 is not playable', () => {
  assert.equal(isChromiumPlayable(parseVideoStream(H264_10BIT_STDERR)), false)
})

test('unknown/missing stream is treated as not playable', () => {
  assert.equal(isChromiumPlayable(null), false)
})
