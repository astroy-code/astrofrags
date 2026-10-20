import { FFFSType } from '@ffmpeg/ffmpeg'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { buildTrimArgs } from './ffmpegArgs.ts'
import { countAudioStreams } from './ffmpegLog.ts'
import { trimmedFileName } from './fileNames.ts'
import { validateTrimRange } from './trimRange.ts'
import { getFFmpeg, resetFFmpeg, runExclusive } from './ffmpegInstance.ts'

const MOUNT_DIR = '/in'
const INPUT_NAME = 'input'
const OUTPUT_NAME = 'output.mp4'
const LOG_TAIL_CHARS = 500

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

export interface ExportRequest {
  readonly file: File
  readonly start: number
  readonly end: number
  readonly duration: number
  readonly onProgress: (ratio: number) => void
  readonly signal?: AbortSignal
}

export interface ExportResult {
  readonly blob: Blob
  readonly fileName: string
}

/**
 * Mounts the picked File read-only (no copy into WASM memory). The File is re-wrapped under a
 * fixed name so odd characters in the user's file name can't break ffmpeg paths.
 */
async function withMountedFile<T>(
  ffmpeg: FFmpeg,
  file: File,
  run: (inputPath: string) => Promise<T>
): Promise<T> {
  const wrapped = new File([file], INPUT_NAME, { type: file.type })
  // The directory can already exist if a previous cleanup was interrupted.
  await ffmpeg.createDir(MOUNT_DIR).catch(() => undefined)
  await ffmpeg.mount(FFFSType.WORKERFS, { files: [wrapped] }, MOUNT_DIR)
  try {
    return await run(`${MOUNT_DIR}/${INPUT_NAME}`)
  } finally {
    await ffmpeg.unmount(MOUNT_DIR).catch(() => undefined)
    await ffmpeg.deleteDir(MOUNT_DIR).catch(() => undefined)
  }
}

/** Best-effort audio stream count; resolves 0 on any failure and never throws. */
export async function probeAudioStreams(file: File): Promise<number> {
  try {
    return await runExclusive(async () => {
      const ffmpeg = await getFFmpeg()
      let log = ''
      const onLog = ({ message }: { message: string }): void => {
        log += `${message}\n`
      }
      ffmpeg.on('log', onLog)
      try {
        // `-i` with no output exits non-zero but prints the stream listing, which is all we need.
        await withMountedFile(ffmpeg, file, (inputPath) => ffmpeg.exec(['-i', inputPath]))
      } finally {
        ffmpeg.off('log', onLog)
      }
      return countAudioStreams(log)
    })
  } catch {
    return 0
  }
}

export async function exportTrimmedClip(req: ExportRequest): Promise<ExportResult> {
  const validation = validateTrimRange({ start: req.start, end: req.end }, req.duration)
  if (!validation.ok) {
    throw new Error(`Invalid trim range (${validation.reason}).`)
  }
  if (req.signal?.aborted) throw new ExportCancelledError()

  return runExclusive(async () => {
    if (req.signal?.aborted) throw new ExportCancelledError()
    const ffmpeg = await getFFmpeg()

    let log = ''
    const onLog = ({ message }: { message: string }): void => {
      log = `${log}${message}\n`.slice(-LOG_TAIL_CHARS * 4)
    }
    const onProgress = ({ progress }: { progress: number }): void => {
      req.onProgress(Math.min(1, Math.max(0, progress)))
    }
    const onAbort = (): void => resetFFmpeg()

    ffmpeg.on('log', onLog)
    ffmpeg.on('progress', onProgress)
    req.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const exitCode = await withMountedFile(ffmpeg, req.file, (inputPath) =>
        ffmpeg.exec(buildTrimArgs({ inputPath, outputPath: OUTPUT_NAME, start: req.start, end: req.end }))
      )
      if (exitCode !== 0) {
        throw new Error(`ffmpeg failed (exit ${exitCode}): ${log.slice(-LOG_TAIL_CHARS)}`)
      }

      const data = await ffmpeg.readFile(OUTPUT_NAME)
      if (typeof data === 'string' || data.length === 0) {
        throw new Error('Export produced an empty file. The video may be in a format this browser cannot process.')
      }
      await ffmpeg.deleteFile(OUTPUT_NAME).catch(() => undefined)
      return {
        blob: new Blob([data.slice()], { type: 'video/mp4' }),
        fileName: trimmedFileName(req.file.name, req.start, req.end)
      }
    } catch (error) {
      if (req.signal?.aborted) throw new ExportCancelledError()
      throw error
    } finally {
      req.signal?.removeEventListener('abort', onAbort)
      // After a cancel the instance was terminated; these calls are harmless no-ops on it.
      ffmpeg.off('log', onLog)
      ffmpeg.off('progress', onProgress)
    }
  })
}
