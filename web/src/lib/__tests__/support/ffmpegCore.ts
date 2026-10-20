import { readFileSync } from 'node:fs'
import { countAudioStreams } from '../../ffmpegLog.ts'

/**
 * Runs the pinned @ffmpeg/core inside Node so filter graphs can be integration-tested against
 * the real build in well under a second each. Each runCore call gets a fresh core instance
 * (its own in-memory filesystem), so runs never see each other's files.
 */

export interface MediaInfo {
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly hasVideo: boolean
  readonly audioStreams: number
}

export interface CoreRun {
  readonly exitCode: number
  readonly log: string
  read(path: string): Uint8Array
}

interface CoreInstance {
  setLogger(logger: (event: { message: string }) => void): void
  exec(...args: string[]): number
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
  }
}

interface CoreFactory {
  readonly create: (options: { wasmBinary: Uint8Array }) => Promise<CoreInstance>
  readonly wasm: Uint8Array
}

const CORE_DIR = new URL('../../../../../node_modules/@ffmpeg/core/dist/esm/', import.meta.url)

let factoryPromise: Promise<CoreFactory> | null = null

function loadFactory(): Promise<CoreFactory> {
  factoryPromise ??= (async () => {
    // The core is built for browsers and expects these globals.
    const scope = globalThis as unknown as Record<string, unknown>
    scope.self = globalThis
    scope.location = { href: CORE_DIR.href }
    const module = await import(new URL('ffmpeg-core.js', CORE_DIR).href)
    return { create: module.default, wasm: readFileSync(new URL('ffmpeg-core.wasm', CORE_DIR)) }
  })()
  return factoryPromise
}

export async function runCore(
  args: string[],
  files: Readonly<Record<string, Uint8Array>> = {}
): Promise<CoreRun> {
  const factory = await loadFactory()
  const core = await factory.create({ wasmBinary: factory.wasm })
  const lines: string[] = []
  core.setLogger(({ message }) => lines.push(message))
  for (const [path, bytes] of Object.entries(files)) {
    core.FS.writeFile(path, bytes)
  }
  const exitCode = core.exec(...args)
  return { exitCode, log: lines.join('\n'), read: (path) => core.FS.readFile(path).slice() }
}

function parseDuration(log: string): number {
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0
}

export function parseMediaInfo(ffmpegLog: string): MediaInfo {
  const videoLine = ffmpegLog.split('\n').find((line) => /Stream #\d+:\d+.*: Video:/.test(line))
  const size = videoLine ? /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine) : null
  const fps = videoLine ? /(\d+(?:\.\d+)?) fps/.exec(videoLine) : null
  return {
    durationSeconds: parseDuration(ffmpegLog),
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    hasVideo: videoLine !== undefined,
    audioStreams: countAudioStreams(ffmpegLog)
  }
}

/** `-i` with no output exits non-zero but prints the stream listing, which is all we read. */
export async function probeBytes(bytes: Uint8Array, name = 'probe.bin'): Promise<MediaInfo> {
  const run = await runCore(['-i', name], { [name]: bytes })
  return parseMediaInfo(run.log)
}

export interface Window {
  readonly start: number
  readonly duration: number
}

/** Mean loudness of the first audio stream via volumedetect; -Infinity when it reports -inf. */
export async function meanVolumeDb(bytes: Uint8Array, name = 'probe.bin', window?: Window): Promise<number> {
  const seek = window ? ['-ss', String(window.start), '-t', String(window.duration)] : []
  const run = await runCore([...seek, '-i', name, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {
    [name]: bytes
  })
  const match = /mean_volume: (-inf|-?[\d.]+) dB/.exec(run.log)
  if (!match) throw new Error(`volumedetect printed no mean_volume:\n${run.log.slice(-400)}`)
  return match[1] === '-inf' ? -Infinity : Number(match[1])
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export async function pixelAt(
  bytes: Uint8Array,
  name: string,
  x: number,
  y: number,
  atSeconds: number
): Promise<Rgb> {
  const run = await runCore(
    [
      '-ss', String(atSeconds), '-i', name,
      '-frames:v', '1',
      '-vf', `crop=1:1:${x}:${y}`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      'pixel.rgb'
    ],
    { [name]: bytes }
  )
  if (run.exitCode !== 0) throw new Error(`pixelAt failed:\n${run.log.slice(-400)}`)
  const [r, g, b] = run.read('pixel.rgb')
  return { r, g, b }
}

export interface FixtureOptions {
  readonly width?: number
  readonly height?: number
  readonly duration?: number
  readonly color?: string
  readonly frequency?: number
}

export type FixtureKind = 'video' | 'videoNoAudio' | 'twoTrack' | 'tone' | 'png'

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 180
const DEFAULT_DURATION = 2
const ENCODE = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast']

const ffmpegColor = (css: string): string => `0x${css.replace('#', '')}`

/** Tiny synthetic inputs generated with the core itself. */
export async function makeFixture(kind: FixtureKind, opts: FixtureOptions = {}): Promise<Uint8Array> {
  const width = opts.width ?? DEFAULT_WIDTH
  const height = opts.height ?? DEFAULT_HEIGHT
  const duration = opts.duration ?? DEFAULT_DURATION
  const video = ['-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=${width}x${height}:rate=30`]
  const tone = (frequency: number): string[] => [
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`
  ]

  const jobs: Record<FixtureKind, { args: string[]; output: string }> = {
    video: {
      args: [...video, ...tone(opts.frequency ?? 440), ...ENCODE, '-c:a', 'aac', '-shortest', 'out.mp4'],
      output: 'out.mp4'
    },
    videoNoAudio: { args: [...video, ...ENCODE, 'out.mp4'], output: 'out.mp4' },
    twoTrack: {
      args: [
        ...video,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        ...tone(opts.frequency ?? 440),
        '-map', '0:v', '-map', '1:a', '-map', '2:a',
        ...ENCODE, '-c:a', 'aac', '-t', String(duration), 'out.mp4'
      ],
      output: 'out.mp4'
    },
    tone: { args: [...tone(opts.frequency ?? 330), '-c:a', 'pcm_s16le', 'out.wav'], output: 'out.wav' },
    png: {
      args: [
        '-f', 'lavfi', '-i', `color=c=${ffmpegColor(opts.color ?? '#808080')}:s=${width}x${height}:d=1`,
        '-frames:v', '1', 'out.png'
      ],
      output: 'out.png'
    }
  }

  const { args, output } = jobs[kind]
  const run = await runCore(args)
  if (run.exitCode !== 0) throw new Error(`fixture ${kind} failed:\n${run.log.slice(-400)}`)
  return run.read(output)
}
