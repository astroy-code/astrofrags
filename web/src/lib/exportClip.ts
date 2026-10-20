import { FFFSType } from '@ffmpeg/ffmpeg'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { measureLevel } from './audioLevels.ts'
import type { TrackLevel } from './audioLevels.ts'
import { buildLevelProbeArgs, buildTrimArgs } from './ffmpegArgs.ts'
import { countAudioStreams } from './ffmpegLog.ts'
import { trimmedFileName } from './fileNames.ts'
import { validateTrimRange } from './trimRange.ts'
import { getFFmpeg, resetFFmpeg, runExclusive } from './ffmpegInstance.ts'

const MOUNT_DIR = '/in'
const INPUT_NAME = 'input'
const OUTPUT_NAME = 'output.mp4'
const LEVEL_FILE = 'level.pcm'
const BYTES_PER_SAMPLE = 2
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
  readonly audioTrackIndex: number
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

/** `-i` with no output exits non-zero but prints the stream listing, which is all we need. */
async function readStreamListing(ffmpeg: FFmpeg, inputPath: string): Promise<string> {
  let log = ''
  const onLog = ({ message }: { message: string }): void => {
    log += `${message}\n`
  }
  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.exec(['-i', inputPath])
  } finally {
    ffmpeg.off('log', onLog)
  }
  return log
}

/** Decodes one track and measures it; a track that fails to decode counts as silent. */
async function measureTrack(ffmpeg: FFmpeg, inputPath: string, trackIndex: number): Promise<TrackLevel> {
  try {
    const exitCode = await ffmpeg.exec(buildLevelProbeArgs({ inputPath, trackIndex, outputPath: LEVEL_FILE }))
    if (exitCode !== 0) return { rms: 0, peak: 0 }
    const data = await ffmpeg.readFile(LEVEL_FILE)
    if (typeof data === 'string') return { rms: 0, peak: 0 }
    // Copy so the Int16Array view starts on an aligned, whole-sample buffer.
    const bytes = data.slice()
    return measureLevel(new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / BYTES_PER_SAMPLE)))
  } finally {
    await ffmpeg.deleteFile(LEVEL_FILE).catch(() => undefined)
  }
}

/**
 * Best-effort loudness of every audio track, in track order. Resolves to [] on any failure
 * (or for a file with no audio) and never throws.
 */
export async function probeAudioTracks(file: File): Promise<readonly TrackLevel[]> {
  try {
    return await runExclusive(async () => {
      const ffmpeg = await getFFmpeg()
      return withMountedFile(ffmpeg, file, async (inputPath) => {
        const trackCount = countAudioStreams(await readStreamListing(ffmpeg, inputPath))
        const levels: TrackLevel[] = []
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          levels.push(await measureTrack(ffmpeg, inputPath, trackIndex))
        }
        return levels
      })
    })
  } catch {
    return []
  }
}

export async function exportTrimmedClip(req: ExportRequest): Promise<ExportResult> {
  const validation = validateTrimRange({ start: req.start, end: req.end }, req.duration)
  if (!validation.ok) {
    throw new Error(`Invalid trim range (${validation.reason}).`)
  }
  if (req.signal?.aborted) throw new ExportCancelledError()

  // Registered before any waiting (queue, engine load, encode) so Cancel works at every stage:
  // resetFFmpeg() terminates the engine, which rejects whatever is pending.
  const onAbort = (): void => resetFFmpeg()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await runExclusive(() => runExport(req))
  } catch (error) {
    if (req.signal?.aborted) throw new ExportCancelledError()
    throw error
  } finally {
    req.signal?.removeEventListener('abort', onAbort)
  }
}

async function runExport(req: ExportRequest): Promise<ExportResult> {
  if (req.signal?.aborted) throw new ExportCancelledError()
  const ffmpeg = await getFFmpeg()
  if (req.signal?.aborted) throw new ExportCancelledError()

  let log = ''
  const onLog = ({ message }: { message: string }): void => {
    log = `${log}${message}\n`.slice(-LOG_TAIL_CHARS * 4)
  }
  const onProgress = ({ progress }: { progress: number }): void => {
    req.onProgress(Math.min(1, Math.max(0, progress)))
  }

  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)
  try {
    const exitCode = await withMountedFile(ffmpeg, req.file, (inputPath) =>
      ffmpeg.exec(
        buildTrimArgs({
          inputPath,
          outputPath: OUTPUT_NAME,
          start: req.start,
          end: req.end,
          audioTrackIndex: req.audioTrackIndex
        })
      )
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
  } finally {
    // After a cancel the instance was terminated; these calls are harmless no-ops on it.
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
  }
}
