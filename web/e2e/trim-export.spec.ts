import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  FIXTURE_NAMES,
  exportAndSave,
  fixture,
  meanVolumeDb,
  pickAndWaitReady,
  probe,
  setRange
} from './support'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

test('trims a clip and downloads an H.264 mp4', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'start-slider', 1)
  await setRange(page, 'end-slider', 4)

  const { savedPath, suggestedName } = await exportAndSave(page)

  expect(suggestedName.endsWith('.mp4')).toBe(true)
  const result = probe(savedPath)
  expect(result.videoCodec).toBe('h264')
  expect(result.hasAudio).toBe(true)
  expect(Math.abs(result.durationSeconds - 3)).toBeLessThan(0.3)
})

test('makes no network requests outside its own origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL as string).origin
  const external: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith('blob:') && !url.startsWith('data:') && new URL(url).origin !== origin) {
      external.push(url)
    }
  })

  await pickAndWaitReady(page, FIXTURE_NAMES.clip)
  await setRange(page, 'end-slider', 2)
  await exportAndSave(page)

  expect(external).toEqual([])
})

test('picks the loudest audio track and lets the user override it', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.twoTrack)
  const picker = page.getByTestId('audio-track')
  await expect(picker).toBeVisible()
  // Track 1 is silent; the loud one is track 2 (index 1) and must be chosen automatically.
  await expect(picker).toHaveValue('1')
  await setRange(page, 'end-slider', 3)

  const loud = await exportAndSave(page)
  expect(meanVolumeDb(loud.savedPath)).toBeGreaterThan(-40)

  await picker.selectOption('0')
  const silent = await exportAndSave(page)
  expect(meanVolumeDb(silent.savedPath)).toBeLessThan(-80)
})

test('exports a clip with no audio stream, giving it a silent audio track', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.silent)
  await setRange(page, 'end-slider', 3)

  const { savedPath } = await exportAndSave(page)

  const result = probe(savedPath)
  expect(result.videoCodec).toBe('h264')
  // The export graph always carries audio (generated silence here) so cards, music and loudness
  // normalization work the same for every clip.
  expect(result.hasAudio).toBe(true)
  expect(meanVolumeDb(savedPath)).toBeLessThan(-80)
})

test('handles an awkward file name', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.awkward)
  await setRange(page, 'end-slider', 3)

  const { suggestedName } = await exportAndSave(page)

  expect(suggestedName).toMatch(/^Valorant_2026_clip-trim-\d+s-\d+s\.mp4$/)
})

test('cancel returns to ready and a second export works', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.clip)

  await page.getByTestId('export-button').click()
  await page.getByTestId('cancel-button').click()
  await expect(page.getByTestId('export-button')).toBeEnabled()
  // Idle shows no status; a finished export would show "Saved: ..." here, meaning cancel lost the race.
  await expect(page.getByTestId('export-status')).toBeHidden()

  const { savedPath } = await exportAndSave(page)
  expect(probe(savedPath).videoCodec).toBe('h264')
})

/**
 * Lets the first ffmpeg core download through, then holds every reload (the engine reloads
 * after a cancel terminates it) so a test can act while it is still loading.
 */
async function delayReloads(page: Page, delayMs: number): Promise<void> {
  let requests = 0
  await page.route('**/ffmpeg-core.wasm', async (route) => {
    requests += 1
    if (requests > 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
}

/** Starts an export and cancels it mid-run, which terminates the engine and forces a reload. */
async function exportThenCancel(page: Page): Promise<void> {
  await page.getByTestId('export-button').click()
  await page.getByTestId('cancel-button').click()
  await expect(page.getByTestId('export-button')).toBeEnabled()
  // Idle shows no status; "Saved: ..." here would mean the export finished before the cancel landed.
  await expect(page.getByTestId('export-status')).toBeHidden()
}

test('cancel is honored immediately while the engine is reloading', async ({ page }) => {
  await delayReloads(page, 6000)
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))

  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()
  await exportThenCancel(page)

  await page.getByTestId('export-button').click()
  await page.getByTestId('cancel-button').click()

  // The engine reload takes 6 s; the UI must not wait for it.
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 2000 })
  await page.waitForTimeout(9000)
  await expect(page.getByTestId('export-status')).toBeHidden()
  expect(downloads).toEqual([])
})

test('starting over during an export cancels it', async ({ page }) => {
  await delayReloads(page, 4000)
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))

  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()
  await exportThenCancel(page)

  // The second export now waits on the delayed engine reload when the user starts over. The
  // picker is locked while exporting, so starting over is the way to a different video.
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('file-input')).toBeDisabled()
  await page.getByTestId('start-over').click()
  await expect(page.getByTestId('export-button')).toBeHidden()
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.silent))

  await page.waitForTimeout(9000)
  // The first video's export must neither be delivered nor reported as done under the new video.
  expect(downloads).toEqual([])
  await expect(page.getByTestId('export-status')).toBeHidden()
  await expect(page.getByTestId('export-button')).toBeEnabled()
})

test.describe('on a phone', () => {
  test.use({ userAgent: IPHONE_UA, hasTouch: true })

  test('waits for a tap before saving the exported clip', async ({ page }) => {
    // No Web Share in this browser, so the tap falls back to a normal download.
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }))
    const downloads: string[] = []
    page.on('download', (download) => downloads.push(download.suggestedFilename()))

    await pickAndWaitReady(page, FIXTURE_NAMES.clip)
    await setRange(page, 'end-slider', 2)
    await page.getByTestId('export-button').click()

    await expect(page.getByTestId('deliver-button')).toBeVisible({ timeout: 20_000 })
    expect(downloads).toEqual([])

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('deliver-button').click()
    ])
    expect(download.suggestedFilename()).toMatch(/-trim-\d+s-\d+s\.mp4$/)
  })

  test('warns but does not block an over-limit file', async ({ page }) => {
    await page.goto('./?softLimitBytes=1000')
    await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))

    const warning = page.getByTestId('notice').filter({ hasText: 'large for a phone browser' })
    await expect(warning).toBeVisible()
    await expect(page.getByTestId('export-button')).toBeEnabled()

    await page.getByRole('button', { name: 'Try anyway' }).click()
    await expect(warning).toBeHidden()
    await expect(page.getByTestId('export-button')).toBeEnabled()
  })
})

test('shows the undecodable message when the video cannot be decoded', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.audioOnly))

  await expect(page.getByTestId('notice').filter({ hasText: 'desktop app' })).toBeVisible()
  await expect(page.getByTestId('export-button')).toBeDisabled()
})
