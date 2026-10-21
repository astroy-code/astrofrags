import { runAbortable } from './abortableTask.ts'
import { buildHighlightDecodeArgs } from './ffmpegArgs.ts'
import { getFFmpeg, resetFFmpeg, runExclusive } from './ffmpegInstance.ts'
import { withMountedFile } from './exportClip.ts'
import { scanChunks } from './highlights.ts'
import type { HighlightScan } from './highlights.ts'
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
export function detectHighlights(req: DetectRequest): Promise<HighlightScan> {
  return runAbortable({
    enqueue: runExclusive,
    task: () => decode(req),
    signal: req.signal,
    terminate: resetFFmpeg,
    cancelled: () => new HighlightsCancelledError()
  })
}

async function decode({ file, trackIndex, durationSeconds, onProgress, signal }: DetectRequest): Promise<HighlightScan> {
  const ffmpeg = await getFFmpeg()
  if (signal?.aborted) throw new HighlightsCancelledError()
  let chunkIndex = 0
  let chunkCount = 1
  let chunkLength = durationSeconds
  const onEngineProgress = ({ time }: { time: number }): void =>
    onProgress((chunkIndex + progressRatio(time, chunkLength)) / chunkCount)
  ffmpeg.on('progress', onEngineProgress)
  try {
    // The file is mounted once; each chunk of it is decoded, measured and dropped in turn, so only
    // about ten minutes of audio is ever held, however long the recording is.
    return await withMountedFile(ffmpeg, file, (inputPath) =>
      scanChunks({
        durationSeconds,
        decode: async (chunk, index, count) => {
          chunkIndex = index
          chunkCount = count
          chunkLength = chunk.length
          const exitCode = await ffmpeg.exec(
            buildHighlightDecodeArgs({
              inputPath,
              trackIndex,
              outputPath: PCM_FILE,
              startSeconds: chunk.start,
              durationSeconds: chunk.length
            })
          )
          if (exitCode !== 0) throw new Error('The sound of this video could not be read, so no highlights were found.')
          const data = await ffmpeg.readFile(PCM_FILE)
          if (typeof data === 'string') throw new Error('The sound of this video could not be read.')
          await ffmpeg.deleteFile(PCM_FILE).catch(() => undefined)
          return data
        }
      })
    )
  } finally {
    // After a cancel the instance was terminated; these calls are harmless no-ops on it.
    ffmpeg.off('progress', onEngineProgress)
    await ffmpeg.deleteFile(PCM_FILE).catch(() => undefined)
  }
}
