import { FFFSType } from '@ffmpeg/ffmpeg'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { measureLevel } from './audioLevels.ts'
import type { TrackLevel } from './audioLevels.ts'
import type { BrandingSettings } from './brandingSettings.ts'
import { loadLogo, renderCardPng, renderLowerThirdPng } from './cardImages.ts'
import type { Logo } from './cardImages.ts'
import { buildExportArgs, planDurationSeconds } from './exportGraph.ts'
import type { ExportInputs, ExportPlan } from './exportGraph.ts'
import { buildLevelProbeArgs } from './ffmpegArgs.ts'
import { countAudioStreams } from './ffmpegLog.ts'
import { reelFileName, trimmedFileName } from './fileNames.ts'
import { progressRatio } from './progress.ts'
import { buildExportPlan } from './reelPlan.ts'
import type { ReelClip } from './reelPlan.ts'
import { validateTrimRange } from './trimRange.ts'
import { getFFmpeg, resetFFmpeg, runExclusive } from './ffmpegInstance.ts'

const MOUNT_DIR = '/in'
const INPUT_PREFIX = 'input'
const MUSIC_NAME = 'music'
const OUTPUT_NAME = 'output.mp4'
const LOGO_FILE = 'logo.png'
const INTRO_FILE = 'intro.png'
const OUTRO_FILE = 'outro.png'
const LOWER_THIRD_FILE = 'lower-third.png'
const LEVEL_FILE = 'level.pcm'
const BYTES_PER_SAMPLE = 2
const LOG_TAIL_CHARS = 500

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

/** A clip of the reel together with the picked file it is cut from. */
export interface ExportClip extends ReelClip {
  readonly file: File
}

export interface ExportRequest {
  /** The clips in order; one clip is a plain trim. */
  readonly clips: readonly ExportClip[]
  readonly branding: BrandingSettings
  readonly musicFile: File | null
  /** Music only: drop the clips' own sound. Ignored without music. */
  readonly muteOriginal: boolean
  readonly onProgress: (ratio: number) => void
  readonly signal?: AbortSignal
}

export interface ExportResult {
  readonly blob: Blob
  readonly fileName: string
}

/**
 * Mounts the picked Files read-only (no copy into WASM memory). Each File is re-wrapped under a
 * fixed name so odd characters in the user's file names can't break ffmpeg paths.
 */
async function withMountedFiles<T>(
  ffmpeg: FFmpeg,
  entries: readonly { readonly name: string; readonly file: File }[],
  run: (paths: readonly string[]) => Promise<T>
): Promise<T> {
  const wrapped = entries.map(({ name, file }) => new File([file], name, { type: file.type }))
  // The directory can already exist if a previous cleanup was interrupted.
  await ffmpeg.createDir(MOUNT_DIR).catch(() => undefined)
  await ffmpeg.mount(FFFSType.WORKERFS, { files: wrapped }, MOUNT_DIR)
  try {
    return await run(entries.map(({ name }) => `${MOUNT_DIR}/${name}`))
  } finally {
    await ffmpeg.unmount(MOUNT_DIR).catch(() => undefined)
    await ffmpeg.deleteDir(MOUNT_DIR).catch(() => undefined)
  }
}

function withMountedFile<T>(ffmpeg: FFmpeg, file: File, run: (inputPath: string) => Promise<T>): Promise<T> {
  return withMountedFiles(ffmpeg, [{ name: INPUT_PREFIX + '0', file }], ([inputPath]) => run(inputPath))
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

/** How many audio streams a picked file has; used to reject a music file that is not audio. */
export function countAudioStreamsOfFile(file: File): Promise<number> {
  return runExclusive(async () => {
    const ffmpeg = await getFFmpeg()
    return withMountedFile(ffmpeg, file, async (inputPath) =>
      countAudioStreams(await readStreamListing(ffmpeg, inputPath))
    )
  })
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

export interface AudioProbe {
  /** Audio streams in the file; null when the stream listing could not be read at all. */
  readonly trackCount: number | null
  /** Loudness per track; a track that could not be measured counts as silent. */
  readonly levels: readonly TrackLevel[]
}

const SILENT_LEVEL: TrackLevel = { rms: 0, peak: 0 }

/** Best-effort audio facts about a file. Never throws. */
export async function probeAudioTracks(file: File): Promise<AudioProbe> {
  try {
    return await runExclusive(async () => {
      const ffmpeg = await getFFmpeg()
      return withMountedFile(ffmpeg, file, async (inputPath) => {
        const trackCount = countAudioStreams(await readStreamListing(ffmpeg, inputPath))
        const levels: TrackLevel[] = []
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          // A track the probe chokes on still exists: keep it, as silent, so the stream count stays true.
          levels.push(await measureTrack(ffmpeg, inputPath, trackIndex).catch(() => SILENT_LEVEL))
        }
        return { trackCount, levels }
      })
    })
  } catch {
    return { trackCount: null, levels: [] }
  }
}

export async function exportTrimmedClip(req: ExportRequest): Promise<ExportResult> {
  if (req.clips.length === 0) throw new Error('Add at least one clip to export.')
  req.clips.forEach((clip, index) => {
    const validation = validateTrimRange({ start: clip.start, end: clip.end }, clip.duration)
    if (!validation.ok) {
      throw new Error(`Invalid trim range in clip ${index + 1} (${validation.reason}).`)
    }
  })
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

type BrandingInputs = Omit<ExportInputs, 'videos' | 'music'>

/** Writes the logo and any card or overlay images into the ffmpeg filesystem. */
async function writeBrandingFiles(
  ffmpeg: FFmpeg,
  plan: ExportPlan,
  branding: BrandingSettings,
  logo: Logo,
  written: string[]
): Promise<BrandingInputs> {
  const write = async (name: string, data: Uint8Array): Promise<string> => {
    // writeFile transfers the buffer to the worker, which would detach the cached logo bytes.
    await ffmpeg.writeFile(name, data.slice())
    written.push(name)
    return name
  }

  const inputs: { logo: string; introCard?: string; outroCard?: string; lowerThird?: string } = {
    logo: await write(LOGO_FILE, logo.bytes)
  }
  if (plan.intro || plan.outro) {
    const card = await renderCardPng(branding, plan.output, logo)
    if (plan.intro) inputs.introCard = await write(INTRO_FILE, card)
    if (plan.outro) inputs.outroCard = await write(OUTRO_FILE, card)
  }
  if (plan.lowerThird) {
    inputs.lowerThird = await write(LOWER_THIRD_FILE, await renderLowerThirdPng(branding, plan.output))
  }
  return inputs
}

function resultFileName({ clips }: ExportRequest): string {
  const [first] = clips
  return clips.length === 1
    ? trimmedFileName(first.file.name, first.start, first.end)
    : reelFileName(first.file.name, clips.length)
}

async function runExport(req: ExportRequest): Promise<ExportResult> {
  if (req.signal?.aborted) throw new ExportCancelledError()
  const logo = await loadLogo()
  const ffmpeg = await getFFmpeg()
  if (req.signal?.aborted) throw new ExportCancelledError()

  const plan = buildExportPlan({
    clips: req.clips,
    branding: req.branding,
    hasMusic: req.musicFile !== null,
    muteOriginal: req.muteOriginal,
    logo: logo.size
  })
  const planSeconds = planDurationSeconds(plan)

  let log = ''
  const onLog = ({ message }: { message: string }): void => {
    log = `${log}${message}\n`.slice(-LOG_TAIL_CHARS * 4)
  }
  // The engine's own ratio is relative to the input; its time is how much output is done.
  const onProgress = ({ time }: { time: number }): void => {
    req.onProgress(progressRatio(time, planSeconds))
  }

  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)
  const written: string[] = []
  try {
    const brandingInputs = await writeBrandingFiles(ffmpeg, plan, req.branding, logo, written)
    const mounts = [
      ...req.clips.map((clip, index) => ({ name: `${INPUT_PREFIX}${index}`, file: clip.file })),
      ...(req.musicFile ? [{ name: MUSIC_NAME, file: req.musicFile }] : [])
    ]
    const exitCode = await withMountedFiles(ffmpeg, mounts, (paths) =>
      ffmpeg.exec(
        buildExportArgs(
          plan,
          { ...brandingInputs, videos: paths.slice(0, req.clips.length), music: paths[req.clips.length] },
          OUTPUT_NAME
        )
      )
    )
    if (exitCode !== 0) {
      throw new Error(`ffmpeg failed (exit ${exitCode}): ${log.slice(-LOG_TAIL_CHARS)}`)
    }

    const data = await ffmpeg.readFile(OUTPUT_NAME)
    if (typeof data === 'string' || data.length === 0) {
      throw new Error('Export produced an empty file. The video may be in a format this browser cannot process.')
    }
    return {
      blob: new Blob([data.slice()], { type: 'video/mp4' }),
      fileName: resultFileName(req)
    }
  } finally {
    // After a cancel the instance was terminated; these calls are harmless no-ops on it.
    ffmpeg.off('log', onLog)
    ffmpeg.off('progress', onProgress)
    for (const name of [...written, OUTPUT_NAME]) {
      await ffmpeg.deleteFile(name).catch(() => undefined)
    }
  }
}
