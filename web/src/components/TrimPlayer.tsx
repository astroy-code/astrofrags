import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatTime } from '../lib/formatTime.ts'
import type { VideoMetadata } from '../lib/clipMetadata.ts'
import { withEnd, withStart } from '../lib/trimRange.ts'
import type { TrimRange } from '../lib/trimRange.ts'

export type { VideoMetadata }

interface TrimPlayerProps {
  readonly objectUrl: string
  readonly duration: number
  readonly range: TrimRange
  /** True while an export runs: the trim can't be changed then. */
  readonly locked?: boolean
  readonly onMetadata: (metadata: VideoMetadata) => void
  readonly onRangeChange: (range: TrimRange) => void
  /** Extra controls under the video, given its current time and a way to move it. */
  readonly children?: (video: {
    readonly currentTime: number
    /** The video's time right now, which can be newer than `currentTime` just after a seek. */
    readonly readTime: () => number
    readonly seek: (seconds: number) => void
  }) => ReactNode
}

const SLIDER_STEP_SECONDS = 0.01

export function TrimPlayer({
  objectUrl,
  duration,
  range,
  locked = false,
  onMetadata,
  onRangeChange,
  children
}: TrimPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const ready = Number.isFinite(duration) && duration > 0
  const editable = ready && !locked

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
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
      {children?.({ currentTime, readTime: () => videoRef.current?.currentTime ?? currentTime, seek })}
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
            disabled={!editable}
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
          disabled={!editable}
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
            disabled={!editable}
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
          disabled={!editable}
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
