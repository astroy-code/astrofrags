import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitReelToCap, isOverCap, SHORTS_CAP_SECONDS } from '../fitToCap.ts'
import { effectiveTransitionSeconds, reelSeconds } from '../transitions.ts'
import type { TrimRange } from '../trimRange.ts'

const lengths = (ranges: readonly TrimRange[]): number[] => ranges.map((range) => range.end - range.start)
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
const close = (actual: number, expected: number, tolerance = 0.01): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

const base = { capSeconds: 180, cardSeconds: 0, transitionSeconds: null, minClipSeconds: 1.5 } as const

test('the Shorts cap is three minutes', () => {
  assert.equal(SHORTS_CAP_SECONDS, 180)
})

test('a reel already under the cap is returned unchanged', () => {
  const ranges = [{ start: 0, end: 60 }, { start: 10, end: 70 }]
  assert.deepEqual(fitReelToCap({ ...base, ranges }), ranges)
})

test('every clip shrinks in proportion to land on the cap', () => {
  const ranges = [{ start: 0, end: 120 }, { start: 0, end: 240 }]
  const fitted = fitReelToCap({ ...base, ranges })
  close(sum(lengths(fitted)), 180)
  close(lengths(fitted)[0], 60)
  close(lengths(fitted)[1], 120)
})

test('each clip shrinks symmetrically around its own middle', () => {
  const fitted = fitReelToCap({ ...base, ranges: [{ start: 100, end: 400 }] })
  close(fitted[0].start + fitted[0].end, 500)
  close(lengths(fitted)[0], 180)
})

test('intro and outro cards count against the cap', () => {
  const fitted = fitReelToCap({ ...base, ranges: [{ start: 0, end: 300 }], cardSeconds: 6 })
  close(sum(lengths(fitted)), 174)
})

test('the overlap of a crossfade is credited to the cap', () => {
  const ranges = [{ start: 0, end: 150 }, { start: 0, end: 150 }, { start: 0, end: 150 }]
  const fitted = fitReelToCap({ ...base, ranges, transitionSeconds: 2 })
  // Three clips, two 2 s overlaps: the clips may add up to 184 s and the reel is 180 s.
  close(sum(lengths(fitted)) - 2 * 2, 180, 0.1)
})

test('no clip goes below the minimum, and a clip already shorter is never lengthened', () => {
  const ranges = [{ start: 0, end: 600 }, { start: 0, end: 1 }]
  const fitted = fitReelToCap({ ...base, ranges })
  close(lengths(fitted)[1], 1)
  assert.ok(lengths(fitted)[0] >= 1.5)
  const tiny = fitReelToCap({ ...base, ranges: Array.from({ length: 200 }, () => ({ start: 0, end: 10 })) })
  assert.ok(lengths(tiny).every((length) => length >= 1.5 - 1e-9))
})

test('the shortened ranges stay inside the original ones', () => {
  const ranges = [{ start: 5, end: 305 }, { start: 50, end: 250 }]
  const fitted = fitReelToCap({ ...base, ranges })
  fitted.forEach((range, i) => {
    assert.ok(range.start >= ranges[i].start - 1e-9 && range.end <= ranges[i].end + 1e-9)
  })
})

test('the input is not changed', () => {
  const ranges = Object.freeze([Object.freeze({ start: 0, end: 400 })])
  assert.doesNotThrow(() => fitReelToCap({ ...base, ranges }))
})

test('an empty reel stays empty', () => {
  assert.deepEqual(fitReelToCap({ ...base, ranges: [] }), [])
})

const exportedTotal = (ranges: readonly TrimRange[], cardSeconds: number, requested: number | null): number => {
  const clipLengths = lengths(ranges)
  const overlap = requested !== null && ranges.length > 1 ? effectiveTransitionSeconds(requested, clipLengths) : null
  return reelSeconds(clipLengths, overlap) + cardSeconds
}

test('over the cap is judged to the millisecond, so floating-point noise never counts', () => {
  assert.equal(isOverCap(180, 180), false)
  assert.equal(isOverCap(180 + 5e-7, 180), false)
  assert.equal(isOverCap(180.0004, 180), false)
  assert.equal(isOverCap(180.001, 180), true)
  assert.equal(isOverCap(200, 180), true)
})

test('three long clips with a crossfade end up not over the cap, so the page clears its warning', () => {
  const ranges = [{ start: 0, end: 150 }, { start: 0, end: 150 }, { start: 0, end: 150 }]
  const fitted = fitReelToCap({ ...base, ranges, transitionSeconds: 2 })
  assert.equal(isOverCap(exportedTotal(fitted, 0, 2), 180), false)
  // A second click has nothing left to do.
  assert.deepEqual(fitReelToCap({ ...base, ranges: fitted, transitionSeconds: 2 }), fitted)
})

test('a long reel with a short first clip also ends up not over the cap', () => {
  const ranges = [{ start: 0, end: 2 }, { start: 0, end: 400 }]
  const fitted = fitReelToCap({ ...base, ranges, transitionSeconds: 1 })
  assert.equal(isOverCap(exportedTotal(fitted, 0, 1), 180), false)
})

test('reels the floors cannot dominate always fit, whatever the clips, cards and crossfade', () => {
  let seed = 12345
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  for (let round = 0; round < 400; round += 1) {
    const count = 1 + Math.floor(next() * 5)
    const ranges = Array.from({ length: count }, () => {
      const start = next() * 20
      return { start, end: start + 40 + next() * 400 }
    })
    const cardSeconds = Math.floor(next() * 3) * 3
    const transitionSeconds = next() < 0.5 ? null : 0.1 + next() * 1.9
    const fitted = fitReelToCap({ ...base, ranges, cardSeconds, transitionSeconds })
    const total = exportedTotal(fitted, cardSeconds, transitionSeconds)
    assert.equal(isOverCap(total, 180), false, `round ${round}: ${total}`)
  }
})
