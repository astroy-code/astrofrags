const MICROSECONDS_PER_SECOND = 1_000_000

/**
 * Export progress from the encoder's output time (microseconds) over the planned output length.
 * The encoder's own ratio is relative to the *input*, which misleads when trimming a short
 * piece out of a long video or adding cards.
 */
export function progressRatio(outputTimeMicroseconds: number, planSeconds: number): number {
  if (!Number.isFinite(outputTimeMicroseconds) || planSeconds <= 0) return 0
  return Math.min(1, Math.max(0, outputTimeMicroseconds / MICROSECONDS_PER_SECOND / planSeconds))
}
