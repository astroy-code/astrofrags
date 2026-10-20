import type { WatermarkCorner } from './brandingSettings.ts'
import type { Size } from './outputGeometry.ts'
import { musicFadeSeconds } from './musicFade.ts'
import { CARD_FADE_SECONDS, watermarkRect } from './overlayLayout.ts'

export interface ExportPlan {
  readonly clip: {
    readonly start: number
    readonly end: number
    /** Zero-based index among the file's audio streams; null when the clip has no audio. */
    readonly audioTrackIndex: number | null
  }
  /** The final frame size (already fitted within 1920x1080 with even dimensions). */
  readonly output: Size
  readonly logo: Size
  readonly watermarkCorner: WatermarkCorner
  readonly intro: boolean
  readonly outro: boolean
  readonly cardSeconds: number
  readonly music: boolean
  readonly lowerThird: boolean
}

/** Paths of the input files in the ffmpeg filesystem. */
export interface ExportInputs {
  readonly video: string
  readonly logo: string
  readonly introCard?: string
  readonly outroCard?: string
  readonly lowerThird?: string
  readonly music?: string
}

const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'
// Fixed sample format too: concat needs every segment's audio to match exactly.
const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo:sample_fmts=fltp'
const SILENCE_SOURCE = 'anullsrc=r=48000:cl=stereo'
// concat needs matching frame rates across segments; this is also desktop's card frame rate.
const CARD_FRAME_RATE = 30
const RESET_TIMESTAMPS = 'setpts=PTS-STARTPTS'

const ENCODE_ARGS = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-movflags', '+faststart'
]

const seconds = (value: number): string => value.toFixed(3)

export function planDurationSeconds(plan: ExportPlan): number {
  const cards = (plan.intro ? plan.cardSeconds : 0) + (plan.outro ? plan.cardSeconds : 0)
  return plan.clip.end - plan.clip.start + cards
}

function mainVideoStage(output: Size, cardsOn: boolean): string {
  const { width, height } = output
  const fit =
    `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  // With cards the clip must match them for concat: 30 fps, yuv420p, timestamps from zero.
  return cardsOn
    ? `${fit},fps=${CARD_FRAME_RATE},format=yuv420p,${RESET_TIMESTAMPS}[main_v]`
    : `${fit}[main_v]`
}

/** The chosen track, or generated silence so the graph is uniform when the clip has no audio. */
function mainAudioStage(plan: ExportPlan, cardsOn: boolean): string {
  const { audioTrackIndex, start, end } = plan.clip
  const tail = cardsOn ? 'asetpts=PTS-STARTPTS' : 'anull'
  if (audioTrackIndex === null) {
    return `${SILENCE_SOURCE},atrim=duration=${seconds(end - start)},asetpts=PTS-STARTPTS[main_a]`
  }
  return `[0:a:${audioTrackIndex}]${STEREO_48K},${tail}[main_a]`
}

interface Labels {
  readonly stages: string[]
  readonly videoLabel: string
  readonly audioLabel: string
}

/**
 * The desktop music bed (exportReel.ts buildMusicStage), built on the clip audio only: loop the
 * track to cover the clip, drop it to a quiet bed, fade the ends, duck it under the clip's own
 * audio with sidechain compression, and mix. asplit gives the clip audio the two copies the
 * sidechain trigger and the final mix each need.
 */
function musicStages(plan: ExportPlan, musicIndex: number, clipAudioLabel: string): Labels {
  const clipSeconds = plan.clip.end - plan.clip.start
  const fade = musicFadeSeconds(clipSeconds)
  const fadeOutStart = Math.max(clipSeconds - fade, 0)
  return {
    stages: [
      `${clipAudioLabel}asplit=2[dry][sidechain]`,
      `[${musicIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,` +
        `atrim=0:${seconds(clipSeconds)},asetpts=PTS-STARTPTS,volume=0.35,` +
        `afade=t=in:st=0:d=${seconds(fade)},afade=t=out:st=${seconds(fadeOutStart)}:d=${seconds(fade)}[music]`,
      '[music][sidechain]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked_music]',
      '[dry][ducked_music]amix=inputs=2:duration=first[music_mix_a]'
    ],
    videoLabel: '[main_v]',
    audioLabel: '[music_mix_a]'
  }
}

function requireCard(path: string | undefined, kind: 'intro' | 'outro'): string {
  if (!path) throw new Error(`The ${kind} card image is missing.`)
  return path
}

/** One card: the PNG held for the card duration, faded in and out, with silent audio. */
function cardStages(kind: 'intro' | 'outro', inputIndex: number, plan: ExportPlan): string[] {
  const fade = Math.min(CARD_FADE_SECONDS, plan.cardSeconds / 2)
  const { width, height } = plan.output
  return [
    `[${inputIndex}:v]fade=t=in:st=0:d=${fade},fade=t=out:st=${seconds(plan.cardSeconds - fade)}:d=${fade},` +
      `scale=${width}:${height},setsar=1,fps=${CARD_FRAME_RATE},format=yuv420p,${RESET_TIMESTAMPS}[${kind}_v]`,
    `${SILENCE_SOURCE},atrim=duration=${seconds(plan.cardSeconds)},asetpts=PTS-STARTPTS[${kind}_a]`
  ]
}

/** Joins intro, the main clip and outro (whichever are on) with concat. */
function withCards(
  plan: ExportPlan,
  inputs: ExportInputs,
  addInput: (args: string[]) => number,
  clipAudioLabel: string
): Labels {
  const segments: string[] = []
  const stages: string[] = []
  const addCard = (kind: 'intro' | 'outro', path: string | undefined): void => {
    const index = addInput([
      '-loop', '1', '-framerate', String(CARD_FRAME_RATE),
      '-t', seconds(plan.cardSeconds), '-i', requireCard(path, kind)
    ])
    stages.push(...cardStages(kind, index, plan))
    segments.push(`[${kind}_v][${kind}_a]`)
  }

  if (plan.intro) addCard('intro', inputs.introCard)
  segments.push(`[main_v]${clipAudioLabel}`)
  if (plan.outro) addCard('outro', inputs.outroCard)
  stages.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=1[carded_v][carded_a]`)
  return { stages, videoLabel: '[carded_v]', audioLabel: '[carded_a]' }
}

/**
 * One ffmpeg command for the whole export: the clip, then (in later stages of the build) music,
 * intro/outro cards, the watermark, and the lower-third, with loudness normalization last.
 */
export function buildExportArgs(plan: ExportPlan, inputs: ExportInputs, outputPath: string): string[] {
  const clipSeconds = plan.clip.end - plan.clip.start
  const inputArgs = ['-ss', seconds(plan.clip.start), '-t', seconds(clipSeconds), '-i', inputs.video]
  let nextInputIndex = 1
  const addInput = (args: string[]): number => {
    inputArgs.push(...args)
    return nextInputIndex++
  }

  const cardsOn = plan.intro || plan.outro
  const stages = [mainVideoStage(plan.output, cardsOn), mainAudioStage(plan, cardsOn)]
  let videoLabel = '[main_v]'
  let audioLabel = '[main_a]'

  // Music sits on the clip only, before the cards are joined, so the cards stay silent.
  if (plan.music) {
    if (!inputs.music) throw new Error('The music file is missing.')
    const music = musicStages(plan, addInput(['-i', inputs.music]), audioLabel)
    stages.push(...music.stages)
    audioLabel = music.audioLabel
  }

  if (cardsOn) {
    const carded = withCards(plan, inputs, addInput, audioLabel)
    stages.push(...carded.stages)
    videoLabel = carded.videoLabel
    audioLabel = carded.audioLabel
  }

  // The logo is a still image: loop it, bounded by the plan duration, and let overlay end with
  // the video (shortest=1) or the render would never stop.
  const logoIndex = addInput(['-loop', '1', '-t', seconds(planDurationSeconds(plan)), '-i', inputs.logo])
  const mark = watermarkRect(plan.watermarkCorner, plan.output, plan.logo)
  stages.push(
    `[${logoIndex}:v]scale=${mark.width}:${mark.height}[wm_logo]`,
    `${videoLabel}[wm_logo]overlay=${mark.x}:${mark.y}:shortest=1[outv]`,
    `${audioLabel}${LOUDNORM}[outa]`
  )

  return [
    ...inputArgs,
    '-filter_complex', stages.join('; '),
    '-map', '[outv]',
    '-map', '[outa]',
    ...ENCODE_ARGS,
    outputPath
  ]
}
