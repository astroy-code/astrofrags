import { isPreviewUndecodable } from './previewSupport.ts'
import type { ClipItem } from './reel.ts'

export interface VideoMetadata {
  /** 'duration' fires before video dimensions are known, so it must not be used to judge decodability. */
  readonly kind: 'metadata' | 'duration' | 'error'
  readonly duration: number
  readonly videoWidth: number
  readonly videoHeight: number
  readonly error: unknown
}

/** What a preview element's report changes on its clip. */
export function applyMetadata(clip: ClipItem, metadata: VideoMetadata): Partial<ClipItem> {
  const durationKnown = Number.isFinite(metadata.duration) && metadata.duration > 0
  const durationChanged = durationKnown && metadata.duration !== clip.duration
  return {
    duration: durationChanged ? metadata.duration : clip.duration,
    // A new duration (including Infinity -> finite on some phone files) resets the range to the whole clip.
    range: durationChanged ? { start: 0, end: metadata.duration } : clip.range,
    previewBroken: metadata.kind === 'duration' ? clip.previewBroken : isPreviewUndecodable(metadata),
    videoSize:
      metadata.videoWidth > 0 && metadata.videoHeight > 0
        ? { width: metadata.videoWidth, height: metadata.videoHeight }
        : clip.videoSize
  }
}
