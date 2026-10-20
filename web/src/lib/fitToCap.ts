import { effectiveTransitionSeconds, reelSeconds } from './transitions.ts'
import type { TrimRange } from './trimRange.ts'

/** The Shorts/Reels length limit the vertical formats are sized for. */
export const SHORTS_CAP_SECONDS = 180

export interface FitInput {
  readonly ranges: readonly TrimRange[]
  readonly capSeconds: number
  /** Total length of the intro and outro cards that are on. */
  readonly cardSeconds: number
  /** The requested crossfade length, or null for hard cuts; it is clamped per reel like the export does. */
  readonly transitionSeconds: number | null
  /** No clip is shortened below this. */
  readonly minClipSeconds: number
}

// Shortening a clip can also shorten the crossfade (it is limited to half the shortest clip), which
// lengthens the reel a little again, so the fit is repeated until it settles.
const MAX_PASSES = 6
const EPSILON = 1e-6

const lengthOf = (range: TrimRange): number => range.end - range.start

function exportedSeconds(ranges: readonly TrimRange[], cardSeconds: number, requested: number | null): number {
  const lengths = ranges.map(lengthOf)
  const overlap = requested !== null && ranges.length > 1 ? effectiveTransitionSeconds(requested, lengths) : null
  return reelSeconds(lengths, overlap) + cardSeconds
}

/** Desktop's rule: shrink around the clip's middle so the highlight moment stays centred. */
function shrink(range: TrimRange, ratio: number, minClipSeconds: number): TrimRange {
  const length = lengthOf(range)
  const target = Math.min(length, Math.max(minClipSeconds, length * ratio))
  const cut = length - target
  return { start: range.start + cut / 2, end: range.end - cut / 2 }
}

/**
 * Shortens every clip in proportion so the exported reel (clips, less crossfade overlap, plus
 * cards) fits `capSeconds`. A reel that already fits is returned as it is; a clip is never
 * lengthened or pushed outside its original range.
 */
export function fitReelToCap({
  ranges,
  capSeconds,
  cardSeconds,
  transitionSeconds,
  minClipSeconds
}: FitInput): readonly TrimRange[] {
  let current = ranges
  for (let pass = 0; pass < MAX_PASSES && current.length > 0; pass += 1) {
    const total = exportedSeconds(current, cardSeconds, transitionSeconds)
    if (total <= capSeconds + EPSILON) break
    const clipSum = current.reduce((sum, range) => sum + lengthOf(range), 0)
    const ratio = (clipSum - (total - capSeconds)) / clipSum
    const next = current.map((range) => shrink(range, ratio, minClipSeconds))
    if (next.every((range, i) => lengthOf(range) === lengthOf(current[i]))) break
    current = next
  }
  return current
}
