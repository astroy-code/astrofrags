import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { FIXTURE_NAMES, exportAndSave, fixture, probe, setRange } from './support'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function pickClips(page: Page, names: readonly string[]): Promise<void> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(names.map(fixture))
  await expect(page.getByTestId('clip-item')).toHaveCount(names.length)
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 60_000 })
}

/** Selects the nth clip in the list and trims it to the first `seconds` seconds. */
async function trimClip(page: Page, index: number, seconds: number): Promise<void> {
  await page.getByTestId('clip-item').nth(index).locator('.clip-select').click()
  await setRange(page, 'end-slider', seconds)
}

test('two clips join into the sum of their lengths', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.clip])
  await trimClip(page, 0, 2)
  await trimClip(page, 1, 2)

  const { savedPath, suggestedName } = await exportAndSave(page)

  expect(suggestedName).toMatch(/-reel-2-clips\.mp4$/)
  expect(Math.abs(probe(savedPath).durationSeconds - 4)).toBeLessThan(0.4)
})

test('a transition shortens the reel by one duration', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.clip])
  await trimClip(page, 0, 2)
  await trimClip(page, 1, 2)
  await page.getByTestId('transitions-toggle').check()
  await page.getByTestId('transition-seconds').fill('1')

  const { savedPath } = await exportAndSave(page)

  expect(Math.abs(probe(savedPath).durationSeconds - 3)).toBeLessThan(0.4)
})

test('clips of different shapes, one without sound, export together', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.silent, FIXTURE_NAMES.portrait])
  await trimClip(page, 0, 2)
  await trimClip(page, 1, 2)
  await trimClip(page, 2, 2)

  const { savedPath, suggestedName } = await exportAndSave(page)

  const result = probe(savedPath)
  expect(suggestedName).toMatch(/-reel-3-clips\.mp4$/)
  expect(result.videoCodec).toBe('h264')
  expect(result.hasAudio).toBe(true)
  // The first clip is landscape 640x360, so the others fit inside that frame.
  expect([result.width, result.height]).toEqual([640, 360])
  expect(Math.abs(result.durationSeconds - 6)).toBeLessThan(0.5)
})

test('reordering changes the list and the name follows the first clip', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.silent])
  await trimClip(page, 0, 2)
  await trimClip(page, 1, 2)
  await expect(page.getByTestId('clip-item').first()).toContainText(FIXTURE_NAMES.clip)

  await page.getByTestId('clip-down').first().click()

  await expect(page.getByTestId('clip-item').first()).toContainText(FIXTURE_NAMES.silent)
  const { suggestedName } = await exportAndSave(page)
  expect(suggestedName).toMatch(/^silent-reel-2-clips\.mp4$/)
})

test('removing a clip down to one exports as a plain trim', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.silent])
  await page.getByTestId('clip-remove').nth(1).click()
  await expect(page.getByTestId('clip-item')).toHaveCount(1)
  await setRange(page, 'end-slider', 2)

  const { suggestedName } = await exportAndSave(page)

  expect(suggestedName).toMatch(/^clip-trim-\d+s-\d+s\.mp4$/)
})

test('the same file twice makes two items', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.clip])
  await expect(page.getByTestId('clip-item')).toHaveCount(2)
})

test('more clips can be added later', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip])
  await page.getByTestId('file-input').setInputFiles([fixture(FIXTURE_NAMES.silent), fixture(FIXTURE_NAMES.portrait)])
  await expect(page.getByTestId('clip-item')).toHaveCount(3)
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 60_000 })
})

test('transition options appear only with two or more clips', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip])
  await expect(page.getByTestId('transitions-toggle')).toHaveCount(0)

  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.silent))

  await expect(page.getByTestId('transitions-toggle')).toBeVisible()
})

test('transition settings persist across a reload', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.silent])
  await page.getByTestId('transitions-toggle').check()
  await page.getByTestId('transition-style').selectOption('zoomin')
  await page.getByTestId('transition-seconds').fill('1.5')

  await page.reload()
  await page.getByTestId('file-input').setInputFiles([fixture(FIXTURE_NAMES.clip), fixture(FIXTURE_NAMES.silent)])
  await expect(page.getByTestId('clip-item')).toHaveCount(2)

  await expect(page.getByTestId('transitions-toggle')).toBeChecked()
  await expect(page.getByTestId('transition-style')).toHaveValue('zoomin')
  await expect(page.getByTestId('transition-seconds')).toHaveValue('1.5')
})

test('a 0.5 s clip with a 2 s transition still exports at the clamped length', async ({ page }) => {
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.clip])
  await trimClip(page, 0, 0.5)
  await trimClip(page, 1, 2)
  await page.getByTestId('transitions-toggle').check()
  await page.getByTestId('transition-seconds').fill('2')

  const { savedPath } = await exportAndSave(page)

  // 0.5 + 2 less the 0.25 s transition (half the shortest clip).
  expect(Math.abs(probe(savedPath).durationSeconds - 2.25)).toBeLessThan(0.4)
})

test('the controls are locked while exporting, and starting over cancels it', async ({ page }) => {
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await pickClips(page, [FIXTURE_NAMES.clip, FIXTURE_NAMES.silent])

  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('cancel-button')).toBeVisible()
  await expect(page.getByTestId('file-input')).toBeDisabled()
  await expect(page.getByTestId('clip-remove').first()).toBeDisabled()
  await expect(page.getByTestId('clip-down').first()).toBeDisabled()
  await expect(page.getByTestId('end-slider')).toBeDisabled()

  await page.getByTestId('start-over').click()

  await expect(page.getByTestId('clip-item')).toHaveCount(0)
  await page.waitForTimeout(3000)
  expect(downloads).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ userAgent: IPHONE_UA, hasTouch: true })

  test('warns above six clips but does not block', async ({ page }) => {
    await pickClips(page, Array.from({ length: 7 }, () => FIXTURE_NAMES.clip))

    await expect(page.getByTestId('notice').filter({ hasText: '7 clips' })).toBeVisible()
    await expect(page.getByTestId('export-button')).toBeEnabled()
  })
})
