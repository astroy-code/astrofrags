import { useRef } from 'react'
import type { VideoMetadata } from '../lib/clipMetadata.ts'

interface ClipMetadataProbeProps {
  readonly objectUrl: string
  readonly onMetadata: (metadata: VideoMetadata) => void
}

/**
 * A hidden preview element that only reads one clip's metadata (length, picture size, whether the
 * browser can decode it). Every clip needs this, not just the one on screen, so the reel can be
 * exported without opening each clip first.
 */
export function ClipMetadataProbe({ objectUrl, onMetadata }: ClipMetadataProbeProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

  const report = (kind: VideoMetadata['kind']): void => {
    const el = videoRef.current
    if (!el) return
    onMetadata({ kind, duration: el.duration, videoWidth: el.videoWidth, videoHeight: el.videoHeight, error: el.error })
  }

  return (
    <video
      ref={videoRef}
      src={objectUrl}
      preload="metadata"
      muted
      playsInline
      hidden
      aria-hidden="true"
      data-testid="clip-probe"
      onLoadedMetadata={() => report('metadata')}
      onDurationChange={() => report('duration')}
      onError={() => report('error')}
    />
  )
}
