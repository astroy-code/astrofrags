import type { BrandingSettings } from './brandingSettings.ts'
import { formatOutputSize } from './exportFormat.ts'
import type { ExportPlan } from './exportGraph.ts'
import type { Size } from './outputGeometry.ts'
import { clipSeconds } from './reelGraph.ts'
import { effectiveTransitionSeconds, resolveJoinStyles } from './transitions.ts'

/** One clip of a reel as the page hands it to the export. */
export interface ReelClip {
  readonly start: number
  readonly end: number
  /** The whole source file's length, used to check the trim. */
  readonly duration: number
  /** Zero-based audio stream to use; null when the video has no audio. */
  readonly audioTrackIndex: number | null
  /** The video's displayed size, from the preview element. */
  readonly sourceSize: Size
}

export interface PlanInput {
  readonly clips: readonly ReelClip[]
  readonly branding: BrandingSettings
  readonly hasMusic: boolean
  readonly logo: Size
  /** Rolls "random" transition styles; injectable so plans are testable. */
  readonly random?: () => number
}

/**
 * The export plan for a reel: what to join, how (hard cuts, or one effective transition length
 * and one style per join, rolled now so the graph is deterministic) and at what frame size.
 */
export function buildExportPlan({ clips, branding, hasMusic, logo, random }: PlanInput): ExportPlan {
  if (clips.length === 0) throw new Error('A reel needs at least one clip.')
  const plans = clips.map(({ start, end, audioTrackIndex }) => ({ start, end, audioTrackIndex }))
  const joins = clips.length - 1
  const transition =
    branding.transitionsEnabled && joins > 0
      ? {
          seconds: effectiveTransitionSeconds(branding.transitionSeconds, plans.map(clipSeconds)),
          styles: resolveJoinStyles(branding.transitionStyle, joins, random)
        }
      : null
  return {
    clips: plans,
    transition,
    output: formatOutputSize(branding.exportFormat, clips[0].sourceSize),
    logo,
    watermarkCorner: branding.watermarkCorner,
    format: branding.exportFormat,
    intro: branding.introEnabled,
    outro: branding.outroEnabled,
    cardSeconds: branding.cardDurationSeconds,
    music: hasMusic,
    lowerThird: branding.lowerThirdEnabled
  }
}
