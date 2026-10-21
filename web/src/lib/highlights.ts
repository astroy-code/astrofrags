import type { TrimRange } from './trimRange.ts'

// The same numbers as the desktop app (src/main/audioAnalysis.ts, App.tsx).
const WINDOW_SECONDS = 0.1
const MERGE_GAP_SECONDS = 3
const PEAK_STDDEV_MULTIPLIER = 3
const MAX_PEAKS = 12
const FULL_SCALE = 32768

export const HIGHLIGHT_PAD_BEFORE = 5
export const HIGHLIGHT_PAD_AFTER = 3
export const MAX_BUILD_CLIPS = 8

export interface Peak {
  /** Seconds from the start of the recording. */
  readonly time: number
  /** Loudness (RMS, 0..1) of the loudest window of the moment. */
  readonly score: number
}

/** Loudness (RMS) of each 0.1 s window; the last window may be shorter. */
export function rmsPerWindow(samples: Int16Array, sampleRate: number): number[] {
  const windowSamples = Math.round(sampleRate * WINDOW_SECONDS)
  const windows: number[] = []
  for (let start = 0; start < samples.length; start += windowSamples) {
    const end = Math.min(start + windowSamples, samples.length)
    let sumSquares = 0
    for (let i = start; i < end; i += 1) {
      const normalized = samples[i] / FULL_SCALE
      sumSquares += normalized * normalized
    }
    windows.push(Math.sqrt(sumSquares / (end - start)))
  }
  return windows
}

/** Windows louder than mean + 3 standard deviations, merged within 3 s, strongest 12 first. */
export function findPeaks(windows: readonly number[]): Peak[] {
  if (windows.length === 0) return []
  const mean = windows.reduce((sum, value) => sum + value, 0) / windows.length
  const variance = windows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / windows.length
  const threshold = mean + PEAK_STDDEV_MULTIPLIER * Math.sqrt(variance)

  const merged: Peak[] = []
  windows.forEach((score, index) => {
    if (score <= threshold) return
    const peak: Peak = { time: index * WINDOW_SECONDS, score }
    const last = merged[merged.length - 1]
    if (last === undefined || peak.time - last.time > MERGE_GAP_SECONDS) {
      merged.push(peak)
    } else if (peak.score > last.score) {
      merged[merged.length - 1] = peak
    }
  })
  return [...merged].sort((a, b) => b.score - a.score).slice(0, MAX_PEAKS)
}

/** The clip that frames a moment: 5 s before to 3 s after, kept inside the recording. */
export function peakRange(peak: Peak, duration: number): TrimRange {
  const end = peak.time + HIGHLIGHT_PAD_AFTER
  return {
    start: Math.max(0, peak.time - HIGHLIGHT_PAD_BEFORE),
    end: duration > 0 ? Math.min(duration, end) : end
  }
}

const overlaps = (a: TrimRange, b: TrimRange): boolean => a.start < b.end && b.start < a.end

export interface ChooseInput {
  readonly peaks: readonly Peak[]
  readonly duration: number
  /** Ranges of this recording already in the reel; chosen moments must not replay them. */
  readonly taken: readonly TrimRange[]
  readonly maxClips?: number
}

export interface ChosenHighlight {
  readonly peak: Peak
  readonly range: TrimRange
}

/** The strongest moments that do not overlap each other or `taken`, in time order. */
export function chooseHighlights({
  peaks,
  duration,
  taken,
  maxClips = MAX_BUILD_CLIPS
}: ChooseInput): readonly ChosenHighlight[] {
  const chosen: ChosenHighlight[] = []
  for (const peak of [...peaks].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxClips) break
    const range = peakRange(peak, duration)
    if (taken.some((other) => overlaps(other, range)) || chosen.some((item) => overlaps(item.range, range))) continue
    chosen.push({ peak, range })
  }
  return chosen.sort((a, b) => a.peak.time - b.peak.time)
}
