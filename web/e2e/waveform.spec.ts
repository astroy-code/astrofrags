import { test, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { FIXTURE_NAMES, fixture, setRange } from './support'

const DURATION = 40 // bursts.webm: loud bursts at about 10 s and 30 s

async function openWaveform(page: Page): Promise<Locator> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.bursts))
  await expect(page.getByTestId('find-highlights')).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByTestId('waveform')).toHaveCount(0)
  await page.getByTestId('find-highlights').click()
  const canvas = page.getByTestId('waveform')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  return canvas
}

/** The page x of a time, in the fitted (whole recording) view. */
async function xAt(canvas: Locator, seconds: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox()
  if (!box) throw new Error('the waveform has no box')
  return { x: box.x + (seconds / DURATION) * box.width, y: box.y + box.height / 2 }
}

const zoomOf = async (canvas: Locator): Promise<number> => Number(await canvas.getAttribute('data-zoom'))

test('the waveform appears after finding highlights, with a marker for each moment', async ({ page }) => {
  const canvas = await openWaveform(page)

  await expect(canvas).toHaveAttribute('data-markers', '2')
  const box = await canvas.boundingBox()
  expect(box?.height).toBeGreaterThan(60)
  expect(await zoomOf(canvas)).toBeCloseTo((box?.width ?? 0) / DURATION, 1)
})

test('zoom buttons zoom in and out, Fit returns to the whole recording, Selection zooms to the trim', async ({ page }) => {
  const canvas = await openWaveform(page)
  const fitted = await zoomOf(canvas)

  await page.getByTestId('waveform-zoom-in').click()
  expect(await zoomOf(canvas)).toBeGreaterThan(fitted * 1.5)

  await page.getByTestId('waveform-zoom-out').click()
  await page.getByTestId('waveform-zoom-out').click()
  expect(await zoomOf(canvas)).toBeCloseTo(fitted, 1)

  await setRange(page, 'end-slider', 8)
  await page.getByTestId('waveform-selection').click()
  expect(await zoomOf(canvas)).toBeGreaterThan(fitted * 3)

  await page.getByTestId('waveform-fit').click()
  expect(await zoomOf(canvas)).toBeCloseTo(fitted, 1)
})

test('tapping a marker adds a clip around that moment', async ({ page }) => {
  const canvas = await openWaveform(page)
  const { x, y } = await xAt(canvas, 10.2)

  await page.mouse.click(x, y)

  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await expect(page.getByTestId('clip-item').nth(1)).toContainText('0:08.0')
})

test('tapping the waveform away from a marker moves the video there', async ({ page }) => {
  const canvas = await openWaveform(page)
  const { x, y } = await xAt(canvas, 20)

  await page.mouse.click(x, y)

  await expect
    .poll(() => page.getByTestId('player').evaluate((video) => (video as HTMLVideoElement).currentTime))
    .toBeGreaterThan(18)
  await expect(page.getByTestId('clip-item')).toHaveCount(1)
})

test('dragging a handle trims the clip, and the end handle cannot cross the start', async ({ page }) => {
  const canvas = await openWaveform(page)
  const startHandle = await xAt(canvas, 0)
  const target = await xAt(canvas, 20)

  await page.mouse.move(startHandle.x + 3, startHandle.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  await page.mouse.up()
  const start = Number(await page.getByTestId('start-slider').inputValue())
  expect(start).toBeGreaterThan(18)
  expect(start).toBeLessThan(22)

  const endHandle = await xAt(canvas, DURATION)
  const past = await xAt(canvas, 5)
  await page.mouse.move(endHandle.x - 3, endHandle.y)
  await page.mouse.down()
  await page.mouse.move(past.x, past.y, { steps: 8 })
  await page.mouse.up()
  const end = Number(await page.getByTestId('end-slider').inputValue())
  expect(end).toBeCloseTo(start + 0.5, 1)
})

test('Add clip here adds a clip around the playhead', async ({ page }) => {
  const canvas = await openWaveform(page)
  const { x, y } = await xAt(canvas, 20)
  await page.mouse.click(x, y)
  await expect
    .poll(() => page.getByTestId('player').evaluate((video) => (video as HTMLVideoElement).currentTime))
    .toBeGreaterThan(18)

  await page.getByTestId('add-clip-here').click()

  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await expect(page.getByTestId('clip-item').nth(1)).toContainText('0:08.0')
})

test('a clip that has not been scanned shows no waveform', async ({ page }) => {
  await openWaveform(page)

  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.clip))
  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await page.getByTestId('clip-item').nth(1).locator('.clip-select').click()

  await expect(page.getByTestId('waveform')).toHaveCount(0)
})

test('the handles are locked while an export runs', async ({ page }) => {
  const canvas = await openWaveform(page)
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 60_000 })

  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('cancel-button')).toBeVisible()

  await expect(canvas).toHaveAttribute('data-locked', 'true')
  await page.getByTestId('cancel-button').click()
})
