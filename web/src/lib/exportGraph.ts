import type { WatermarkCorner } from './brandingSettings.ts'
import { formatBitrate } from './exportFormat.ts'
import type { ExportFormat } from './exportFormat.ts'
import { FRAME_RATE, RESET_TIMESTAMPS, SILENCE_SOURCE, seconds } from './graphParts.ts'
import type { Size } from './outputGeometry.ts'
import { musicFadeSeconds } from './musicFade.ts'
import { CARD_FADE_SECONDS, watermarkRect } from './overlayLayout.ts'
import { clipSeconds, reelStages } from './reelGraph.ts'
import type { ClipPlan, ReelPlan, Transition } from './reelGraph.ts'
import { reelSeconds } from './transitions.ts'

export type { ClipPlan, Transition }

export interface ExportPlan extends ReelPlan {
  readonly logo: Size
  readonly watermarkCorner: WatermarkCorner
  readonly intro: boolean
  readonly outro: boolean
  readonly cardSeconds: number
  readonly music: boolean
  /** With music: drop the reel's own sound and play the music alone (desktop's "music only"). */
  readonly muteOriginal: boolean
  readonly lowerThird: boolean
}

/** Paths of the input files in the ffmpeg filesystem. `videos` is in the same order as the plan's clips. */
export interface ExportInputs {
  readonly videos: readonly string[]
  readonly logo: string
  readonly introCard?: string
  readonly outroCard?: string
  readonly lowerThird?: string
  readonly music?: string
}

const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'

/** Constant quality for the original format; a preset targets its bitrate, as on desktop. */
function encodeArgs(format: ExportFormat): string[] {
  const bitrate = formatBitrate(format)
  return [
    '-c:v', 'libx264', '-preset', 'ultrafast',
    ...(bitrate ? ['-b:v', bitrate] : ['-crf', '23']),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart'
  ]
}

/** Length of the joined clips: their sum, less the overlap each transition eats. */
function reelLength(plan: ExportPlan): number {
  return reelSeconds(plan.clips.map(clipSeconds), plan.transition?.seconds ?? null)
}

export function planDurationSeconds(plan: ExportPlan): number {
  const cards = (plan.intro ? plan.cardSeconds : 0) + (plan.outro ? plan.cardSeconds : 0)
  return reelLength(plan) + cards
}

interface Labels {
  readonly stages: string[]
  readonly videoLabel: string
  readonly audioLabel: string
}

/** The music, looped to cover the reel and faded at both ends; `bedVolume` quietens it under the reel's sound. */
function musicTrack(plan: ExportPlan, musicIndex: number, bedVolume: boolean): string {
  const length = reelLength(plan)
  const fade = musicFadeSeconds(length)
  const fadeOutStart = Math.max(length - fade, 0)
  return (
    `[${musicIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,` +
    `atrim=0:${seconds(length)},asetpts=PTS-STARTPTS,${bedVolume ? 'volume=0.35,' : ''}` +
    `afade=t=in:st=0:d=${seconds(fade)},afade=t=out:st=${seconds(fadeOutStart)}:d=${seconds(fade)}`
  )
}

/**
 * The desktop music bed (exportReel.ts buildMusicStage), built on the reel's audio only: loop the
 * track to cover the reel, drop it to a quiet bed, fade the ends, duck it under the reel's own
 * audio with sidechain compression, and mix. asplit gives the reel audio the two copies the
 * sidechain trigger and the final mix each need.
 */
function musicStages(plan: ExportPlan, musicIndex: number, reelAudioLabel: string): Labels {
  return {
    stages: [
      `${reelAudioLabel}asplit=2[dry][sidechain]`,
      `${musicTrack(plan, musicIndex, true)}[music]`,
      '[music][sidechain]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked_music]',
      '[dry][ducked_music]amix=inputs=2:duration=first[music_mix_a]'
    ],
    videoLabel: '[main_v]',
    audioLabel: '[music_mix_a]'
  }
}

/**
 * Desktop's "music only" (exportReel.ts buildMusicOnlyStage): the same loop and fades, but the
 * music replaces the reel's sound at full level instead of ducking under it. ffmpeg errors on an
 * unconnected filter output, so the discarded reel audio goes to anullsink.
 */
function musicOnlyStages(plan: ExportPlan, musicIndex: number, reelAudioLabel: string): Labels {
  return {
    stages: [`${reelAudioLabel}anullsink`, `${musicTrack(plan, musicIndex, false)}[music_only_a]`],
    videoLabel: '[main_v]',
    audioLabel: '[music_only_a]'
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
      `scale=${width}:${height},setsar=1,fps=${FRAME_RATE},format=yuv420p,${RESET_TIMESTAMPS}[${kind}_v]`,
    `${SILENCE_SOURCE},atrim=duration=${seconds(plan.cardSeconds)},asetpts=PTS-STARTPTS[${kind}_a]`
  ]
}

/** Joins intro, the reel and outro (whichever are on) with concat. */
function withCards(
  plan: ExportPlan,
  inputs: ExportInputs,
  addInput: (args: string[]) => number,
  reelAudioLabel: string
): Labels {
  const segments: string[] = []
  const stages: string[] = []
  const addCard = (kind: 'intro' | 'outro', path: string | undefined): void => {
    const index = addInput([
      '-loop', '1', '-framerate', String(FRAME_RATE),
      '-t', seconds(plan.cardSeconds), '-i', requireCard(path, kind)
    ])
    stages.push(...cardStages(kind, index, plan))
    segments.push(`[${kind}_v][${kind}_a]`)
  }

  if (plan.intro) addCard('intro', inputs.introCard)
  segments.push(`[main_v]${reelAudioLabel}`)
  if (plan.outro) addCard('outro', inputs.outroCard)
  stages.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=1[carded_v][carded_a]`)
  return { stages, videoLabel: '[carded_v]', audioLabel: '[carded_a]' }
}

/**
 * One ffmpeg command for the whole export: the clips joined (cut or crossfade), then music,
 * intro/outro cards, the watermark and the lower-third, with loudness normalization last.
 */
export function buildExportArgs(plan: ExportPlan, inputs: ExportInputs, outputPath: string): string[] {
  if (inputs.videos.length !== plan.clips.length) {
    throw new Error('Every clip needs its own video file.')
  }
  const inputArgs = plan.clips.flatMap((clip, i) => [
    '-ss', seconds(clip.start), '-t', seconds(clipSeconds(clip)), '-i', inputs.videos[i]
  ])
  let nextInputIndex = plan.clips.length
  const addInput = (args: string[]): number => {
    inputArgs.push(...args)
    return nextInputIndex++
  }

  const cardsOn = plan.intro || plan.outro
  const stages = reelStages(plan, cardsOn)
  let videoLabel = '[main_v]'
  let audioLabel = '[main_a]'

  // Music sits on the reel only, before the cards are joined, so the cards stay silent.
  if (plan.music) {
    if (!inputs.music) throw new Error('The music file is missing.')
    const musicIndex = addInput(['-i', inputs.music])
    const music = plan.muteOriginal
      ? musicOnlyStages(plan, musicIndex, audioLabel)
      : musicStages(plan, musicIndex, audioLabel)
    stages.push(...music.stages)
    audioLabel = music.audioLabel
  }

  if (cardsOn) {
    const carded = withCards(plan, inputs, addInput, audioLabel)
    stages.push(...carded.stages)
    videoLabel = carded.videoLabel
    audioLabel = carded.audioLabel
  }

  // The logo is a still image read once: overlay repeats its last frame until the video ends.
  // (Looping it would re-decode the PNG for every output frame.)
  const logoIndex = addInput(['-i', inputs.logo])
  const mark = watermarkRect(plan.watermarkCorner, plan.output, plan.logo)
  const watermarkOut = plan.lowerThird ? '[watermarked]' : '[outv]'
  stages.push(
    `[${logoIndex}:v]scale=${mark.width}:${mark.height}[wm_logo]`,
    `${videoLabel}[wm_logo]overlay=${mark.x}:${mark.y}${watermarkOut}`
  )

  // The lower-third is a full-canvas transparent PNG, drawn last so it sits on top of the
  // watermark (as on desktop) and spans the whole output, cards included.
  if (plan.lowerThird) {
    if (!inputs.lowerThird) throw new Error('The lower-third image is missing.')
    const lowerThirdIndex = addInput(['-i', inputs.lowerThird])
    stages.push(
      `[${lowerThirdIndex}:v]format=rgba[lower_third]`,
      '[watermarked][lower_third]overlay=0:0[outv]'
    )
  }

  stages.push(`${audioLabel}${LOUDNORM}[outa]`)

  return [
    ...inputArgs,
    '-filter_complex', stages.join('; '),
    '-map', '[outv]',
    '-map', '[outa]',
    ...encodeArgs(plan.format),
    outputPath
  ]
}
