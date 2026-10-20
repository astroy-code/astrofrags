import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportArgs } from '../exportGraph.ts'
import type { ExportPlan } from '../exportGraph.ts'
import { fitWithin } from '../outputGeometry.ts'
import { watermarkRect } from '../overlayLayout.ts'
import { makeFixture, meanVolumeDb, pixelAt, probeBytes, runCore } from './support/ffmpegCore.ts'

const OUTPUT = { width: 320, height: 180 }
const LOGO = { width: 64, height: 64 }

const basePlan = (overrides: Partial<ExportPlan> = {}): ExportPlan => ({
  clip: { start: 0, end: 1, audioTrackIndex: 0 },
  output: OUTPUT,
  logo: LOGO,
  watermarkCorner: 'bottom-right',
  intro: false,
  outro: false,
  cardSeconds: 2,
  music: false,
  lowerThird: false,
  ...overrides
})

async function exportClip(plan: ExportPlan, video: Uint8Array, videoName = 'in.mp4') {
  const logo = await makeFixture('png', { color: '#ff0000', width: LOGO.width, height: LOGO.height })
  const run = await runCore(buildExportArgs(plan, { video: videoName, logo: 'logo.png' }, 'out.mp4'), {
    [videoName]: video,
    'logo.png': logo
  })
  assert.equal(run.exitCode, 0, `ffmpeg failed:\n${run.log.slice(-600)}`)
  return run.read('out.mp4')
}

test('exports a 1 s trim of a 2 s clip', async () => {
  const out = await exportClip(basePlan(), await makeFixture('video'))
  const info = await probeBytes(out, 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 1) < 0.15, `duration ${info.durationSeconds}`)
  assert.equal(info.hasVideo, true)
  assert.equal(info.audioStreams, 1)
  assert.deepEqual([info.width, info.height], [320, 180])
})

test('exports a clip with no audio as silent audio', async () => {
  const plan = basePlan({ clip: { start: 0, end: 1, audioTrackIndex: null } })
  const out = await exportClip(plan, await makeFixture('videoNoAudio'))
  assert.equal((await probeBytes(out, 'out.mp4')).audioStreams, 1)
})

test('uses the requested audio track', async () => {
  const video = await makeFixture('twoTrack')
  const loud = await exportClip(basePlan({ clip: { start: 0, end: 1.5, audioTrackIndex: 1 } }), video)
  assert.ok((await meanVolumeDb(loud, 'out.mp4')) > -40)
  const silent = await exportClip(basePlan({ clip: { start: 0, end: 1.5, audioTrackIndex: 0 } }), video)
  assert.ok((await meanVolumeDb(silent, 'out.mp4')) < -80)
})

test('fits an odd-sized source to even dimensions', async () => {
  const video = await makeFixture('rawVideo', { width: 321, height: 181 })
  const output = fitWithin({ width: 321, height: 181 })
  const plan = basePlan({ output, clip: { start: 0, end: 1, audioTrackIndex: null } })
  const out = await exportClip(plan, video, 'in.avi')
  const info = await probeBytes(out, 'out.mp4')
  assert.deepEqual([info.width, info.height], [320, 180])
})

test('fits a portrait source without distorting or upscaling it', async () => {
  const video = await makeFixture('video', { width: 180, height: 320 })
  const plan = basePlan({ output: fitWithin({ width: 180, height: 320 }) })
  const info = await probeBytes(await exportClip(plan, video), 'out.mp4')
  assert.deepEqual([info.width, info.height], [180, 320])
})

test('draws the watermark in the chosen corner and nowhere else', async () => {
  const video = await makeFixture('video')
  for (const corner of ['bottom-right', 'top-left'] as const) {
    const rect = watermarkRect(corner, OUTPUT, LOGO)
    const out = await exportClip(basePlan({ watermarkCorner: corner }), video)
    const inside = await pixelAt(out, 'out.mp4', rect.x + 13, rect.y + 13, 0.5)
    assert.ok(inside.r > 200 && inside.g < 60 && inside.b < 60, `${corner}: ${JSON.stringify(inside)}`)
    const elsewhere = corner === 'top-left'
      ? await pixelAt(out, 'out.mp4', 300, 160, 0.5)
      : await pixelAt(out, 'out.mp4', 10, 10, 0.5)
    assert.ok(!(elsewhere.r > 200 && elsewhere.g < 60 && elsewhere.b < 60), `${corner} elsewhere: ${JSON.stringify(elsewhere)}`)
  }
})
