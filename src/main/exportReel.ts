import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import { escapeSubtitlesPath } from './subtitlesPath'
import { buildReframeFilter, presetBitrate, type ExportPreset } from './exportPresets'

interface ClipRange {
  videoPath: string
  start: number
  end: number
  srtPath?: string
}

export const TRANSITION_STYLES = [
  'fade',
  'dissolve',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'circleopen',
  'circleclose',
  'pixelize',
  'zoomin',
  'random'
] as const
export type TransitionStyle = (typeof TRANSITION_STYLES)[number]

// The pool "random" draws from — excludes 'random' itself, obviously.
const RANDOM_STYLE_POOL: Exclude<TransitionStyle, 'random'>[] = TRANSITION_STYLES.filter(
  (s): s is Exclude<TransitionStyle, 'random'> => s !== 'random'
)

export interface ReelOptions {
  transitions?: boolean
  transitionStyle?: TransitionStyle
  transitionDuration?: number
  musicPath?: string
  muteOriginal?: boolean
  preset?: ExportPreset
}

const DEFAULT_TRANSITION_DURATION = 0.75
const MAX_TRANSITION_DURATION = 2

interface CombinedStage {
  filter: string
  videoLabel: string
  audioLabel: string
  totalDuration: number
}

/** Clips can come from different source files (stitching across multiple recordings), so
 * each clip's trim/subtitle stage references its own ffmpeg input index rather than a
 * single shared `0:v:0`/`0:a:0`. */
function buildClipSegments(clips: ClipRange[], inputIndexByPath: Map<string, number>): string[] {
  return clips.map((clip, i) => {
    const inputIndex = inputIndexByPath.get(clip.videoPath)
    // Each clip's SRT is already 0-based relative to its own trim start (matching
    // what transcribeClip produces), so it can burn in pre-trim with no offset math.
    const subtitleStage = clip.srtPath ? `,subtitles=${escapeSubtitlesPath(clip.srtPath)}` : ''
    const v = `[${inputIndex}:v:0]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS${subtitleStage}[v${i}]`
    const a = `[${inputIndex}:a:0]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS[a${i}]`
    return `${v}; ${a}`
  })
}

function buildConcatStage(clips: ClipRange[]): CombinedStage {
  const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join('')
  const filter = `${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`
  const totalDuration = clips.reduce((sum, c) => sum + (c.end - c.start), 0)
  return { filter, videoLabel: '[outv]', audioLabel: '[outa]', totalDuration }
}

/** Chains clips pairwise with a crossfade instead of a hard cut. Each xfade/acrossfade
 * shortens the running total by the transition length (the overlap isn't duplicated),
 * so both the xfade `offset` and the cumulative duration must account for that shrinkage. */
function buildCrossfadeStage(clips: ClipRange[], style: TransitionStyle, requestedDuration: number): CombinedStage {
  const durations = clips.map((c) => c.end - c.start)
  const shortest = Math.min(...durations)
  const transitionDuration = Math.min(requestedDuration, shortest / 2)

  const stages: string[] = []
  let vLabel = 'v0'
  let aLabel = 'a0'
  let cumulativeDuration = durations[0]

  for (let i = 1; i < clips.length; i++) {
    const offset = cumulativeDuration - transitionDuration
    const nextV = `vx${i}`
    const nextA = `ax${i}`
    // "random" rolls a fresh style per cut (not once for the whole reel), so a longer
    // reel doesn't just repeat the same wipe over and over.
    const edgeStyle =
      style === 'random' ? RANDOM_STYLE_POOL[Math.floor(Math.random() * RANDOM_STYLE_POOL.length)] : style
    // acrossfade has no video-matching wipe/slide/etc equivalent — a plain audio fade
    // reads fine under any video transition style, so it doesn't need to track edgeStyle.
    stages.push(
      `[${vLabel}][v${i}]xfade=transition=${edgeStyle}:duration=${transitionDuration}:offset=${offset}[${nextV}]`
    )
    stages.push(`[${aLabel}][a${i}]acrossfade=d=${transitionDuration}[${nextA}]`)
    vLabel = nextV
    aLabel = nextA
    cumulativeDuration = cumulativeDuration + durations[i] - transitionDuration
  }

  return { filter: stages.join('; '), videoLabel: `[${vLabel}]`, audioLabel: `[${aLabel}]`, totalDuration: cumulativeDuration }
}

/** Loops the music track (however short) to cover the reel, attenuates it as a background
 * bed, then ducks it under the reel's own audio via sidechain compression so it quiets
 * automatically under speech/game sound instead of fighting with it at a constant volume.
 * A filter link label can only feed one filter input, but the reel's own audio is needed
 * twice here (once as the sidechain trigger, once in the final mix) — asplit makes the
 * two independent copies that requires. */
function buildMusicStage(
  audioLabel: string,
  totalDuration: number,
  musicInputIndex: number
): { filter: string; audioLabel: string } {
  const filter = [
    `${audioLabel}asplit=2[dry][sidechain]`,
    `[${musicInputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,` +
      `atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=0.35[music]`,
    `[music][sidechain]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[duckedmusic]`,
    `[dry][duckedmusic]amix=inputs=2:duration=first[finalaudio]`
  ].join('; ')
  return { filter, audioLabel: '[finalaudio]' }
}

/** Same music loop/trim as buildMusicStage, but replaces the reel's own audio outright
 * instead of ducking under it — video is unaffected, and burned-in captions still work
 * since those live on the video stream, independent of which audio track plays. */
function buildMusicOnlyStage(
  totalDuration: number,
  musicInputIndex: number
): { filter: string; audioLabel: string } {
  const filter =
    `[${musicInputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,` +
    `atrim=0:${totalDuration},asetpts=PTS-STARTPTS[finalaudio]`
  return { filter, audioLabel: '[finalaudio]' }
}

export async function renderReel(clips: ClipRange[], outputPath: string, options: ReelOptions = {}): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }
  if (clips.length === 0) {
    throw new Error('No clips to combine')
  }

  // Clips may share the same source file (the common case) or span several — each unique
  // path gets exactly one ffmpeg -i input, reused by every clip that came from it.
  const uniqueVideoPaths = [...new Set(clips.map((c) => c.videoPath))]
  const inputIndexByPath = new Map(uniqueVideoPaths.map((path, i) => [path, i]))

  const useTransitions = Boolean(options.transitions) && clips.length > 1
  const transitionDuration = Math.min(
    Math.max(options.transitionDuration ?? DEFAULT_TRANSITION_DURATION, 0.1),
    MAX_TRANSITION_DURATION
  )
  const combined = useTransitions
    ? buildCrossfadeStage(clips, options.transitionStyle ?? 'fade', transitionDuration)
    : buildConcatStage(clips)

  const filterParts = [...buildClipSegments(clips, inputIndexByPath), combined.filter]
  let audioLabel = combined.audioLabel
  const args = ['-y']
  for (const path of uniqueVideoPaths) {
    args.push('-i', path)
  }

  if (options.musicPath) {
    const musicInputIndex = uniqueVideoPaths.length
    args.push('-i', options.musicPath)
    if (options.muteOriginal) {
      // The reel's own audio output still has to go somewhere — ffmpeg errors on any
      // unconnected filter output — so explicitly discard it via anullsink rather than
      // just dropping the reference to it.
      filterParts.push(`${audioLabel}anullsink`)
      const music = buildMusicOnlyStage(combined.totalDuration, musicInputIndex)
      filterParts.push(music.filter)
      audioLabel = music.audioLabel
    } else {
      const music = buildMusicStage(audioLabel, combined.totalDuration, musicInputIndex)
      filterParts.push(music.filter)
      audioLabel = music.audioLabel
    }
  }

  // Reframe (if any) runs on the fully composed reel, after transitions/concat — one pass
  // over the finished video rather than reframing each clip separately.
  let videoLabel = combined.videoLabel
  const preset = options.preset ?? 'original'
  if (preset !== 'original') {
    filterParts.push(buildReframeFilter(preset, videoLabel, '[reframedreel]'))
    videoLabel = '[reframedreel]'
  }

  const bitrate = presetBitrate(preset)
  args.push(
    '-filter_complex', filterParts.join('; '),
    '-map', videoLabel,
    '-map', audioLabel,
    '-c:v', 'libx264',
    // xfade blends in higher-precision color internally and doesn't convert back down,
    // so without pinning this, libx264 auto-selects a High 4:4:4 profile that almost no
    // consumer player (including Windows' own) can decode.
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast'
  )
  if (bitrate) {
    args.push('-b:v', bitrate)
  } else {
    args.push('-crf', '20')
  }
  args.push('-c:a', 'aac', outputPath)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args)

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
        return
      }
      resolve()
    })
  })
}
