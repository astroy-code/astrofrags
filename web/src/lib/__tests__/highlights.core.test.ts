import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHighlightDecodeArgs } from '../ffmpegArgs.ts'
import { pcmPeaks, scanChunks } from '../highlights.ts'
import { makeBurstClip, makeFixture, runCore } from './support/ffmpegCore.ts'

async function peaksOf(clip: Uint8Array) {
  const run = await runCore(buildHighlightDecodeArgs({ inputPath: 'in.mp4', trackIndex: 0, outputPath: 'out.pcm' }), {
    'in.mp4': clip
  })
  assert.equal(run.exitCode, 0, run.log.slice(-300))
  return pcmPeaks(run.read('out.pcm'))
}

test('loud bursts in a quiet recording are found at the right times', async () => {
  const peaks = await peaksOf(await makeBurstClip({ seconds: 30, bursts: [8, 21] }))
  assert.equal(peaks.length, 2)
  const times = peaks.map((peak) => peak.time).sort((a, b) => a - b)
  assert.ok(Math.abs(times[0] - 8.2) < 0.6, `first at ${times[0]}`)
  assert.ok(Math.abs(times[1] - 21.2) < 0.6, `second at ${times[1]}`)
})

test('a recording without any burst has no highlights', async () => {
  assert.deepEqual(await peaksOf(await makeBurstClip({ seconds: 20, bursts: [] })), [])
})

test('a recording with no audio stream cannot be decoded, so the page never offers it', async () => {
  const clip = await makeFixture('videoNoAudio', { duration: 2 })
  const run = await runCore(buildHighlightDecodeArgs({ inputPath: 'in.mp4', trackIndex: 0, outputPath: 'out.pcm' }), {
    'in.mp4': clip
  })
  assert.notEqual(run.exitCode, 0)
})

test('pcm that is not a whole number of samples is still read', () => {
  assert.deepEqual(pcmPeaks(new Uint8Array(3)), [])
  assert.deepEqual(pcmPeaks(new Uint8Array(0)), [])
})

test('pcm that starts at an odd offset in its buffer is read the same', () => {
  const samples = new Int16Array(8000).fill(100)
  samples.fill(20000, 4000, 4800)
  const aligned = new Uint8Array(samples.buffer)
  const shifted = new Uint8Array(aligned.length + 1)
  shifted.set(aligned, 1)
  assert.deepEqual(pcmPeaks(shifted.subarray(1)), pcmPeaks(aligned))
})

test('decoding a recording in chunks finds the same moments, even one that straddles a chunk edge', async () => {
  const clip = await makeBurstClip({ seconds: 30, bursts: [8, 9.8, 24] })
  const whole = await peaksOf(clip)
  const { peaks: chunked } = await scanChunks({
    durationSeconds: 30,
    chunkSeconds: 10,
    decode: async ({ start, length }) => {
      const run = await runCore(
        buildHighlightDecodeArgs({
          inputPath: 'in.mp4',
          trackIndex: 0,
          outputPath: 'out.pcm',
          startSeconds: start,
          durationSeconds: length
        }),
        { 'in.mp4': clip }
      )
      assert.equal(run.exitCode, 0, run.log.slice(-300))
      return run.read('out.pcm')
    }
  })
  const times = (list: readonly { time: number }[]): number[] => list.map((peak) => peak.time).sort((a, b) => a - b)
  assert.equal(chunked.length, whole.length)
  times(chunked).forEach((time, index) => assert.ok(Math.abs(time - times(whole)[index]) < 0.35, `${time}`))
})
