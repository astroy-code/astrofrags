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

const ACCENT = '#1a1a2e'
const ACCENT_RGB = { r: 26, g: 26, b: 46 }

/** Extra files an export may need, written under fixed names that the inputs point at. */
interface ExportExtras {
  readonly videoName?: string
  readonly card?: Uint8Array
  readonly music?: Uint8Array
  readonly lowerThirdPng?: Uint8Array
}

async function exportClip(plan: ExportPlan, video: Uint8Array, extras: ExportExtras = {}) {
  const videoName = extras.videoName ?? 'in.mp4'
  const logo = await makeFixture('png', { color: '#ff0000', width: LOGO.width, height: LOGO.height })
  const files: Record<string, Uint8Array> = { [videoName]: video, 'logo.png': logo }
  if (extras.card) {
    files['intro.png'] = extras.card
    files['outro.png'] = extras.card
  }
  if (extras.music) files['music.wav'] = extras.music
  if (extras.lowerThirdPng) files['lowerthird.png'] = extras.lowerThirdPng
  const inputs = {
    video: videoName,
    logo: 'logo.png',
    ...(plan.intro ? { introCard: 'intro.png' } : {}),
    ...(plan.outro ? { outroCard: 'outro.png' } : {}),
    ...(plan.music ? { music: 'music.wav' } : {}),
    ...(plan.lowerThird ? { lowerThird: 'lowerthird.png' } : {})
  }
  const run = await runCore(buildExportArgs(plan, inputs, 'out.mp4'), files)
  assert.equal(run.exitCode, 0, `ffmpeg failed:\n${run.log.slice(-600)}`)
  return run.read('out.mp4')
}

const cardPng = () => makeFixture('png', { color: ACCENT, width: OUTPUT.width, height: OUTPUT.height })
const distance = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

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
  const out = await exportClip(plan, video, { videoName: 'in.avi' })
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

const WITH_CARDS = { cardSeconds: 3 } as const

test('intro and outro add exactly two card durations', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true, outro: true })
  const out = await exportClip(plan, await makeFixture('video'), { card: await cardPng() })
  const info = await probeBytes(out, 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 7) < 0.25, `duration ${info.durationSeconds}`)
  assert.equal(info.audioStreams, 1)
})

test('an intro alone adds one card duration', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true })
  const out = await exportClip(plan, await makeFixture('video'), { card: await cardPng() })
  assert.ok(Math.abs((await probeBytes(out, 'out.mp4')).durationSeconds - 4) < 0.25)
})

test('the card shows its accent colour once faded in, and the clip follows it', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true })
  const out = await exportClip(plan, await makeFixture('video'), { card: await cardPng() })
  const onCard = await pixelAt(out, 'out.mp4', 10, 10, 1.5)
  assert.ok(distance(onCard, ACCENT_RGB) < 20, JSON.stringify(onCard))
  const onClip = await pixelAt(out, 'out.mp4', 10, 10, 3.3)
  assert.ok(distance(onClip, ACCENT_RGB) > 40, JSON.stringify(onClip))
})

test('forces 30 fps when a card is on and keeps the source fps otherwise', async () => {
  const video = await makeFixture('video', { fps: 60 })
  const plain = await probeBytes(await exportClip(basePlan(), video), 'out.mp4')
  assert.equal(Math.round(plain.fps), 60)
  const carded = await probeBytes(
    await exportClip(basePlan({ ...WITH_CARDS, outro: true }), video, { card: await cardPng() }),
    'out.mp4'
  )
  assert.equal(Math.round(carded.fps), 30)
})

test('the watermark covers the cards too', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true })
  const out = await exportClip(plan, await makeFixture('video'), { card: await cardPng() })
  const rect = watermarkRect('bottom-right', OUTPUT, LOGO)
  const inside = await pixelAt(out, 'out.mp4', rect.x + 13, rect.y + 13, 1.5)
  assert.ok(inside.r > 200 && inside.g < 60 && inside.b < 60, JSON.stringify(inside))
})

test('cards still work for a clip with no audio', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true, outro: true, clip: { start: 0, end: 1, audioTrackIndex: null } })
  const out = await exportClip(plan, await makeFixture('videoNoAudio'), { card: await cardPng() })
  const info = await probeBytes(out, 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 7) < 0.25)
  assert.equal(info.audioStreams, 1)
})
