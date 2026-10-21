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

export interface HighlightDecodeArgsOptions {
  readonly inputPath: string
  readonly trackIndex: number
  readonly outputPath: string
  /** Decode only this stretch (seconds); both must be given together. */
  readonly startSeconds?: number
  readonly durationSeconds?: number
}

/** Decodes the whole of one audio track to 8 kHz mono PCM so its loud moments can be found. */
export function buildHighlightDecodeArgs({
  inputPath,
  trackIndex,
  outputPath,
  startSeconds,
  durationSeconds
}: HighlightDecodeArgsOptions): string[] {
  // Seeking before -i is fast on a mounted file and exact enough for 0.1 s loudness windows.
  const range =
    startSeconds !== undefined && durationSeconds !== undefined
      ? ['-ss', String(startSeconds), '-t', String(durationSeconds)]
      : []
  return [...range, '-i', inputPath, '-map', `0:a:${trackIndex}`, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', outputPath]
}
