import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Peak } from '../lib/highlights.ts'
import { withEnd, withStart } from '../lib/trimRange.ts'
import type { TrimRange } from '../lib/trimRange.ts'
import {
  clampView,
  columnLevels,
  fitView,
  handleAt,
  isTap,
  normalizeLevels,
  panBy,
  peakAt,
  timeAtX,
  xAtTime,
  zoomAround,
  zoomToRange
} from '../lib/waveformView.ts'
import type { View } from '../lib/waveformView.ts'

interface WaveformProps {
  readonly loudness: Float32Array
  readonly duration: number
  readonly range: TrimRange
  readonly peaks: readonly Peak[]
  readonly currentTime: number
  /** The video's time right now (the playhead can lag a just-finished seek). */
  readonly readTime: () => number
  /** True while an export runs: handles and taps do nothing; panning and zoom still work. */
  readonly locked: boolean
  readonly onSeek: (time: number) => void
  readonly onRangeChange: (range: TrimRange) => void
  readonly onAddMoment: (peak: Peak) => void
}

type Gesture =
  | {
      readonly kind: 'handle'
      readonly handle: 'start' | 'end'
      readonly downX: number
      readonly downY: number
      /** Where the handle is, relative to the finger, so it moves with the finger instead of jumping to it. */
      readonly grabOffset: number
      readonly moved: boolean
    }
  | { readonly kind: 'tap-or-pan'; readonly downX: number; readonly downY: number; readonly view: View; readonly moved: boolean }
  | { readonly kind: 'pinch'; readonly distance: number; readonly view: View; readonly anchorTime: number }

const HEIGHT_PX = 96
const ZOOM_STEP = 2
const BAR_FRACTION = 0.9
const MARKER_COLOR = '#f2994a'
const PLAYHEAD_COLOR = '#eb5757'
const REGION_COLOR = 'rgba(47, 129, 247, 0.22)'
const HANDLE_COLOR = '#2f81f7'

const loudestOf = (loudness: Float32Array): number => loudness.reduce((max, value) => (value > max ? value : max), 0)

/** Loudness of the recording as a strip: trim region with handles, moment markers, playhead. */
export function Waveform({
  loudness,
  duration,
  range,
  peaks,
  currentTime,
  readTime,
  locked,
  onSeek,
  onRangeChange,
  onAddMoment
}: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const [width, setWidth] = useState(0)
  const [custom, setCustom] = useState<View | null>(null)

  const view = useMemo(
    () => (custom ? clampView(custom, duration, width) : fitView(duration, width)),
    [custom, duration, width]
  )
  const loudest = useMemo(() => loudestOf(loudness), [loudness])
  const bars = useMemo(
    () => normalizeLevels(columnLevels(loudness, view, width), loudest),
    [loudness, view, width, loudest]
  )

  useEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const measure = (): void => setWidth(Math.floor(box.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || width <= 0) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(HEIGHT_PX * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, HEIGHT_PX)

    const startX = xAtTime(range.start, view)
    const endX = xAtTime(range.end, view)
    context.fillStyle = REGION_COLOR
    context.fillRect(startX, 0, endX - startX, HEIGHT_PX)

    const barColor = getComputedStyle(canvas).color
    bars.forEach((level, column) => {
      const inside = column >= startX && column <= endX
      const height = Math.max(1, level * HEIGHT_PX * BAR_FRACTION)
      context.globalAlpha = inside ? 0.9 : 0.45
      context.fillStyle = barColor
      context.fillRect(column, (HEIGHT_PX - height) / 2, 1, height)
    })
    context.globalAlpha = 1

    context.fillStyle = MARKER_COLOR
    peaks.forEach((peak) => {
      const x = xAtTime(peak.time, view)
      context.fillRect(x - 1, 0, 2, HEIGHT_PX)
      context.beginPath()
      context.moveTo(x - 5, 0)
      context.lineTo(x + 5, 0)
      context.lineTo(x, 8)
      context.fill()
    })

    context.fillStyle = HANDLE_COLOR
    for (const x of [startX, endX]) {
      context.fillRect(x - 1.5, 0, 3, HEIGHT_PX)
      context.beginPath()
      context.arc(x, HEIGHT_PX / 2, 7, 0, Math.PI * 2)
      context.fill()
    }

    context.fillStyle = PLAYHEAD_COLOR
    context.fillRect(xAtTime(currentTime, view) - 1, 0, 2, HEIGHT_PX)
  }, [bars, view, width, range, peaks, currentTime])

  const localPoint = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = localPoint(event)
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        kind: 'pinch',
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        view,
        anchorTime: timeAtX((a.x + b.x) / 2, view)
      }
      return
    }
    const handle = locked ? null : handleAt(point.x, view, range)
    gesture.current = handle
      ? {
          kind: 'handle',
          handle,
          downX: point.x,
          downY: point.y,
          grabOffset: xAtTime(range[handle], view) - point.x,
          moved: false
        }
      : { kind: 'tap-or-pan', downX: point.x, downY: point.y, view, moved: false }
  }

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = gesture.current
    if (!current || !pointers.current.has(event.pointerId)) return
    const point = localPoint(event)
    pointers.current.set(event.pointerId, point)

    if (current.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!b) return
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / current.distance
      const pxPerSecond = current.view.pxPerSecond * factor
      const midX = (a.x + b.x) / 2
      setCustom(clampView({ start: current.anchorTime - midX / pxPerSecond, pxPerSecond }, duration, width))
    } else if (current.kind === 'handle') {
      // A press that barely moves is a tap, not the start of a drag.
      if (!current.moved && isTap(current.downX, current.downY, point.x, point.y)) return
      gesture.current = { ...current, moved: true }
      const time = Math.min(Math.max(timeAtX(point.x + current.grabOffset, view), 0), duration)
      const next = current.handle === 'start' ? withStart(range, time, duration) : withEnd(range, time, duration)
      onRangeChange(next)
      onSeek(current.handle === 'start' ? next.start : next.end)
    } else if (current.moved || !isTap(current.downX, current.downY, point.x, point.y)) {
      gesture.current = { ...current, moved: true }
      setCustom(panBy(current.view, point.x - current.downX, duration, width))
    }
  }

  const handleUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = gesture.current
    const point = localPoint(event)
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    if (!current || current.kind === 'pinch' || current.moved || locked) return
    // A tap: on a marker it adds that moment (even right beside a handle), elsewhere it seeks.
    const peak = peakAt(point.x, view, peaks)
    if (peak) onAddMoment(peak)
    else onSeek(Math.min(Math.max(timeAtX(point.x, view), 0), duration))
  }

  const handleCancel = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) gesture.current = null
  }

  const zoomBy = useCallback(
    (factor: number) => setCustom(zoomAround(view, factor, timeAtX(width / 2, view), duration, width)),
    [view, duration, width]
  )

  return (
    <div className="waveform">
      <div ref={boxRef} className="waveform-box">
        <canvas
          ref={canvasRef}
          data-testid="waveform"
          data-zoom={Number(view.pxPerSecond.toFixed(3))}
          data-markers={peaks.length}
          data-locked={locked}
          role="img"
          aria-label="Loudness of the recording. Loud moments are marked; the shaded part is the trimmed clip."
          style={{ width: '100%', height: HEIGHT_PX }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleCancel}
        />
      </div>
      <div className="waveform-controls">
        <button type="button" data-testid="waveform-zoom-out" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          −
        </button>
        <button type="button" data-testid="waveform-zoom-in" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
          +
        </button>
        <button type="button" data-testid="waveform-fit" onClick={() => setCustom(null)}>
          Fit
        </button>
        <button
          type="button"
          data-testid="waveform-selection"
          onClick={() => setCustom(zoomToRange(range, duration, width))}
        >
          Selection
        </button>
        <button
          type="button"
          data-testid="add-clip-here"
          disabled={locked}
          onClick={() => onAddMoment({ time: readTime(), score: 0 })}
        >
          Add clip here
        </button>
      </div>
    </div>
  )
}
