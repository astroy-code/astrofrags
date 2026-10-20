import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReframeStage, formatBitrate, formatOutputSize, parseExportFormat } from '../exportFormat.ts'

test('original keeps the clip shape, fitted within 1920x1080 with even sides', () => {
  assert.deepEqual(formatOutputSize('original', { width: 321, height: 181 }), { width: 320, height: 180 })
  assert.deepEqual(formatOutputSize('original', { width: 3840, height: 2160 }), { width: 1920, height: 1080 })
})

test('the presets have the desktop sizes whatever the source is', () => {
  const source = { width: 321, height: 181 }
  assert.deepEqual(formatOutputSize('vertical', source), { width: 1080, height: 1920 })
  assert.deepEqual(formatOutputSize('vertical-crop', source), { width: 1080, height: 1920 })
  assert.deepEqual(formatOutputSize('square', source), { width: 1080, height: 1080 })
})

test('the presets have the desktop bitrates and original has none', () => {
  assert.equal(formatBitrate('original'), null)
  assert.equal(formatBitrate('vertical'), '10M')
  assert.equal(formatBitrate('vertical-crop'), '10M')
  assert.equal(formatBitrate('square'), '8M')
})

test('the blurred-bars reframe is the desktop filter', () => {
  assert.equal(
    buildReframeStage('vertical', '[0:v:0]', '[main_v]'),
    '[0:v:0]split=2[reframe_bg_in][reframe_fg_in];' +
      '[reframe_bg_in]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20[reframe_bg];' +
      '[reframe_fg_in]scale=1080:1920:force_original_aspect_ratio=decrease[reframe_fg];' +
      '[reframe_bg][reframe_fg]overlay=(W-w)/2:(H-h)/2[main_v]'
  )
  assert.ok(buildReframeStage('square', '[0:v:0]', '[x]').includes('scale=1080:1080:force_original_aspect_ratio=increase'))
})

test('the cropped reframe fills the canvas with no blur', () => {
  assert.equal(
    buildReframeStage('vertical-crop', '[0:v:0]', '[main_v]'),
    '[0:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[main_v]'
  )
})

test('original has no reframe stage', () => {
  assert.throws(() => buildReframeStage('original', '[0:v:0]', '[main_v]'))
})

test('parseExportFormat accepts the four formats and falls back to original', () => {
  assert.equal(parseExportFormat('square', 'original'), 'square')
  assert.equal(parseExportFormat('vertical-crop', 'original'), 'vertical-crop')
  for (const bad of ['', 'wide', 3, null, undefined, {}, ['vertical']]) {
    assert.equal(parseExportFormat(bad, 'original'), 'original')
  }
})
