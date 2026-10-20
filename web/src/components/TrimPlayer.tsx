import { useRef } from 'react'
import { formatTime } from '../lib/formatTime.ts'
import { withEnd, withStart } from '../lib/trimRange.ts'
import type { TrimRange } from '../lib/trimRange.ts'

export interface VideoMetadata {
  /** 'duration' fires before video dimensions are known, so it must not be used to judge decodability. */
  readonly kind: 'metadata' | 'duration' | 'error'
  readonly duration: number
  readonly videoWidth: number
  readonly videoHeight: number
  readonly error: unknown
}

interface TrimPlayerProps {
  readonly objectUrl: string
  readonly duration: number
  readonly range: TrimRange
  readonly onMetadata: (metadata: VideoMetadata) => void
  readonly onRangeChange: (range: TrimRange) => void
}

const SLIDER_STEP_SECONDS = 0.01

export function TrimPlayer({ objectUrl, duration, range, onMetadata, onRangeChange }: TrimPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ready = Number.isFinite(duration) && duration > 0

  const reportMetadata = (kind: VideoMetadata['kind']): void => {
    const el = videoRef.current
    if (!el) return
    onMetadata({
      kind,
      duration: el.duration,
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
      error: el.error
    })
  }

  const seek = (seconds: number): void => {
    if (videoRef.current) videoRef.current.currentTime = seconds
  }

  return (
    <section className="trim-player">
      <video
        ref={videoRef}
        src={objectUrl}
        controls
        playsInline
        data-testid="player"
        onLoadedMetadata={() => reportMetadata('metadata')}
        onDurationChange={() => reportMetadata('duration')}
        onError={() => reportMetadata('error')}
      />
      <div className="trim-row">
        <label>
          Start <output>{formatTime(range.start)}</output>
          <input
            type="range"
            data-testid="start-slider"
            min={0}
            max={ready ? duration : 0}
            step={SLIDER_STEP_SECONDS}
            value={range.start}
            disabled={!ready}
            onChange={(event) => {
              const next = withStart(range, Number(event.target.value), duration)
              onRangeChange(next)
              seek(next.start)
            }}
          />
        </label>
        <button
          type="button"
          data-testid="set-start"
          disabled={!ready}
          onClick={() => onRangeChange(withStart(range, videoRef.current?.currentTime ?? 0, duration))}
        >
          Use current position
        </button>
      </div>
      <div className="trim-row">
        <label>
          End <output>{formatTime(range.end)}</output>
          <input
            type="range"
            data-testid="end-slider"
            min={0}
            max={ready ? duration : 0}
            step={SLIDER_STEP_SECONDS}
            value={range.end}
            disabled={!ready}
            onChange={(event) => {
              const next = withEnd(range, Number(event.target.value), duration)
              onRangeChange(next)
              seek(next.end)
            }}
          />
        </label>
        <button
          type="button"
          data-testid="set-end"
          disabled={!ready}
          onClick={() => onRangeChange(withEnd(range, videoRef.current?.currentTime ?? duration, duration))}
        >
          Use current position
        </button>
      </div>
      <p className="trim-summary">
        Clip length {formatTime(range.end - range.start)} of {formatTime(ready ? duration : 0)}
      </p>
    </section>
  )
}
