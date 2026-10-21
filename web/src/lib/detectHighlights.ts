import { buildHighlightDecodeArgs } from './ffmpegArgs.ts'
import { getFFmpeg, resetFFmpeg, runExclusive } from './ffmpegInstance.ts'
import { withMountedFile } from './exportClip.ts'
import { pcmPeaks } from './highlights.ts'
import type { Peak } from './highlights.ts'
import { progressRatio } from './progress.ts'

const PCM_FILE = 'highlights.pcm'

export class HighlightsCancelledError extends Error {
  constructor() {
    super('Finding highlights was cancelled')
    this.name = 'HighlightsCancelledError'
  }
}

export interface DetectRequest {
  readonly file: File
  /** The audio stream to analyse (the one the clip would export). */
  readonly trackIndex: number
  readonly durationSeconds: number
  readonly onProgress: (ratio: number) => void
  readonly signal?: AbortSignal
}

/** Decodes one audio track of a picked file and returns its loudest moments, strongest first. */
export async function detectHighlights(req: DetectRequest): Promise<readonly Peak[]> {
  if (req.signal?.aborted) throw new HighlightsCancelledError()
  // Registered before any waiting so Cancel works while queued, loading or decoding.
  const onAbort = (): void => resetFFmpeg()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await runExclusive(() => decode(req))
  } catch (error) {
    if (req.signal?.aborted) throw new HighlightsCancelledError()
    throw error
  } finally {
    req.signal?.removeEventListener('abort', onAbort)
  }
}

async function decode({ file, trackIndex, durationSeconds, onProgress, signal }: DetectRequest): Promise<readonly Peak[]> {
  const ffmpeg = await getFFmpeg()
  if (signal?.aborted) throw new HighlightsCancelledError()
  const onEngineProgress = ({ time }: { time: number }): void => onProgress(progressRatio(time, durationSeconds))
  ffmpeg.on('progress', onEngineProgress)
  try {
    const exitCode = await withMountedFile(ffmpeg, file, (inputPath) =>
      ffmpeg.exec(buildHighlightDecodeArgs({ inputPath, trackIndex, outputPath: PCM_FILE }))
    )
    if (exitCode !== 0) throw new Error("The sound of this video could not be read, so no highlights were found.")
    const data = await ffmpeg.readFile(PCM_FILE)
    if (typeof data === 'string') throw new Error('The sound of this video could not be read.')
    return pcmPeaks(data)
  } finally {
    // After a cancel the instance was terminated; these calls are harmless no-ops on it.
    ffmpeg.off('progress', onEngineProgress)
    await ffmpeg.deleteFile(PCM_FILE).catch(() => undefined)
  }
}
