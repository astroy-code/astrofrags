import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  FIXTURE_NAMES,
  colourDistance,
  exportAndSave,
  fixture,
  maxLuma,
  meanRegionDifference,
  meanVolumeDb,
  pickAndWaitReady,
  pixelAt,
  probe,
  setRange
} from './support'

// The clip fixtures are 640x360, so the output is 640x360 and the 1080p layout is scaled by 1/3.
// The logo is scaled to 53 px and placed 8 px from the bottom-right corner.
const WATERMARK_REGION = { x: 579, y: 299, width: 53, height: 53 }
// A same-sized stretch of busy picture (colour bars, the gradient strip and a bar edge) with no logo on it.
const UNTOUCHED_REGION = { x: 40, y: 270, width: 53, height: 53 }
// Where the lower-third box and text land; the test pattern is black there, so only text can be bright.
const LOWER_THIRD_REGION = { x: 14, y: 330, width: 62, height: 17 }
const CARD_CORNER = { x: 10, y: 10 }
const COLOUR_TOLERANCE = 16
const TEXT_BRIGHTNESS = 100

async function enableCards(page: Page, seconds: number): Promise<void> {
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('outro-toggle').check()
  await page.getByTestId('card-seconds').fill(String(seconds))
}

test('intro and outro add two card durations', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await enableCards(page, 2)

  const { savedPath } = await exportAndSave(page)

  expect(Math.abs(probe(savedPath).durationSeconds - 6)).toBeLessThan(0.4)
})

test('the first frame of the intro is the accent colour', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await page.getByTestId('accent-color').fill('#c81e1e')
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('card-seconds').fill('2')

  const { savedPath } = await exportAndSave(page)

  // One second in, after the 0.5 s fade-in, away from the logo and the name.
  const corner = pixelAt(savedPath, 1, CARD_CORNER.x, CARD_CORNER.y)
  expect(colourDistance(corner, { r: 0xc8, g: 0x1e, b: 0x1e })).toBeLessThan(COLOUR_TOLERANCE)
})

test('music is audible over a clip with no audio', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.silent)
  await setRange(page, 'end-slider', 3)
  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.music))
  await expect(page.getByTestId('music-name')).toBeVisible()

  const { savedPath } = await exportAndSave(page)

  expect(meanVolumeDb(savedPath)).toBeGreaterThan(-40)
})

test('a long name and an emoji name still export', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('card-seconds').fill('1')

  await page.getByTestId('display-name').fill('W'.repeat(200))
  const long = await exportAndSave(page)
  expect(probe(long.savedPath).videoCodec).toBe('h264')

  await page.getByTestId('display-name').fill('🎯 Ünïcode')
  await page.getByTestId('lower-third-toggle').check()
  const emoji = await exportAndSave(page)
  expect(probe(emoji.savedPath).videoCodec).toBe('h264')
})

test('the watermark is on every plain export', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)

  const { savedPath } = await exportAndSave(page)

  // Same-sized regions compared with the source picture: the default corner (bottom right) holds
  // the logo, so it differs far more than a stretch of picture that was only re-encoded.
  const source = fixture(FIXTURE_NAMES.clip)
  const logoDifference = meanRegionDifference(savedPath, source, 1, WATERMARK_REGION)
  const untouchedDifference = meanRegionDifference(savedPath, source, 1, UNTOUCHED_REGION)
  expect(logoDifference).toBeGreaterThan(untouchedDifference * 3 + 2)
})

test('lower-third text appears', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  const without = await exportAndSave(page)

  await page.getByTestId('lower-third-toggle').check()
  await page.getByTestId('lower-third-text').fill('Clutch round')
  const withText = await exportAndSave(page)

  expect(maxLuma(without.savedPath, 1, LOWER_THIRD_REGION)).toBeLessThan(TEXT_BRIGHTNESS)
  expect(maxLuma(withText.savedPath, 1, LOWER_THIRD_REGION)).toBeGreaterThan(TEXT_BRIGHTNESS)
})

test('settings persist across a reload', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await page.getByTestId('display-name').fill('Team Rocket')
  await page.getByTestId('accent-color').fill('#123456')
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('card-seconds').fill('5')
  await page.getByTestId('lower-third-toggle').check()
  await page.getByTestId('lower-third-text').fill('Blasting off')
  await page.getByTestId('watermark-corner').selectOption('top-left')

  await page.reload()
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()

  await expect(page.getByTestId('display-name')).toHaveValue('Team Rocket')
  await expect(page.getByTestId('accent-color')).toHaveValue('#123456')
  await expect(page.getByTestId('intro-toggle')).toBeChecked()
  await expect(page.getByTestId('outro-toggle')).not.toBeChecked()
  await expect(page.getByTestId('card-seconds')).toHaveValue('5')
  await expect(page.getByTestId('lower-third-toggle')).toBeChecked()
  await expect(page.getByTestId('lower-third-text')).toHaveValue('Blasting off')
  await expect(page.getByTestId('watermark-corner')).toHaveValue('top-left')
})

test('a non-audio music file is rejected and the export still works', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)

  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.notAudio))

  await expect(page.getByTestId('music-error')).toBeVisible()
  await expect(page.getByTestId('music-name')).toBeHidden()
  const { savedPath } = await exportAndSave(page)
  expect(probe(savedPath).videoCodec).toBe('h264')
})

test('the estimate is shown before exporting', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)

  await expect(page.getByTestId('export-estimate')).toHaveText(/About \d+ s/)
})

const FORMAT_SIZES = [
  ['vertical', 1080, 1920],
  ['vertical-crop', 1080, 1920],
  ['square', 1080, 1080]
] as const

for (const [format, width, height] of FORMAT_SIZES) {
  test(`the ${format} export format gives a ${width}x${height} video`, async ({ page }) => {
    await pickAndWaitReady(page, FIXTURE_NAMES.clip)
    await setRange(page, 'end-slider', 2)
    await page.getByTestId('export-format').selectOption(format)

    const { savedPath } = await exportAndSave(page)

    const result = probe(savedPath)
    expect(result.videoCodec).toBe('h264')
    expect([result.width, result.height]).toEqual([width, height])
    expect(Math.abs(result.durationSeconds - 2)).toBeLessThan(0.4)
  })
}

test('a vertical export carries portrait cards and the watermark in its corner', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await page.getByTestId('export-format').selectOption('vertical')
  await page.getByTestId('accent-color').fill('#c81e1e')
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('card-seconds').fill('2')

  const { savedPath } = await exportAndSave(page)

  const result = probe(savedPath)
  expect([result.width, result.height]).toEqual([1080, 1920])
  expect(Math.abs(result.durationSeconds - 4)).toBeLessThan(0.4)
  const card = pixelAt(savedPath, 1, 30, 30)
  expect(colourDistance(card, { r: 0xc8, g: 0x1e, b: 0x1e })).toBeLessThan(COLOUR_TOLERANCE)
})

test('the export format is remembered across a reload', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await expect(page.getByTestId('export-format')).toHaveValue('original')
  await page.getByTestId('export-format').selectOption('square')

  await page.reload()
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()

  await expect(page.getByTestId('export-format')).toHaveValue('square')
})
