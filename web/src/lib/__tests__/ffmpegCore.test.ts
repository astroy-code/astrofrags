import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeFixture, meanVolumeDb, parseMediaInfo, pixelAt, probeBytes, runCore } from './support/ffmpegCore.ts'

test('harness encodes and probes a synthetic clip', async () => {
  const info = await probeBytes(await makeFixture('video'), 'clip.mp4')
  assert.equal(info.hasVideo, true)
  assert.equal(info.width, 320)
  assert.equal(info.height, 180)
  assert.ok(Math.abs(info.durationSeconds - 2) < 0.15, `duration ${info.durationSeconds}`)
  assert.equal(info.audioStreams, 1)
})

test('harness reports a clip with no audio as zero audio streams', async () => {
  const info = await probeBytes(await makeFixture('videoNoAudio'), 'clip.mp4')
  assert.equal(info.hasVideo, true)
  assert.equal(info.audioStreams, 0)
})

test('harness measures a tone as audible and digital silence as very quiet', async () => {
  assert.ok((await meanVolumeDb(await makeFixture('tone'), 'tone.wav')) > -40)
  const silence = await runCore(
    ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', 'silent.wav']
  )
  assert.equal(silence.exitCode, 0)
  // volumedetect prints -91 dB or -inf for digital silence depending on the build.
  assert.ok((await meanVolumeDb(silence.read('silent.wav'), 'silent.wav')) < -80)
})

test('harness reads the colour of a solid image', async () => {
  const png = await makeFixture('png', { color: '#ff0000', width: 8, height: 8 })
  const pixel = await pixelAt(png, 'red.png', 2, 2, 0)
  assert.ok(pixel.r > 240 && pixel.g < 20 && pixel.b < 20, JSON.stringify(pixel))
})

test('harness builds a two-track clip with a silent first track and a loud second', async () => {
  const bytes = await makeFixture('twoTrack')
  assert.equal((await probeBytes(bytes, 'two.mp4')).audioStreams, 2)
})

test('parseMediaInfo reads duration, size, fps and audio stream count from a log', () => {
  const log = [
    'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'in.mp4\':',
    '  Duration: 00:01:02.50, start: 0.000000, bitrate: 900 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720 [SAR 1:1 DAR 16:9], 800 kb/s, 59.94 fps, 60 tbr, 15360 tbn',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 96 kb/s',
    '  Stream #0:2[0x3](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 64 kb/s'
  ].join('\n')
  assert.deepEqual(parseMediaInfo(log), {
    durationSeconds: 62.5,
    width: 1280,
    height: 720,
    fps: 59.94,
    hasVideo: true,
    audioStreams: 2
  })
})
