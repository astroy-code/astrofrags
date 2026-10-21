import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { FIXTURE_NAMES, fixture } from './support'

async function pickAndFind(page: Page, name: string): Promise<void> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(name))
  await expect(page.getByTestId('find-highlights')).toBeEnabled({ timeout: 60_000 })
}

test('finding highlights lists the loud moments at their times', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.bursts)

  await page.getByTestId('find-highlights').click()

  const moments = page.getByTestId('highlight-moment')
  await expect(moments).toHaveCount(2)
  await expect(moments.nth(0)).toContainText('0:10')
  await expect(moments.nth(1)).toContainText('0:30')
})

test('tapping a moment adds a clip around it, and tapping it again selects that clip', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.bursts)
  await page.getByTestId('find-highlights').click()
  await expect(page.getByTestId('highlight-moment')).toHaveCount(2)

  await page.getByTestId('highlight-moment').nth(0).click()

  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await expect(page.getByTestId('clip-item').nth(1)).toContainText('0:08.0')
  await expect(page.getByTestId('clip-item').nth(1).locator('.clip-select')).toHaveAttribute('aria-pressed', 'true')
  // The list stays, so the next moment is one tap away.
  await expect(page.getByTestId('highlight-moment')).toHaveCount(2)

  await page.getByTestId('clip-item').nth(0).locator('.clip-select').click()
  await page.getByTestId('highlight-moment').nth(0).click()

  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await expect(page.getByTestId('clip-item').nth(1).locator('.clip-select')).toHaveAttribute('aria-pressed', 'true')
})

test('building a reel replaces the recording with its highlights in time order', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.bursts)
  await page.getByTestId('find-highlights').click()
  await expect(page.getByTestId('highlight-moment')).toHaveCount(2)

  await page.getByTestId('build-from-highlights').click()

  await expect(page.getByTestId('clip-item')).toHaveCount(2)
  await expect(page.getByTestId('clip-item').nth(0)).toContainText('0:08.0')
  await expect(page.getByTestId('clip-item').nth(1)).toContainText('0:08.0')
  await expect(page.getByTestId('export-button')).toHaveText('Export reel')
})

test('a video with no sound says so and offers no search', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.silent))

  await expect(page.getByTestId('highlights-status')).toContainText('No sound to analyze')
  await expect(page.getByTestId('find-highlights')).toHaveCount(0)
})

test('a quiet recording with nothing standing out says so', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.clip)

  await page.getByTestId('find-highlights').click()

  await expect(page.getByTestId('highlights-status')).toContainText('No standout moments')
})

test('cancelling the search leaves no result and the search can run again', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.lengthy)
  await page.getByTestId('find-highlights').click()
  await expect(page.getByTestId('highlights-cancel')).toBeVisible()

  await page.getByTestId('highlights-cancel').click()

  await expect(page.getByTestId('highlights-cancel')).toHaveCount(0)
  await expect(page.getByTestId('highlight-moment')).toHaveCount(0)
  await expect(page.getByTestId('find-highlights')).toBeEnabled()
})

test('starting over during the search leaves an empty page that still works', async ({ page }) => {
  await pickAndFind(page, FIXTURE_NAMES.lengthy)
  await page.getByTestId('find-highlights').click()
  await expect(page.getByTestId('highlights-cancel')).toBeVisible()

  await page.getByTestId('start-over').click()
  await expect(page.getByTestId('clip-item')).toHaveCount(0)

  await page.getByTestId('file-input').setInputFiles(fixture(FIXTURE_NAMES.bursts))
  await expect(page.getByTestId('find-highlights')).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByTestId('highlight-moment')).toHaveCount(0)
})
