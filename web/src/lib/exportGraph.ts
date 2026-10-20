import type { WatermarkCorner } from './brandingSettings.ts'
import type { Size } from './outputGeometry.ts'
import { watermarkRect } from './overlayLayout.ts'

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
const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo'
const SILENCE_SOURCE = 'anullsrc=r=48000:cl=stereo'

const ENCODE_ARGS = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-movflags', '+faststart'
]

const seconds = (value: number): string => value.toFixed(3)

export function planDurationSeconds(plan: ExportPlan): number {
  const cards = (plan.intro ? plan.cardSeconds : 0) + (plan.outro ? plan.cardSeconds : 0)
  return plan.clip.end - plan.clip.start + cards
}

function mainVideoStage(output: Size): string {
  const { width, height } = output
  return (
    `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[main_v]`
  )
}

/** The chosen track, or generated silence so the graph is uniform when the clip has no audio. */
function mainAudioStage(plan: ExportPlan): string {
  const { audioTrackIndex, start, end } = plan.clip
  if (audioTrackIndex === null) {
    return `${SILENCE_SOURCE},atrim=duration=${seconds(end - start)},asetpts=PTS-STARTPTS[main_a]`
  }
  return `[0:a:${audioTrackIndex}]${STEREO_48K}[main_a]`
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

  const stages = [mainVideoStage(plan.output), mainAudioStage(plan)]
  const videoLabel = '[main_v]'
  const audioLabel = '[main_a]'

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
