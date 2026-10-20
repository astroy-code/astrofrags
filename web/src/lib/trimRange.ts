export interface TrimRange {
  readonly start: number
  readonly end: number
}

export const MIN_TRIM_SECONDS = 0.5

export type TrimError =
  | 'duration-unknown'
  | 'start-negative'
  | 'end-before-start'
  | 'beyond-duration'
  | 'too-short'

export type TrimValidation = { ok: true } | { ok: false; reason: TrimError }

export function validateTrimRange(range: TrimRange, duration: number): TrimValidation {
  if (!Number.isFinite(duration) || duration <= 0) return { ok: false, reason: 'duration-unknown' }
  if (range.start < 0) return { ok: false, reason: 'start-negative' }
  if (range.end <= range.start) return { ok: false, reason: 'end-before-start' }
  if (range.end > duration) return { ok: false, reason: 'beyond-duration' }
  if (range.end - range.start < MIN_TRIM_SECONDS) return { ok: false, reason: 'too-short' }
  return { ok: true }
}

export function clampTrimRange(range: TrimRange, duration: number): TrimRange {
  const start = Math.min(Math.max(range.start, 0), duration)
  const end = Math.min(Math.max(range.end, start), duration)
  return { start, end }
}

/** Moves the start handle, keeping at least MIN_TRIM_SECONDS before the end. */
export function withStart(range: TrimRange, start: number, duration: number): TrimRange {
  const latestStart = Math.max(0, range.end - MIN_TRIM_SECONDS)
  return clampTrimRange({ start: Math.min(start, latestStart), end: range.end }, duration)
}

/** Moves the end handle, keeping at least MIN_TRIM_SECONDS after the start. */
export function withEnd(range: TrimRange, end: number, duration: number): TrimRange {
  const earliestEnd = Math.min(duration, range.start + MIN_TRIM_SECONDS)
  return clampTrimRange({ start: range.start, end: Math.max(end, earliestEnd) }, duration)
}
