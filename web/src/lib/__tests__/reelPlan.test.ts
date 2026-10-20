import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BRANDING_SETTINGS } from '../brandingSettings.ts'
import type { BrandingSettings } from '../brandingSettings.ts'
import { buildExportPlan } from '../reelPlan.ts'
import type { ReelClip } from '../reelPlan.ts'

const LOGO = { width: 512, height: 512 }
const clip = (start: number, end: number, size = { width: 640, height: 360 }): ReelClip => ({
  start,
  end,
  duration: 60,
  audioTrackIndex: 0,
  sourceSize: size
})
const settings = (patch: Partial<BrandingSettings> = {}): BrandingSettings => ({
  ...DEFAULT_BRANDING_SETTINGS,
  ...patch
})
const plan = (clips: readonly ReelClip[], patch: Partial<BrandingSettings> = {}, music = false) =>
  buildExportPlan({ clips, branding: settings(patch), hasMusic: music, logo: LOGO, random: () => 0 })

test('a single clip has no transition even when transitions are on', () => {
  const result = plan([clip(0, 4)], { transitionsEnabled: true })
  assert.equal(result.transition, null)
  assert.equal(result.clips.length, 1)
})

test('transitions off means hard cuts', () => {
  assert.equal(plan([clip(0, 4), clip(0, 4)]).transition, null)
})

test('a transition gets the clamped seconds and one style per join', () => {
  const result = plan([clip(0, 4), clip(10, 12), clip(0, 9)], {
    transitionsEnabled: true,
    transitionStyle: 'wiperight',
    transitionSeconds: 1.5
  })
  // The shortest clip is 2 s, so the 1.5 s request is cut to 1 s.
  assert.deepEqual(result.transition, { seconds: 1, styles: ['wiperight', 'wiperight'] })
})

test('random styles are rolled once per join when the plan is built', () => {
  const rolls = [0, 0.5]
  let next = 0
  const result = buildExportPlan({
    clips: [clip(0, 4), clip(0, 4), clip(0, 4)],
    branding: settings({ transitionsEnabled: true, transitionStyle: 'random' }),
    hasMusic: false,
    logo: LOGO,
    random: () => rolls[next++]
  })
  assert.deepEqual(result.transition?.styles, ['fade', 'slideright'])
})

test('the original format takes the first clip size, fitted and even', () => {
  const result = plan([clip(0, 4, { width: 321, height: 181 }), clip(0, 4, { width: 3840, height: 2160 })])
  assert.deepEqual(result.output, { width: 320, height: 180 })
})

test('a preset gives its own size whatever the clips are', () => {
  const result = plan([clip(0, 4), clip(0, 4)], { exportFormat: 'square' })
  assert.deepEqual(result.output, { width: 1080, height: 1080 })
  assert.equal(result.format, 'square')
})

test('cards, music, watermark and lower-third follow the settings', () => {
  const result = plan([clip(0, 4)], { introEnabled: true, cardDurationSeconds: 5, lowerThirdEnabled: true }, true)
  assert.equal(result.intro, true)
  assert.equal(result.outro, false)
  assert.equal(result.cardSeconds, 5)
  assert.equal(result.music, true)
  assert.equal(result.lowerThird, true)
  assert.equal(result.watermarkCorner, 'bottom-right')
})

test('clip trims and audio tracks carry through in order', () => {
  const second = { ...clip(5, 9), audioTrackIndex: null }
  const result = plan([clip(1, 3), second])
  assert.deepEqual(result.clips, [
    { start: 1, end: 3, audioTrackIndex: 0 },
    { start: 5, end: 9, audioTrackIndex: null }
  ])
})

test('an empty reel is rejected', () => {
  assert.throws(() => plan([]), /at least one clip/)
})
