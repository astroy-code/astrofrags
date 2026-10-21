import { test, expect } from '@playwright/test'
import { FIXTURE_NAMES, exportAndSave, fixture, pickAndWaitReady, setRange } from './support'

test('the export button names what it exports', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await expect(page.getByTestId('export-button')).toHaveText('Export trimmed clip')

  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('clip-item')).toHaveCount(2)

  await expect(page.getByTestId('export-button')).toHaveText('Export reel')
})

test('editing the reel after an export clears the finished export', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await exportAndSave(page)
  await expect(page.getByTestId('export-status')).toContainText('Saved')

  await setRange(page, 'end-slider', 3)

  await expect(page.getByTestId('export-status')).toHaveCount(0)
})

test('a transition length typed out of range snaps to the limit that is used', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles([fixture(FIXTURE_NAMES.clip), fixture(FIXTURE_NAMES.clip)])
  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  const length = page.getByTestId('transition-seconds')
  await page.getByTestId('transitions-toggle').check()

  await length.fill('9')
  await length.blur()
  await expect(length).toHaveValue('2')

  await length.fill('0.01')
  await length.blur()
  await expect(length).toHaveValue('0.1')
})

test('the audio track picker is locked while an export runs', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.twoTrack)
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('cancel-button')).toBeVisible()

  await expect(page.getByTestId('audio-track')).toBeDisabled()
})
