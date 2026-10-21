import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PX_PER_SECOND,
  clampView,
  columnLevels,
  fitView,
  handleAt,
  hitTest,
  isTap,
  normalizeLevels,
  panBy,
  peakAt,
  timeAtX,
  xAtTime,
  zoomAround,
  zoomToRange
} from '../waveformView.ts'

const close = (actual: number, expected: number, tolerance = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

test('a fitted view shows the whole recording across the strip', () => {
  const view = fitView(200, 400)
  assert.equal(view.start, 0)
  close(timeAtX(400, view), 200)
})

test('a view with no duration or no width falls back to something harmless', () => {
  assert.deepEqual(fitView(0, 400), { start: 0, pxPerSecond: 1 })
  assert.deepEqual(fitView(100, 0), { start: 0, pxPerSecond: 1 })
  assert.deepEqual(clampView({ start: 5, pxPerSecond: 50 }, 0, 400), { start: 0, pxPerSecond: 1 })
})

test('time and x are inverses of each other', () => {
  const view = { start: 12, pxPerSecond: 8 }
  close(timeAtX(xAtTime(37.5, view), view), 37.5)
  close(xAtTime(timeAtX(123, view), view), 123)
})

test('a view cannot zoom out past the fitted view or in past the maximum', () => {
  assert.equal(clampView({ start: 0, pxPerSecond: 0.1 }, 200, 400).pxPerSecond, 2)
  assert.equal(clampView({ start: 0, pxPerSecond: 5000 }, 200, 400).pxPerSecond, MAX_PX_PER_SECOND)
})

test('a recording shorter than the strip is shown fitted even though that is past the maximum zoom', () => {
  const view = clampView({ start: 0, pxPerSecond: 20 }, 2, 400)
  assert.equal(view.pxPerSecond, 200)
  assert.equal(view.start, 0)
})

test('a view cannot scroll before the start or past the end', () => {
  assert.equal(clampView({ start: -50, pxPerSecond: 10 }, 200, 400).start, 0)
  // 400 px at 10 px/s shows 40 s, so the latest start of a 200 s recording is 160 s.
  assert.equal(clampView({ start: 999, pxPerSecond: 10 }, 200, 400).start, 160)
})

test('zooming keeps the anchored time under the same x', () => {
  const view = { start: 40, pxPerSecond: 10 }
  const zoomed = zoomAround(view, 2, 55, 600, 400)
  close(xAtTime(55, zoomed), xAtTime(55, view))
  assert.equal(zoomed.pxPerSecond, 20)
})

test('zooming is limited at both ends and the view stays inside the recording', () => {
  const fitted = fitView(200, 400)
  assert.equal(zoomAround(fitted, 0.5, 100, 200, 400).pxPerSecond, fitted.pxPerSecond)
  assert.equal(zoomAround(fitted, 1000, 100, 200, 400).pxPerSecond, MAX_PX_PER_SECOND)
  const nearEnd = zoomAround({ start: 160, pxPerSecond: 10 }, 4, 199, 200, 400)
  assert.ok(nearEnd.start >= 0)
  assert.ok(timeAtX(400, nearEnd) <= 200 + 1e-6)
})

test('panning right moves earlier time into view and is clamped', () => {
  const view = { start: 50, pxPerSecond: 10 }
  close(panBy(view, 100, 200, 400).start, 40)
  close(panBy(view, -100, 200, 400).start, 60)
  assert.equal(panBy(view, 100000, 200, 400).start, 0)
  assert.equal(panBy(view, -100000, 200, 400).start, 160)
})

test('zooming to a range shows it with a margin on each side', () => {
  const view = zoomToRange({ start: 100, end: 120 }, 600, 400)
  assert.ok(timeAtX(0, view) < 100)
  assert.ok(timeAtX(400, view) > 120)
  assert.ok(timeAtX(400, view) - timeAtX(0, view) < 40)
})

test('zooming to a range near the edges stays inside the recording', () => {
  const view = zoomToRange({ start: 0, end: 10 }, 600, 400)
  assert.equal(view.start, 0)
  const end = zoomToRange({ start: 590, end: 600 }, 600, 400)
  assert.ok(timeAtX(400, end) <= 600 + 1e-6)
})

/** One window per 0.1 s, all quiet except the ones given. */
const loudness = (seconds: number, loud: Readonly<Record<number, number>> = {}): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * 10) }, (_, index) => loud[index] ?? 0.01)

test('each column shows the loudest window of its time span', () => {
  // 10 s over 100 columns: each column is exactly one window.
  const levels = columnLevels(loudness(10, { 25: 0.9 }), fitView(10, 100), 100)
  assert.equal(levels.length, 100)
  close(levels[25], 0.9)
  close(levels[24], 0.01)
})

test('a column covering many windows takes the loudest of them', () => {
  // 100 s over 10 columns: each column spans 10 s (100 windows).
  const levels = columnLevels(loudness(100, { 455: 0.8 }), fitView(100, 10), 10)
  close(levels[4], 0.8)
  close(levels[3], 0.01)
})

test('zoomed in so one window spans several columns, the window repeats', () => {
  const view = { start: 2, pxPerSecond: 100 }
  const levels = columnLevels(loudness(10, { 25: 0.9 }), view, 100)
  // Window 25 covers 2.5-2.6 s, which is x 50..60.
  close(levels[55], 0.9)
  close(levels[49], 0.01)
  close(levels[61], 0.01)
})

test('columns past the end of the recording are empty', () => {
  const levels = columnLevels(loudness(5), { start: 0, pxPerSecond: 20 }, 200)
  close(levels[50], 0.01)
  assert.equal(levels[150], 0)
})

test('a four-hour recording is reduced to one value per column', () => {
  const fourHours = new Float32Array(4 * 3600 * 10).fill(0.02)
  fourHours[72000] = 0.7
  const levels = columnLevels(fourHours, fitView(4 * 3600, 360), 360)
  assert.equal(levels.length, 360)
  assert.equal(Math.max(...levels), Math.fround(0.7))
})

test('levels are scaled to the loudest value with a thin line for silence', () => {
  assert.deepEqual(normalizeLevels([0, 0.5, 1], 1), [0.02, 0.5, 1])
  assert.deepEqual(normalizeLevels([0.5], 0.25), [1])
  assert.deepEqual(normalizeLevels([0, 0], 0), [0.02, 0.02])
  assert.deepEqual(normalizeLevels([0], 1, 0.1), [0.1])
})

const view = fitView(100, 400)
const range = { start: 20, end: 60 }
const peaks = [{ time: 40, score: 1 }, { time: 80, score: 2 }]

test('a point near a handle grabs that handle', () => {
  assert.deepEqual(hitTest(xAtTime(20, view) + 10, view, { range, peaks }), { kind: 'start' })
  assert.deepEqual(hitTest(xAtTime(60, view) - 10, view, { range, peaks }), { kind: 'end' })
})

test('a handle wins over a marker that is also in reach', () => {
  const close = { range: { start: 20, end: 60 }, peaks: [{ time: 21, score: 1 }] }
  assert.deepEqual(hitTest(xAtTime(21, view), view, close), { kind: 'start' })
})

test('a point near a marker, but not a handle, taps that marker', () => {
  assert.deepEqual(hitTest(xAtTime(80, view) + 5, view, { range, peaks }), { kind: 'peak', peak: peaks[1] })
})

test('the nearer of two markers in reach wins', () => {
  const pair = [{ time: 50, score: 1 }, { time: 55, score: 2 }]
  assert.deepEqual(hitTest(xAtTime(54, view), view, { range: { start: 0, end: 1 }, peaks: pair }), {
    kind: 'peak',
    peak: pair[1]
  })
})

test('a point out of reach of everything hits nothing', () => {
  assert.deepEqual(hitTest(xAtTime(70, view), view, { range, peaks }), { kind: 'none' })
})

test('a touch that barely moves is a tap, one that moves further is not', () => {
  assert.equal(isTap(10, 10, 16, 10), true)
  assert.equal(isTap(10, 10, 17, 10), false)
  assert.equal(isTap(10, 10, 10, 4), true)
  assert.equal(isTap(10, 10, 10, 3), false)
  assert.equal(isTap(10, 10, 16, 16), true)
})

test('handleAt finds the nearer handle in reach, or none', () => {
  assert.equal(handleAt(xAtTime(20, view) + 10, view, range), 'start')
  assert.equal(handleAt(xAtTime(60, view) - 10, view, range), 'end')
  assert.equal(handleAt(xAtTime(40, view), view, range), null)
})

test('peakAt finds a marker even when a handle is also in reach', () => {
  const near = [{ time: 21, score: 1 }]
  assert.deepEqual(peakAt(xAtTime(21, view), view, near), near[0])
  assert.equal(peakAt(xAtTime(70, view), view, near), null)
  const pair = [{ time: 50, score: 1 }, { time: 55, score: 2 }]
  assert.deepEqual(peakAt(xAtTime(54, view), view, pair), pair[1])
})
