import type { TrimRange } from './trimRange.ts'

// The same numbers as the desktop app (src/main/audioAnalysis.ts, App.tsx).
const WINDOW_SECONDS = 0.1
const MERGE_GAP_SECONDS = 3
const PEAK_STDDEV_MULTIPLIER = 3
const MAX_PEAKS = 12
const FULL_SCALE = 32768
/** The rate the page decodes at; loudness peaks are the same as at desktop's 16 kHz for half the memory. */
export const HIGHLIGHT_SAMPLE_RATE = 8000
const BYTES_PER_SAMPLE = 2

export const HIGHLIGHT_PAD_BEFORE = 5
export const HIGHLIGHT_PAD_AFTER = 3
export const MAX_BUILD_CLIPS = 8
/** Ten minutes of 8 kHz audio is about 10 MB, so memory stays small however long the recording is. */
export const HIGHLIGHT_CHUNK_SECONDS = 600

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

/** Peaks of raw little-endian 16-bit mono PCM at HIGHLIGHT_SAMPLE_RATE (any trailing odd byte is ignored). */
export function pcmPeaks(pcm: Uint8Array): Peak[] {
  // A 16-bit view needs an even byte offset; copy only when the bytes do not start on one.
  const bytes = pcm.byteOffset % BYTES_PER_SAMPLE === 0 ? pcm : pcm.slice()
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / BYTES_PER_SAMPLE))
  return findPeaks(rmsPerWindow(samples, HIGHLIGHT_SAMPLE_RATE))
}

export interface Chunk {
  /** Seconds from the start of the recording. */
  readonly start: number
  readonly length: number
}

/** Splits a recording into consecutive chunks (the last may be shorter). */
export function planChunks(durationSeconds: number, chunkSeconds: number = HIGHLIGHT_CHUNK_SECONDS): Chunk[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
  const chunks: Chunk[] = []
  for (let start = 0; start < durationSeconds; start += chunkSeconds) {
    chunks.push({ start, length: Math.min(chunkSeconds, durationSeconds - start) })
  }
  return chunks
}

/**
 * The loudness windows of one decoded chunk. A chunk that is not the last must be exactly
 * `expectedWindows` long (extra samples are dropped, a short decode is padded with silence), so
 * every later window keeps its place in time.
 */
export function windowsOfChunk(pcm: Uint8Array, expectedWindows: number | null): number[] {
  const bytes = pcm.byteOffset % BYTES_PER_SAMPLE === 0 ? pcm : pcm.slice()
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / BYTES_PER_SAMPLE))
  const windows = rmsPerWindow(samples, HIGHLIGHT_SAMPLE_RATE)
  if (expectedWindows === null) return windows
  const fitted = windows.slice(0, expectedWindows)
  while (fitted.length < expectedWindows) fitted.push(0)
  return fitted
}

export interface ChunkedRequest {
  readonly durationSeconds: number
  readonly chunkSeconds?: number
  /** Decodes one chunk to 8 kHz mono PCM; called in order, one at a time. */
  readonly decode: (chunk: Chunk, index: number, count: number) => Promise<Uint8Array>
}

export interface HighlightScan {
  /** The loudest moments, strongest first. */
  readonly peaks: Peak[]
  /** Loudness (RMS) of every 0.1 s window of the recording, for drawing a waveform. */
  readonly loudness: Float32Array
}

/** Scans a whole recording for its loudest moments while holding only one chunk of audio at a time. */
export async function scanChunks({
  durationSeconds,
  chunkSeconds = HIGHLIGHT_CHUNK_SECONDS,
  decode
}: ChunkedRequest): Promise<HighlightScan> {
  const chunks = planChunks(durationSeconds, chunkSeconds)
  const windows: number[] = []
  for (const [index, chunk] of chunks.entries()) {
    const pcm = await decode(chunk, index, chunks.length)
    const isLast = index === chunks.length - 1
    const expected = isLast ? null : Math.round(chunk.length / WINDOW_SECONDS)
    for (const value of windowsOfChunk(pcm, expected)) windows.push(value)
  }
  return { peaks: findPeaks(windows), loudness: Float32Array.from(windows) }
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
