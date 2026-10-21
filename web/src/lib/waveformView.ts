import type { Peak } from './highlights.ts'
import type { TrimRange } from './trimRange.ts'

/** What part of the recording the strip shows: `start` is the time at its left edge. */
export interface View {
  readonly start: number
  readonly pxPerSecond: number
}

export const MAX_PX_PER_SECOND = 100
export const HIT_RADIUS_PX = 22
export const TAP_SLOP_PX = 6
const WINDOW_SECONDS = 0.1
const RANGE_MARGIN = 0.1
const MIN_LEVEL = 0.02
// Absorbs the error of dividing by 0.1 so a column edge on a window edge does not take in its neighbour.
const EDGE_EPSILON = 1e-9

const HARMLESS_VIEW: View = { start: 0, pxPerSecond: 1 }
const usable = (duration: number, widthPx: number): boolean =>
  Number.isFinite(duration) && duration > 0 && widthPx > 0

/** The whole recording across the strip. */
export function fitView(duration: number, widthPx: number): View {
  return usable(duration, widthPx) ? { start: 0, pxPerSecond: widthPx / duration } : HARMLESS_VIEW
}

/** Keeps a view inside the recording: no zooming out past fit, none in past the maximum, no scrolling beyond either end. */
export function clampView(view: View, duration: number, widthPx: number): View {
  if (!usable(duration, widthPx)) return HARMLESS_VIEW
  const fitted = widthPx / duration
  const pxPerSecond = Math.max(fitted, Math.min(view.pxPerSecond, MAX_PX_PER_SECOND))
  const latestStart = Math.max(0, duration - widthPx / pxPerSecond)
  return { start: Math.min(Math.max(view.start, 0), latestStart), pxPerSecond }
}

export const timeAtX = (x: number, view: View): number => view.start + x / view.pxPerSecond

export const xAtTime = (time: number, view: View): number => (time - view.start) * view.pxPerSecond

/** Zooms by `factor` keeping `anchorTime` under the same x (the finger stays on what it is holding). */
export function zoomAround(view: View, factor: number, anchorTime: number, duration: number, widthPx: number): View {
  const x = xAtTime(anchorTime, view)
  const pxPerSecond = Math.max(
    widthPx > 0 && duration > 0 ? widthPx / duration : 0,
    Math.min(view.pxPerSecond * factor, MAX_PX_PER_SECOND)
  )
  return clampView({ start: anchorTime - x / pxPerSecond, pxPerSecond }, duration, widthPx)
}

/** Dragging right by `dxPx` brings earlier time into view. */
export function panBy(view: View, dxPx: number, duration: number, widthPx: number): View {
  return clampView({ ...view, start: view.start - dxPx / view.pxPerSecond }, duration, widthPx)
}

/** A view of the trim range with a margin on each side. */
export function zoomToRange(range: TrimRange, duration: number, widthPx: number): View {
  const length = Math.max(range.end - range.start, WINDOW_SECONDS)
  const margin = length * RANGE_MARGIN
  return clampView({ start: range.start - margin, pxPerSecond: widthPx / (length + 2 * margin) }, duration, widthPx)
}

/**
 * For each pixel column, the loudest window in its time span (at least one window). Columns past the
 * end of the recording are 0. Cost is one pass over the windows in view, however long the recording.
 */
export function columnLevels(loudness: Float32Array, view: View, widthPx: number): number[] {
  const levels: number[] = []
  for (let column = 0; column < widthPx; column += 1) {
    const first = Math.max(0, Math.floor(timeAtX(column, view) / WINDOW_SECONDS + EDGE_EPSILON))
    if (first >= loudness.length) {
      levels.push(0)
      continue
    }
    const last = Math.max(first, Math.ceil(timeAtX(column + 1, view) / WINDOW_SECONDS - EDGE_EPSILON) - 1)
    let loudest = 0
    for (let index = first; index <= Math.min(last, loudness.length - 1); index += 1) {
      if (loudness[index] > loudest) loudest = loudness[index]
    }
    levels.push(loudest)
  }
  return levels
}

/** Scales levels to 0..1 of `loudest`, keeping a thin line for silence. */
export function normalizeLevels(levels: readonly number[], loudest: number, minimum: number = MIN_LEVEL): number[] {
  return levels.map((level) => (loudest > 0 ? Math.min(1, Math.max(minimum, level / loudest)) : minimum))
}

export type Hit =
  | { readonly kind: 'start' }
  | { readonly kind: 'end' }
  | { readonly kind: 'peak'; readonly peak: Peak }
  | { readonly kind: 'none' }

/** What a touch at `x` is on: a trim handle first, else the nearest marker, else nothing. */
export function hitTest(
  x: number,
  view: View,
  targets: { readonly range: TrimRange; readonly peaks: readonly Peak[] },
  radiusPx: number = HIT_RADIUS_PX
): Hit {
  const toStart = Math.abs(x - xAtTime(targets.range.start, view))
  const toEnd = Math.abs(x - xAtTime(targets.range.end, view))
  if (Math.min(toStart, toEnd) <= radiusPx) return { kind: toStart <= toEnd ? 'start' : 'end' }

  let nearest: Peak | null = null
  let nearestDistance = radiusPx
  for (const peak of targets.peaks) {
    const distance = Math.abs(x - xAtTime(peak.time, view))
    if (distance <= nearestDistance) {
      nearest = peak
      nearestDistance = distance
    }
  }
  return nearest ? { kind: 'peak', peak: nearest } : { kind: 'none' }
}

/** A touch that stayed within a few pixels is a tap, not a drag. */
export const isTap = (downX: number, downY: number, upX: number, upY: number): boolean =>
  Math.abs(upX - downX) <= TAP_SLOP_PX && Math.abs(upY - downY) <= TAP_SLOP_PX
