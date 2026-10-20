import type { Size } from './outputGeometry.ts'
import type { Platform } from './sizeLimit.ts'

export interface EstimateInput {
  readonly durationSeconds: number
  readonly output: Size
  readonly hasCards: boolean
  readonly platform: Platform
}

// A rule of thumb, not a measurement: encoding in the browser runs on one thread, so time scales
// with output seconds and pixels. These are starting guesses to tune against real devices.
const REFERENCE_PIXELS = 1920 * 1080
const ENCODE_SECONDS_PER_OUTPUT_SECOND = 1.2
const ENGINE_START_SECONDS = 3
const PHONE_MULTIPLIER = 3
const CARD_MULTIPLIER = 1.15
const CARD_EXTRA_SECONDS = 2

export function estimateExportSeconds({ durationSeconds, output, hasCards, platform }: EstimateInput): number {
  const pixelRatio = (output.width * output.height) / REFERENCE_PIXELS
  const encoding = Math.max(0, durationSeconds) * pixelRatio * ENCODE_SECONDS_PER_OUTPUT_SECOND
  const withCards = hasCards ? encoding * CARD_MULTIPLIER + CARD_EXTRA_SECONDS : encoding
  const withPlatform = withCards * (platform === 'mobile' ? PHONE_MULTIPLIER : 1)
  return Math.max(1, Math.ceil(withPlatform + ENGINE_START_SECONDS))
}
