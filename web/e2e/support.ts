import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import ffmpegPath from 'ffmpeg-static'

// Playwright loads these files as CommonJS, so __dirname is available and import.meta is not.
export const FIXTURE_NAMES: Record<
  'clip' | 'silent' | 'awkward' | 'audioOnly' | 'twoTrack' | 'music' | 'notAudio',
  string
> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'names.json'), 'utf8'))
const FIXTURE_DIR = join(__dirname, '.fixtures')
export const fixture = (name: string): string => join(FIXTURE_DIR, name)

export interface Probe {
  readonly videoCodec: string | null
  readonly hasAudio: boolean
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
}

/** `ffmpeg -i` exits non-zero without an output but prints the stream listing to stderr. */
export function probe(filePath: string): Probe {
  let stderr = ''
  try {
    execFileSync(ffmpegPath as string, ['-i', filePath], { stdio: 'pipe' })
  } catch (error) {
    stderr = String((error as { stderr?: Buffer }).stderr ?? '')
  }
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const [h, m, s] = duration ? duration.slice(1).map(Number) : [0, 0, 0]
  const size = /Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
  return {
    videoCodec: /Video: (\w+)/.exec(stderr)?.[1] ?? null,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr),
    durationSeconds: h * 3600 + m * 60 + s,
    width: Number(size?.[1] ?? 0),
    height: Number(size?.[2] ?? 0)
  }
}

/** Mean loudness of the first audio stream via ffmpeg's volumedetect; -Infinity for digital silence. */
export function meanVolumeDb(filePath: string): number {
  const { stderr } = spawnSync(
    ffmpegPath as string,
    ['-i', filePath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  const match = /mean_volume: (-inf|-?[\d.]+) dB/.exec(stderr)
  if (!match) throw new Error(`volumedetect printed no mean_volume:\n${stderr.slice(-400)}`)
  return match[1] === '-inf' ? -Infinity : Number(match[1])
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** One pixel of a video frame (or image) as RGB, at `seconds` into the file. */
export function pixelAt(filePath: string, seconds: number, x: number, y: number): Rgb {
  const { stdout, stderr } = spawnSync(
    ffmpegPath as string,
    [
      '-loglevel', 'error', '-ss', String(seconds), '-i', filePath,
      '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-'
    ],
    { encoding: 'buffer' }
  )
  if (stdout.length < 3) throw new Error(`no pixel at ${x},${y} @ ${seconds}s: ${String(stderr)}`)
  return { r: stdout[0], g: stdout[1], b: stdout[2] }
}

export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The grey values (0-255, row by row) of a region of a frame, `seconds` into the file. */
function grayRegion(filePath: string, seconds: number, region: Region): Buffer {
  const { x, y, width, height } = region
  const { stdout, stderr } = spawnSync(
    ffmpegPath as string,
    [
      '-loglevel', 'error', '-ss', String(seconds), '-i', filePath,
      '-frames:v', '1', '-vf', `format=gray,crop=${width}:${height}:${x}:${y}`, '-f', 'rawvideo', '-'
    ],
    { encoding: 'buffer' }
  )
  if (stdout.length !== width * height) {
    throw new Error(`no ${width}x${height} region at ${x},${y} @ ${seconds}s: ${String(stderr)}`)
  }
  return stdout
}

/** The brightest grey value (0-255) inside a region of a frame, at `seconds` into the file. */
export function maxLuma(filePath: string, seconds: number, region: Region): number {
  return Math.max(...grayRegion(filePath, seconds, region))
}

/**
 * Mean absolute grey difference (0-255) between the same region of two same-sized videos, each
 * read `seconds` in. Used to see whether something was drawn over the source picture.
 */
export function meanRegionDifference(fileA: string, fileB: string, seconds: number, region: Region): number {
  const a = grayRegion(fileA, seconds, region)
  const b = grayRegion(fileB, seconds, region)
  let total = 0
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i])
  return total / a.length
}

/** Largest per-channel difference between two colours. */
export const colourDistance = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))

export async function setRange(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).evaluate((el, next) => {
    const input = el as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

export async function pickAndWaitReady(page: Page, fileName: string): Promise<void> {
  await page.goto('./')
  await page.getByTestId('file-input').setInputFiles(fixture(fileName))
  await expect(page.getByTestId('export-button')).toBeEnabled()
}

export async function exportAndSave(page: Page): Promise<{ savedPath: string; suggestedName: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-button').click()
  ])
  const savedPath = join(mkdtempSync(join(tmpdir(), 'astrofrags-e2e-')), download.suggestedFilename())
  await download.saveAs(savedPath)
  return { savedPath, suggestedName: download.suggestedFilename() }
}
