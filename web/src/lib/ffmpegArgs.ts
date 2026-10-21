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
}

/** Decodes the whole of one audio track to 8 kHz mono PCM so its loud moments can be found. */
export function buildHighlightDecodeArgs({
  inputPath,
  trackIndex,
  outputPath
}: HighlightDecodeArgsOptions): string[] {
  return ['-i', inputPath, '-map', `0:a:${trackIndex}`, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', outputPath]
}
