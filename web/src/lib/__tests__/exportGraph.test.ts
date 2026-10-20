import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportArgs, planDurationSeconds } from '../exportGraph.ts'
import type { ExportInputs, ExportPlan } from '../exportGraph.ts'

const PLAN: ExportPlan = {
  clip: { start: 1.5, end: 3.5, audioTrackIndex: 0 },
  output: { width: 320, height: 180 },
  logo: { width: 512, height: 512 },
  watermarkCorner: 'bottom-right',
  intro: false,
  outro: false,
  cardSeconds: 3,
  music: false,
  lowerThird: false
}
const INPUTS: ExportInputs = { video: 'in.mp4', logo: 'logo.png' }

const graphOf = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]

test('uses a filter_complex and maps its final labels', () => {
  const args = buildExportArgs(PLAN, INPUTS, 'out.mp4')
  assert.ok(args.includes('-filter_complex'))
  const mapped = args.flatMap((arg, i) => (arg === '-map' ? [args[i + 1]] : []))
  assert.deepEqual(mapped, ['[outv]', '[outa]'])
})

test('places the clip with input-side -ss and -t', () => {
  const args = buildExportArgs(PLAN, INPUTS, 'out.mp4')
  assert.deepEqual(args.slice(0, 6), ['-ss', '1.500', '-t', '2.000', '-i', 'in.mp4'])
})

test('loops the logo for the whole plan duration', () => {
  const args = buildExportArgs(PLAN, INPUTS, 'out.mp4')
  assert.deepEqual(args.slice(6, 12), ['-loop', '1', '-t', '2.000', '-i', 'logo.png'])
})

test('output encode settings are libx264 ultrafast crf 23 yuv420p aac faststart', () => {
  const args = buildExportArgs(PLAN, INPUTS, 'out.mp4')
  assert.deepEqual(args.slice(-13), [
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4'
  ])
})

test('loudnorm is the last audio filter', () => {
  assert.ok(graphOf(buildExportArgs(PLAN, INPUTS, 'out.mp4')).includes('loudnorm=I=-16:TP=-1.5:LRA=11[outa]'))
})

test('a plain clip keeps the source frame rate', () => {
  assert.ok(!graphOf(buildExportArgs(PLAN, INPUTS, 'out.mp4')).includes('fps='))
})

test('selects the requested audio track, or generates silence when there is none', () => {
  const track = graphOf(buildExportArgs({ ...PLAN, clip: { ...PLAN.clip, audioTrackIndex: 2 } }, INPUTS, 'o.mp4'))
  assert.ok(track.includes('[0:a:2]'))
  const none = graphOf(buildExportArgs({ ...PLAN, clip: { ...PLAN.clip, audioTrackIndex: null } }, INPUTS, 'o.mp4'))
  assert.ok(none.includes('anullsrc'))
  assert.ok(!none.includes('[0:a:'))
})

test('the music stage uses the desktop loop, bed volume, fades, duck and mix', () => {
  const plan = { ...PLAN, clip: { start: 0, end: 10, audioTrackIndex: 0 }, music: true }
  const graph = graphOf(buildExportArgs(plan, { ...INPUTS, music: 'music.wav' }, 'out.mp4'))
  for (const fragment of [
    'aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9',
    'atrim=0:10.000,asetpts=PTS-STARTPTS,volume=0.35',
    'afade=t=in:st=0:d=2.000,afade=t=out:st=8.000:d=2.000',
    'sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300',
    'amix=inputs=2:duration=first'
  ]) {
    assert.ok(graph.includes(fragment), `missing: ${fragment}`)
  }
})

test('music is not wired in when the plan has none, and a missing file is reported', () => {
  assert.ok(!graphOf(buildExportArgs(PLAN, INPUTS, 'o.mp4')).includes('sidechaincompress'))
  assert.throws(() => buildExportArgs({ ...PLAN, music: true }, INPUTS, 'o.mp4'), /music/i)
})

test('a lower-third without its image is reported', () => {
  assert.throws(() => buildExportArgs({ ...PLAN, lowerThird: true }, INPUTS, 'o.mp4'), /lower-third/i)
})

test('planDurationSeconds adds a card duration for each card that is on', () => {
  assert.equal(planDurationSeconds(PLAN), 2)
  assert.equal(planDurationSeconds({ ...PLAN, intro: true }), 5)
  assert.equal(planDurationSeconds({ ...PLAN, outro: true }), 5)
  assert.equal(planDurationSeconds({ ...PLAN, intro: true, outro: true }), 8)
})

test('does not mutate the plan or the inputs', () => {
  const plan = Object.freeze({ ...PLAN, clip: Object.freeze({ ...PLAN.clip }) })
  const inputs = Object.freeze({ ...INPUTS })
  assert.doesNotThrow(() => buildExportArgs(plan, inputs, 'out.mp4'))
})
