import { buildReframeStage } from './exportFormat.ts'
import type { ExportFormat } from './exportFormat.ts'
import { FRAME_RATE, RESET_TIMESTAMPS, SILENCE_SOURCE, STEREO_48K, seconds } from './graphParts.ts'
import type { Size } from './outputGeometry.ts'
import type { JoinStyle } from './transitions.ts'

export interface ClipPlan {
  readonly start: number
  readonly end: number
  /** Zero-based index among the file's audio streams; null when the clip has no audio. */
  readonly audioTrackIndex: number | null
}

/** A crossfade at every join: how long, and the style of each join (one fewer than the clips). */
export interface Transition {
  readonly seconds: number
  readonly styles: readonly JoinStyle[]
}

/** The part of an export plan that describes the clips and how they are joined. */
export interface ReelPlan {
  readonly clips: readonly ClipPlan[]
  readonly transition: Transition | null
  /** The final frame size (already fitted within 1920x1080 with even dimensions). */
  readonly output: Size
  readonly format: ExportFormat
}

export const clipSeconds = (clip: ClipPlan): number => clip.end - clip.start

/** One clip's picture, fitted to (original) or reframed into (preset) the output frame. */
function clipVideoStage(plan: ReelPlan, index: number, single: boolean, normalize: boolean): string {
  const { width, height } = plan.output
  const input = `[${index}:v:0]`
  const output = single ? '[main_v]' : `[v_${index}]`
  const reframed = single ? '[reframed]' : `[reframed_${index}]`
  const fit =
    plan.format === 'original'
      ? `${input}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
      : `${buildReframeStage(plan.format, input, reframed, single ? '' : `c${index}_`)};${reframed}setsar=1`
  // Joined segments must match: 30 fps, yuv420p, timestamps from zero.
  return normalize
    ? `${fit},fps=${FRAME_RATE},format=yuv420p,${RESET_TIMESTAMPS}${output}`
    : `${fit}${output}`
}

/** The chosen track, or generated silence so the graph is uniform when the clip has no audio. */
function clipAudioStage(clip: ClipPlan, index: number, single: boolean, normalize: boolean): string {
  const output = single ? '[main_a]' : `[a_${index}]`
  if (clip.audioTrackIndex === null) {
    return `${SILENCE_SOURCE},atrim=duration=${seconds(clipSeconds(clip))},asetpts=PTS-STARTPTS${output}`
  }
  const tail = normalize ? 'asetpts=PTS-STARTPTS' : 'anull'
  return `[${index}:a:${clip.audioTrackIndex}]${STEREO_48K},${tail}${output}`
}

/** Hard cuts: every normalised clip, back to back. */
function concatStage(count: number): string {
  const segments = Array.from({ length: count }, (_, i) => `[v_${i}][a_${i}]`).join('')
  return `${segments}concat=n=${count}:v=1:a=1[main_v][main_a]`
}

/**
 * Crossfades, chained pairwise as on desktop. Each join overlaps the clips by the transition
 * length, so the next join's offset is the running length minus that overlap.
 */
function crossfadeStages(plan: ReelPlan, transition: Transition): string[] {
  const stages: string[] = []
  const last = plan.clips.length - 1
  let videoLabel = 'v_0'
  let audioLabel = 'a_0'
  let runningSeconds = clipSeconds(plan.clips[0])
  for (let i = 1; i <= last; i += 1) {
    const offset = runningSeconds - transition.seconds
    const nextVideo = i === last ? 'main_v' : `vx${i}`
    const nextAudio = i === last ? 'main_a' : `ax${i}`
    stages.push(
      `[${videoLabel}][v_${i}]xfade=transition=${transition.styles[i - 1]}:` +
        `duration=${seconds(transition.seconds)}:offset=${seconds(offset)}[${nextVideo}]`,
      `[${audioLabel}][a_${i}]acrossfade=d=${seconds(transition.seconds)}[${nextAudio}]`
    )
    videoLabel = nextVideo
    audioLabel = nextAudio
    runningSeconds = runningSeconds + clipSeconds(plan.clips[i]) - transition.seconds
  }
  return stages
}

/**
 * Every clip normalised, then joined, ending in the labels `[main_v]` and `[main_a]`. A reel of
 * one clip skips the join and keeps its own frame rate unless `forceNormalize` (cards need it).
 */
export function reelStages(plan: ReelPlan, forceNormalize: boolean): string[] {
  const count = plan.clips.length
  if (count === 0) throw new Error('A reel needs at least one clip.')
  const single = count === 1
  const normalize = forceNormalize || !single
  const stages = plan.clips.flatMap((clip, i) => [
    clipVideoStage(plan, i, single, normalize),
    clipAudioStage(clip, i, single, normalize)
  ])
  if (single) return stages
  if (plan.transition && plan.transition.styles.length !== count - 1) {
    throw new Error('A transition needs one style per join.')
  }
  return [...stages, ...(plan.transition ? crossfadeStages(plan, plan.transition) : [concatStage(count)])]
}
