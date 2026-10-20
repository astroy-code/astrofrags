export interface TrimArgsOptions {
  readonly inputPath: string
  readonly outputPath: string
  readonly start: number
  readonly end: number
}

const formatSeconds = (seconds: number): string => seconds.toFixed(3)

/**
 * Frame-accurate trim: input-side -ss with a re-encode. `0:a:0?` pins the first audio
 * stream (the one <video> plays) and tolerates files with no audio at all.
 */
export function buildTrimArgs({ inputPath, outputPath, start, end }: TrimArgsOptions): string[] {
  return [
    '-ss', formatSeconds(start),
    '-i', inputPath,
    '-t', formatSeconds(end - start),
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath
  ]
}
