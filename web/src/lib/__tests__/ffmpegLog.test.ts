import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countAudioStreams } from '../ffmpegLog.ts'

const VIDEO_LINE = '  Stream #0:0[0x1](und): Video: hevc (Main), yuv420p, 1280x720, 60 fps'

test('counts every audio stream in an ffmpeg log', () => {
  const log = [
    VIDEO_LINE,
    '  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp',
    '  Stream #0:2[0x3](und): Audio: aac (LC), 48000 Hz, mono, fltp'
  ].join('\n')
  assert.equal(countAudioStreams(log), 2)
})

test('returns 0 for a video-only log', () => {
  assert.equal(countAudioStreams(VIDEO_LINE), 0)
})

test('returns 0 for an empty log', () => {
  assert.equal(countAudioStreams(''), 0)
})
