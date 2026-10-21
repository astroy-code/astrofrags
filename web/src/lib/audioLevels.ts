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

export interface AudioChoiceInput {
  /** Audio streams in the file; null when the stream listing itself could not be read. */
  readonly trackCount: number | null
  readonly levels: readonly TrackLevel[]
  /** The user's explicit pick; null means "use the loudest". */
  readonly override: number | null
}

/**
 * The audio stream to export, or null only when the file is known to have none. An unreadable
 * listing is not evidence of silence: keep the first track rather than drop the sound.
 */
export function chooseAudioTrack({ trackCount, levels, override }: AudioChoiceInput): number | null {
  if (trackCount === 0) return null
  if (trackCount === null) return override ?? 0
  const valid = override !== null && Number.isInteger(override) && override >= 0 && override < trackCount
  return valid ? override : pickLoudestTrack(levels)
}

/** Maps -60 dBFS..0 dBFS onto 0..100 for a level meter. */
export function levelToPercent(level: TrackLevel): number {
  if (level.rms <= 0) return 0
  const decibels = 20 * Math.log10(level.rms)
  return Math.round(Math.min(1, Math.max(0, (decibels - FLOOR_DB) / -FLOOR_DB)) * 100)
}
