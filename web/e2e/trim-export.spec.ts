import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import ffmpegPath from 'ffmpeg-static'

// Playwright loads this file as CommonJS, so __dirname is available and import.meta is not.
const FIXTURE_NAMES: Record<'clip' | 'silent' | 'awkward' | 'audioOnly', string> = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'names.json'), 'utf8')
)
const FIXTURE_DIR = join(__dirname, '.fixtures')
const fixture = (name: string): string => join(FIXTURE_DIR, name)
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

interface Probe {
  readonly videoCodec: string | null
  readonly hasAudio: boolean
  readonly durationSeconds: number
}

/** `ffmpeg -i` exits non-zero without an output but prints the stream listing to stderr. */
function probe(filePath: string): Probe {
  let stderr = ''
  try {
    execFileSync(ffmpegPath as string, ['-i', filePath], { stdio: 'pipe' })
  } catch (error) {
    stderr = String((error as { stderr?: Buffer }).stderr ?? '')
  }
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const [h, m, s] = duration ? duration.slice(1).map(Number) : [0, 0, 0]
  return {
    videoCodec: /Video: (\w+)/.exec(stderr)?.[1] ?? null,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr),
    durationSeconds: h * 3600 + m * 60 + s
  }
}

async function setRange(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).evaluate((el, next) => {
    const input = el as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function pickAndWaitReady(page: Page, fileName: string): Promise<void> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(fileName))
  await expect(page.getByTestId('export-button')).toBeEnabled()
}

async function exportAndSave(page: Page): Promise<{ savedPath: string; suggestedName: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-button').click()
  ])
  const savedPath = join(mkdtempSync(join(tmpdir(), 'astrofrags-e2e-')), download.suggestedFilename())
  await download.saveAs(savedPath)
  return { savedPath, suggestedName: download.suggestedFilename() }
}

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

test('exports a clip with no audio stream', async ({ page }) => {
  await pickAndWaitReady(page, FIXTURE_NAMES.silent)
  await setRange(page, 'end-slider', 3)

  const { savedPath } = await exportAndSave(page)

  const result = probe(savedPath)
  expect(result.videoCodec).toBe('h264')
  expect(result.hasAudio).toBe(false)
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

/** Holds the first ffmpeg core download so the engine is still loading when the test acts. */
async function delayFirstCoreLoad(page: Page, delayMs: number): Promise<void> {
  let requests = 0
  await page.route('**/ffmpeg-core.wasm', async (route) => {
    requests += 1
    if (requests === 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
}

test('cancel is honored immediately while the engine is still loading', async ({ page }) => {
  await delayFirstCoreLoad(page, 6000)
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))

  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()
  await page.getByTestId('export-button').click()
  await page.getByTestId('cancel-button').click()

  // The engine load takes 6 s; the UI must not wait for it.
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 2000 })
  await page.waitForTimeout(9000)
  await expect(page.getByTestId('export-status')).toBeHidden()
  expect(downloads).toEqual([])
})

test('picking another video during an export cancels it', async ({ page }) => {
  await delayFirstCoreLoad(page, 4000)
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))

  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('export-button')).toBeEnabled()
  await page.getByTestId('export-button').click()
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
