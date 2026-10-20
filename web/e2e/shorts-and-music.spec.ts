import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { FIXTURE_NAMES, exportAndSave, fixture, meanVolumeDb, pickAndWaitReady, setRange } from './support'

async function pickLong(page: Page): Promise<void> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.long))
  await expect(page.getByTestId('reel-total')).toContainText('3:20.0')
}

test('the Shorts cap and the Fit button appear only for a vertical format over 3:00', async ({ page }) => {
  await pickLong(page)
  // The original format has no cap.
  await expect(page.getByTestId('reel-total')).not.toContainText('Shorts')
  await expect(page.getByTestId('fit-to-cap')).toHaveCount(0)

  await page.getByTestId('export-format').selectOption('vertical')

  await expect(page.getByTestId('reel-total')).toContainText('3:20.0 / 3:00 for Shorts')
  await expect(page.getByTestId('fit-to-cap')).toBeVisible()
})

test('Fit to 3:00 shortens the reel to exactly the cap and the button goes away', async ({ page }) => {
  await pickLong(page)
  await page.getByTestId('export-format').selectOption('vertical-crop')

  await page.getByTestId('fit-to-cap').click()

  await expect(page.getByTestId('reel-total')).toContainText('3:00.0 / 3:00 for Shorts')
  await expect(page.getByTestId('fit-to-cap')).toHaveCount(0)
})

test('Fit to 3:00 leaves room for the cards', async ({ page }) => {
  await pickLong(page)
  await page.getByTestId('export-format').selectOption('vertical')
  await page.getByTestId('intro-toggle').check()
  await page.getByTestId('outro-toggle').check()
  await page.getByTestId('card-seconds').fill('3')
  await expect(page.getByTestId('reel-total')).toContainText('3:26.0')

  await page.getByTestId('fit-to-cap').click()

  await expect(page.getByTestId('reel-total')).toContainText('3:00.0 / 3:00 for Shorts')
})

test('a reel under the cap shows its length but no Fit button', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await page.getByTestId('export-format').selectOption('square')
  await page.getByTestId('export-format').selectOption('vertical')

  await expect(page.getByTestId('reel-total')).toContainText('0:06.0 / 3:00 for Shorts')
  await expect(page.getByTestId('fit-to-cap')).toHaveCount(0)
})

test('music only appears with music and drops the clips’ own sound', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await expect(page.getByTestId('mute-original')).toHaveCount(0)
  // Silent music over a loud clip: whatever is heard in the export is the clip's own sound.
  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.silenceMusic))
  await expect(page.getByTestId('music-name')).toBeVisible()

  const kept = await exportAndSave(page)
  expect(meanVolumeDb(kept.savedPath)).toBeGreaterThan(-40)

  await page.getByTestId('mute-original').check()
  const muted = await exportAndSave(page)
  expect(meanVolumeDb(muted.savedPath)).toBeLessThan(-80)
})

test('music only plays the music', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.silent)
  await setRange(page, 'end-slider', 2)
  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.music))
  await expect(page.getByTestId('music-name')).toBeVisible()
  await page.getByTestId('mute-original').check()

  const { savedPath } = await exportAndSave(page)

  expect(meanVolumeDb(savedPath)).toBeGreaterThan(-40)
})

test('removing the music switches music only off again', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.music))
  await page.getByTestId('mute-original').check()

  await page.getByTestId('music-clear').click()
  await expect(page.getByTestId('mute-original')).toHaveCount(0)
  await page.getByTestId('music-input').setInputFiles(fixture(FIXTURE_NAMES.music))

  await expect(page.getByTestId('mute-original')).not.toBeChecked()
})
