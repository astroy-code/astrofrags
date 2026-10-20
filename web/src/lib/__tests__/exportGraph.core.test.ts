import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportArgs } from '../exportGraph.ts'
import type { ClipPlan, ExportPlan } from '../exportGraph.ts'
import { formatOutputSize } from '../exportFormat.ts'
import { fitWithin } from '../outputGeometry.ts'
import { watermarkRect } from '../overlayLayout.ts'
import { makeFixture, makeSkewedClip, meanVolumeDb, pixelAt, probeBytes, runCore, streamSeconds } from './support/ffmpegCore.ts'

const OUTPUT = { width: 320, height: 180 }
const LOGO = { width: 64, height: 64 }

/** Overrides for a plan; `clip` is shorthand for a one-clip reel. */
type PlanOverrides = Partial<ExportPlan> & { readonly clip?: ClipPlan }

const basePlan = ({ clip, ...overrides }: PlanOverrides = {}): ExportPlan => ({
  clips: [clip ?? { start: 0, end: 1, audioTrackIndex: 0 }],
  transition: null,
  output: OUTPUT,
  logo: LOGO,
  watermarkCorner: 'bottom-right',
  format: 'original',
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

const exportClip = (plan: ExportPlan, video: Uint8Array, extras: ExportExtras = {}) =>
  exportReel(plan, [video], extras)

/** Runs a plan over one fixture per clip, in order (clip i reads the file `in<i>.mp4`). */
async function exportReel(plan: ExportPlan, videos: readonly Uint8Array[], extras: ExportExtras = {}) {
  const videoNames = videos.map((_, i) => (videos.length === 1 ? (extras.videoName ?? 'in.mp4') : `in${i}.mp4`))
  const logo = await makeFixture('png', { color: '#ff0000', width: LOGO.width, height: LOGO.height })
  const files: Record<string, Uint8Array> = { 'logo.png': logo }
  videos.forEach((video, i) => {
    files[videoNames[i]] = video
  })
  if (extras.card) {
    files['intro.png'] = extras.card
    files['outro.png'] = extras.card
  }
  if (extras.music) files['music.wav'] = extras.music
  if (extras.lowerThirdPng) files['lowerthird.png'] = extras.lowerThirdPng
  const inputs = {
    videos: videoNames,
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

const presetPlan = (format: ExportPlan['format'], overrides: PlanOverrides = {}): ExportPlan =>
  basePlan({ format, output: formatOutputSize(format, OUTPUT), ...overrides })

for (const format of ['vertical', 'vertical-crop', 'square'] as const) {
  test(`the ${format} format gives the desktop frame size from a landscape clip`, async () => {
    const plan = presetPlan(format)
    const info = await probeBytes(await exportClip(plan, await makeFixture('video')), 'out.mp4')
    assert.deepEqual([info.width, info.height], [plan.output.width, plan.output.height])
    assert.ok(Math.abs(info.durationSeconds - 1) < 0.2, `duration ${info.durationSeconds}`)
  })
}

test('a preset also fits a portrait clip and one with no audio', async () => {
  const portrait = await makeFixture('video', { width: 180, height: 320 })
  const plan = presetPlan('square', { clip: NO_AUDIO })
  const info = await probeBytes(await exportClip(plan, portrait), 'out.mp4')
  assert.deepEqual([info.width, info.height], [1080, 1080])
  assert.equal(info.audioStreams, 1)
})

test('the blurred bars differ from the cropped fill at the same spot', async () => {
  const video = await makeFixture('video')
  const bars = await exportClip(presetPlan('vertical'), video)
  const crop = await exportClip(presetPlan('vertical-crop'), video)
  // Row 100 of a 1080x1920 frame is the top bar in bars mode, blurred background; in crop mode
  // it is sharp picture. Sampling several columns avoids one lucky equal pixel.
  let differing = 0
  for (const x of [100, 300, 500, 700, 900]) {
    const a = await pixelAt(bars, 'out.mp4', x, 100, 0.5)
    const b = await pixelAt(crop, 'out.mp4', x, 100, 0.5)
    if (distance(a, b) > 30) differing += 1
  }
  assert.ok(differing >= 1, 'bars and crop looked identical')
})

test('a preset works with both cards and music, and the watermark follows the frame', async () => {
  const plan = presetPlan('vertical', { ...WITH_CARDS, intro: true, outro: true, music: true })
  const out = await exportClip(plan, await makeFixture('video'), {
    card: await cardPng(),
    music: await makeFixture('tone')
  })
  const info = await probeBytes(out, 'out.mp4')
  assert.deepEqual([info.width, info.height], [1080, 1920])
  assert.ok(Math.abs(info.durationSeconds - 7) < 0.3, `duration ${info.durationSeconds}`)
  const rect = watermarkRect('bottom-right', plan.output, LOGO)
  const inside = await pixelAt(out, 'out.mp4', rect.x + 10, rect.y + 10, 1.5)
  assert.ok(inside.r > 150 && inside.g < 80, JSON.stringify(inside))
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

const NO_AUDIO = { start: 0, end: 1, audioTrackIndex: null } as const

test('music is audible over a clip with no audio', async () => {
  const out = await exportClip(basePlan({ clip: NO_AUDIO, music: true }), await makeFixture('videoNoAudio'), {
    music: await makeFixture('tone')
  })
  assert.ok((await meanVolumeDb(out, 'out.mp4')) > -40)
})

test('music never lengthens the output, even for a clip shorter than its fades', async () => {
  const music = await makeFixture('tone', { duration: 3 })
  const video = await makeFixture('videoNoAudio')
  const normal = await exportClip(basePlan({ clip: NO_AUDIO, music: true }), video, { music })
  assert.ok(Math.abs((await probeBytes(normal, 'out.mp4')).durationSeconds - 1) < 0.15)
  const tiny = { start: 0, end: 0.5, audioTrackIndex: null } as const
  const short = await exportClip(basePlan({ clip: tiny, music: true }), video, { music })
  assert.ok(Math.abs((await probeBytes(short, 'out.mp4')).durationSeconds - 0.5) < 0.15)
})

test('music loops when it is shorter than the clip', async () => {
  const video = await makeFixture('videoNoAudio')
  const plan = basePlan({ clip: { start: 0, end: 2, audioTrackIndex: null }, music: true })
  const out = await exportClip(plan, video, { music: await makeFixture('tone', { duration: 0.5 }) })
  assert.ok((await meanVolumeDb(out, 'out.mp4', { start: 1.2, duration: 0.6 })) > -40)
})

test('the cards stay silent and the music plays only under the clip', async () => {
  // A 6 s clip leaves a plateau between its two 2 s music fades (clip time 2..4 s).
  const clip = { start: 0, end: 6, audioTrackIndex: null } as const
  const plan = basePlan({ ...WITH_CARDS, intro: true, music: true, clip })
  const out = await exportClip(plan, await makeFixture('videoNoAudio', { duration: 6 }), {
    card: await cardPng(),
    music: await makeFixture('tone', { duration: 6 })
  })
  // The intro occupies 0..3 s; the clip's plateau is at 3 + (2..4) s.
  assert.ok((await meanVolumeDb(out, 'out.mp4', { start: 0.2, duration: 2.5 })) < -60)
  assert.ok((await meanVolumeDb(out, 'out.mp4', { start: 5.5, duration: 1 })) > -40)
})

test('music still works with a loud clip and both cards', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true, outro: true, music: true })
  const out = await exportClip(plan, await makeFixture('video'), {
    card: await cardPng(),
    music: await makeFixture('tone')
  })
  const info = await probeBytes(out, 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 7) < 0.25)
  assert.equal(info.audioStreams, 1)
})

const isBlue = (p: { r: number; g: number; b: number }) => p.b > 180 && p.r < 70 && p.g < 70
const boxPng = (box: { x: number; y: number; width: number; height: number }) =>
  makeFixture('boxPng', { width: OUTPUT.width, height: OUTPUT.height, box: { ...box, color: '#0000ff' } })

test('the lower-third shows over the clip', async () => {
  const lowerThirdPng = await boxPng({ x: 10, y: 140, width: 100, height: 30 })
  const out = await exportClip(basePlan({ lowerThird: true }), await makeFixture('video'), { lowerThirdPng })
  assert.ok(isBlue(await pixelAt(out, 'out.mp4', 50, 150, 0.5)))
  assert.ok(!isBlue(await pixelAt(out, 'out.mp4', 200, 50, 0.5)), 'transparent areas stay clear')
})

test('the lower-third also shows over the cards', async () => {
  const lowerThirdPng = await boxPng({ x: 10, y: 140, width: 100, height: 30 })
  const plan = basePlan({ ...WITH_CARDS, intro: true, lowerThird: true })
  const out = await exportClip(plan, await makeFixture('video'), { card: await cardPng(), lowerThirdPng })
  assert.ok(isBlue(await pixelAt(out, 'out.mp4', 50, 150, 1.5)))
  assert.ok(isBlue(await pixelAt(out, 'out.mp4', 50, 150, 3.3)))
})

test('the lower-third sits on top of the watermark', async () => {
  const lowerThirdPng = await boxPng({ x: 0, y: 140, width: 80, height: 40 })
  const plan = basePlan({ watermarkCorner: 'bottom-left', lowerThird: true })
  const out = await exportClip(plan, await makeFixture('video'), { lowerThirdPng })
  const mark = watermarkRect('bottom-left', OUTPUT, LOGO)
  assert.ok(isBlue(await pixelAt(out, 'out.mp4', mark.x + 13, mark.y + 13, 0.5)), 'box covers the logo')
})

test('cards still work for a clip with no audio', async () => {
  const plan = basePlan({ ...WITH_CARDS, intro: true, outro: true, clip: { start: 0, end: 1, audioTrackIndex: null } })
  const out = await exportClip(plan, await makeFixture('videoNoAudio'), { card: await cardPng() })
  const info = await probeBytes(out, 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 7) < 0.25)
  assert.equal(info.audioStreams, 1)
})

// ---- Reels: several clips joined in one graph ----

const clipOf = (start: number, end: number, audioTrackIndex: number | null = 0): ClipPlan => ({
  start,
  end,
  audioTrackIndex
})

test('three clips of different sizes and one with no audio join into the output size', async () => {
  const landscape = await makeFixture('video', { width: 320, height: 180 })
  const portrait = await makeFixture('video', { width: 180, height: 320 })
  const noAudio = await makeFixture('videoNoAudio', { width: 640, height: 360 })
  const plan = basePlan({ clips: [clipOf(0, 1), clipOf(0, 1), clipOf(0, 1, null)] })
  const info = await probeBytes(await exportReel(plan, [landscape, portrait, noAudio]), 'out.mp4')
  assert.deepEqual([info.width, info.height], [320, 180])
  assert.equal(info.audioStreams, 1)
  assert.ok(Math.abs(info.durationSeconds - 3) < 0.25, `duration ${info.durationSeconds}`)
})

test('a transition shortens the output by one duration per join', async () => {
  const video = await makeFixture('video', { duration: 3 })
  const clips = [clipOf(0, 2), clipOf(0, 2), clipOf(0, 2)]
  const hard = await probeBytes(await exportReel(basePlan({ clips }), [video, video, video]), 'out.mp4')
  assert.ok(Math.abs(hard.durationSeconds - 6) < 0.25, `hard cut ${hard.durationSeconds}`)
  const transition = { seconds: 0.5, styles: ['fade', 'wipeleft'] as const }
  const faded = await probeBytes(
    await exportReel(basePlan({ clips, transition }), [video, video, video]),
    'out.mp4'
  )
  assert.ok(Math.abs(faded.durationSeconds - 5) < 0.25, `transition ${faded.durationSeconds}`)
})

test('a 0.5 s clip with a clamped transition still exports at the right length', async () => {
  const video = await makeFixture('video', { duration: 3 })
  const plan = basePlan({
    clips: [clipOf(0, 0.5), clipOf(0, 2)],
    transition: { seconds: 0.25, styles: ['dissolve'] }
  })
  const info = await probeBytes(await exportReel(plan, [video, video]), 'out.mp4')
  assert.ok(Math.abs(info.durationSeconds - 2.25) < 0.25, `duration ${info.durationSeconds}`)
})

test('a 30 fps and a 60 fps clip join', async () => {
  const slow = await makeFixture('video', { fps: 30 })
  const fast = await makeFixture('video', { fps: 60 })
  const plan = basePlan({ clips: [clipOf(0, 1), clipOf(0, 1)] })
  const info = await probeBytes(await exportReel(plan, [slow, fast]), 'out.mp4')
  assert.equal(Math.round(info.fps), 30)
  assert.ok(Math.abs(info.durationSeconds - 2) < 0.25, `duration ${info.durationSeconds}`)
})

test('cards, music and a transition together keep the exact length', async () => {
  const video = await makeFixture('video', { duration: 3 })
  const plan = basePlan({
    ...WITH_CARDS,
    intro: true,
    outro: true,
    music: true,
    clips: [clipOf(0, 2), clipOf(0, 2)],
    transition: { seconds: 1, styles: ['circleopen'] }
  })
  const out = await exportReel(plan, [video, video], {
    card: await cardPng(),
    music: await makeFixture('tone', { duration: 2 })
  })
  const info = await probeBytes(out, 'out.mp4')
  // 2 + 2 - 1 of clips, plus two 3 s cards.
  assert.ok(Math.abs(info.durationSeconds - 9) < 0.3, `duration ${info.durationSeconds}`)
})

test('the sound carries across a join instead of dropping out', async () => {
  const video = await makeFixture('video', { duration: 3 })
  const plan = basePlan({
    clips: [clipOf(0, 2), clipOf(0, 2)],
    transition: { seconds: 0.5, styles: ['fade'] }
  })
  const out = await exportReel(plan, [video, video])
  assert.ok((await meanVolumeDb(out, 'out.mp4')) > -40)
})

for (const style of [
  'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize', 'zoomin'
] as const) {
  test(`the ${style} transition exports`, async () => {
    const video = await makeFixture('video', { duration: 2 })
    const plan = basePlan({
      clips: [clipOf(0, 1), clipOf(0, 1)],
      transition: { seconds: 0.25, styles: [style] }
    })
    const info = await probeBytes(await exportReel(plan, [video, video]), 'out.mp4')
    assert.ok(Math.abs(info.durationSeconds - 1.75) < 0.25, `${style}: ${info.durationSeconds}`)
  })
}

test('a preset reframes every clip of a reel with its own filter labels', async () => {
  const landscape = await makeFixture('video')
  const portrait = await makeFixture('video', { width: 180, height: 320 })
  const plan = presetPlan('vertical', { clips: [clipOf(0, 1), clipOf(0, 1)] })
  const info = await probeBytes(await exportReel(plan, [landscape, portrait]), 'out.mp4')
  assert.deepEqual([info.width, info.height], [1080, 1920])
})

// ---- Reels: segments whose streams do not match their trim ----

test('a clip whose streams end before its trim end still joins at the planned length', async () => {
  const video = await makeFixture('video', { duration: 2 })
  // Both clips ask for 3 s of a 2 s file; without padding the transition never starts.
  const plan = basePlan({
    clips: [clipOf(0, 3), clipOf(0, 3)],
    transition: { seconds: 0.5, styles: ['fade'] }
  })
  const out = await exportReel(plan, [video, video])
  const picture = await streamSeconds(out, 'v:0', 'out.mp4')
  const sound = await streamSeconds(out, 'a:0', 'out.mp4')
  assert.ok(Math.abs(picture - 5.5) < 0.25, `picture ${picture}`)
  assert.ok(Math.abs(sound - 5.5) < 0.25, `sound ${sound}`)
})

test('sound shorter than its picture does not drift across several joins', async () => {
  const skewed = await makeSkewedClip(2, 1.5)
  const plan = basePlan({
    clips: [clipOf(0, 2), clipOf(0, 2), clipOf(0, 2), clipOf(0, 2)],
    transition: { seconds: 0.3, styles: ['fade', 'fade', 'fade'] }
  })
  const out = await exportReel(plan, [skewed, skewed, skewed, skewed])
  const picture = await streamSeconds(out, 'v:0', 'out.mp4')
  const sound = await streamSeconds(out, 'a:0', 'out.mp4')
  // 4 x 2 s less three 0.3 s overlaps.
  assert.ok(Math.abs(picture - 7.1) < 0.25, `picture ${picture}`)
  assert.ok(Math.abs(sound - 7.1) < 0.25, `sound ${sound}`)
})
