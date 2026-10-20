export interface TrimArgsOptions {
  readonly inputPath: string
  readonly outputPath: string
  readonly start: number
  readonly end: number
  /** Zero-based index among the file's audio streams; defaults to the first. */
  readonly audioTrackIndex?: number
}

const LEVEL_PROBE_SECONDS = 120

export interface LevelProbeArgsOptions {
  readonly inputPath: string
  readonly trackIndex: number
  readonly outputPath: string
}

/** Decodes one audio track to quiet 8 kHz mono PCM so its loudness can be measured. */
export function buildLevelProbeArgs({ inputPath, trackIndex, outputPath }: LevelProbeArgsOptions): string[] {
  return [
    '-i', inputPath,
    '-map', `0:a:${trackIndex}`,
    '-vn',
    '-ac', '1',
    '-ar', '8000',
    '-t', String(LEVEL_PROBE_SECONDS),
    '-f', 's16le',
    outputPath
  ]
}

const formatSeconds = (seconds: number): string => seconds.toFixed(3)

/**
 * Frame-accurate trim: input-side -ss with a re-encode. The audio map is optional (`?`) so
 * files with no audio at all still export; the track defaults to the first stream.
 */
export function buildTrimArgs({
  inputPath,
  outputPath,
  start,
  end,
  audioTrackIndex = 0
}: TrimArgsOptions): string[] {
  return [
    '-ss', formatSeconds(start),
    '-i', inputPath,
    '-t', formatSeconds(end - start),
    '-map', '0:v:0',
    '-map', `0:a:${audioTrackIndex}?`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath
  ]
}
