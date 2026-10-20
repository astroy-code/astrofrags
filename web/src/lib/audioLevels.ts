export interface TrackLevel {
  /** Root-mean-square level, 0..1 of full scale. */
  readonly rms: number
  /** Largest absolute sample, 0..1 of full scale. */
  readonly peak: number
}

const FULL_SCALE = 32768
// About -54 dBFS: below this a track is treated as silent (digital silence, dither, or a muted mic).
export const SILENCE_RMS = 0.002
const FLOOR_DB = -60

export function measureLevel(samples: Int16Array): TrackLevel {
  if (samples.length === 0) return { rms: 0, peak: 0 }
  let sumOfSquares = 0
  let peak = 0
  for (const sample of samples) {
    const normalized = sample / FULL_SCALE
    sumOfSquares += normalized * normalized
    peak = Math.max(peak, Math.abs(normalized))
  }
  return { rms: Math.sqrt(sumOfSquares / samples.length), peak }
}

export function isSilent(level: TrackLevel): boolean {
  return level.rms < SILENCE_RMS
}

/** Index of the loudest track; the first track when there are none or all are silent. */
export function pickLoudestTrack(levels: readonly TrackLevel[]): number {
  let loudest = 0
  levels.forEach((level, index) => {
    if (level.rms > levels[loudest].rms) loudest = index
  })
  return levels.length === 0 || isSilent(levels[loudest]) ? 0 : loudest
}

/** Maps -60 dBFS..0 dBFS onto 0..100 for a level meter. */
export function levelToPercent(level: TrackLevel): number {
  if (level.rms <= 0) return 0
  const decibels = 20 * Math.log10(level.rms)
  return Math.round(Math.min(1, Math.max(0, (decibels - FLOOR_DB) / -FLOOR_DB)) * 100)
}
