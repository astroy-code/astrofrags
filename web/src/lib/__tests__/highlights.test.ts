import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseHighlights, findPeaks, peakRange, peaksFromChunks, planChunks, rmsPerWindow, windowsOfChunk } from '../highlights.ts'
import type { Peak } from '../highlights.ts'

const close = (actual: number, expected: number, tolerance = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

/** A quiet signal of `count` windows with a spike of `height` at each given window index. */
const withSpikes = (count: number, spikes: Readonly<Record<number, number>>): number[] =>
  Array.from({ length: count }, (_, index) => spikes[index] ?? 1)

test('rmsPerWindow gives one value per 0.1 s and a shorter last window', () => {
  const samples = new Int16Array(8000 * 0.25).fill(16384)
  const windows = rmsPerWindow(samples, 8000)
  assert.equal(windows.length, 3)
  windows.forEach((value) => close(value, 0.5))
})

test('rmsPerWindow of no samples is empty', () => {
  assert.deepEqual(rmsPerWindow(new Int16Array(0), 8000), [])
})

test('findPeaks reports a spike at its window time with its score', () => {
  const peaks = findPeaks(withSpikes(100, { 40: 50 }))
  assert.equal(peaks.length, 1)
  close(peaks[0].time, 4)
  assert.equal(peaks[0].score, 50)
})

test('peaks within 3 s of each other merge into the stronger one', () => {
  const peaks = findPeaks(withSpikes(200, { 50: 40, 70: 60 }))
  assert.equal(peaks.length, 1)
  close(peaks[0].time, 7)
  assert.equal(peaks[0].score, 60)
})

test('peaks more than 3 s apart stay separate, strongest first', () => {
  const peaks = findPeaks(withSpikes(200, { 20: 40, 100: 70 }))
  assert.deepEqual(peaks.map((peak) => peak.score), [70, 40])
  close(peaks[0].time, 10)
  close(peaks[1].time, 2)
})

test('only the 12 strongest peaks are kept', () => {
  const spikes: Record<number, number> = {}
  for (let i = 0; i < 15; i += 1) spikes[20 + i * 50] = 100 + i
  const peaks = findPeaks(withSpikes(900, spikes))
  assert.equal(peaks.length, 12)
  assert.equal(peaks[0].score, 114)
  assert.equal(peaks[11].score, 103)
})

test('a flat signal, an empty one and a single window have no peaks', () => {
  assert.deepEqual(findPeaks(withSpikes(50, {})), [])
  assert.deepEqual(findPeaks([]), [])
  assert.deepEqual(findPeaks([5]), [])
})

test('peakRange pads 5 s before and 3 s after', () => {
  assert.deepEqual(peakRange({ time: 20, score: 1 }, 100), { start: 15, end: 23 })
})

test('peakRange clamps to the start and the end of the recording', () => {
  assert.deepEqual(peakRange({ time: 2, score: 1 }, 100), { start: 0, end: 5 })
  assert.deepEqual(peakRange({ time: 99, score: 1 }, 100), { start: 94, end: 100 })
})

test('peakRange with an unknown duration does not clamp the end', () => {
  assert.deepEqual(peakRange({ time: 20, score: 1 }, 0), { start: 15, end: 23 })
})

const peak = (time: number, score: number): Peak => ({ time, score })

test('chooseHighlights takes the strongest peaks and returns them in time order', () => {
  const chosen = chooseHighlights({ peaks: [peak(10, 1), peak(40, 3), peak(70, 2)], duration: 100, taken: [] })
  assert.deepEqual(chosen.map((item) => item.peak.time), [10, 40, 70])
})

test('chooseHighlights skips a peak whose range overlaps a stronger chosen one', () => {
  const chosen = chooseHighlights({ peaks: [peak(30, 5), peak(34, 4), peak(60, 1)], duration: 100, taken: [] })
  assert.deepEqual(chosen.map((item) => item.peak.time), [30, 60])
})

test('chooseHighlights skips a peak that overlaps a range already in the reel', () => {
  const chosen = chooseHighlights({
    peaks: [peak(30, 5), peak(60, 1)],
    duration: 100,
    taken: [{ start: 28, end: 40 }]
  })
  assert.deepEqual(chosen.map((item) => item.peak.time), [60])
})

test('chooseHighlights stops at the clip limit, keeping the strongest', () => {
  const peaks = Array.from({ length: 10 }, (_, i) => peak(i * 20 + 10, i + 1))
  const chosen = chooseHighlights({ peaks, duration: 300, taken: [], maxClips: 3 })
  assert.deepEqual(chosen.map((item) => item.peak.score), [8, 9, 10])
})

test('chooseHighlights never takes more than 8 by default, and none without peaks', () => {
  const peaks = Array.from({ length: 12 }, (_, i) => peak(i * 20 + 10, i + 1))
  assert.equal(chooseHighlights({ peaks, duration: 300, taken: [] }).length, 8)
  assert.deepEqual(chooseHighlights({ peaks: [], duration: 300, taken: [] }), [])
})

test('chooseHighlights never returns two overlapping ranges', () => {
  const peaks = Array.from({ length: 30 }, (_, i) => peak(i * 3, 30 - i))
  const chosen = chooseHighlights({ peaks, duration: 100, taken: [] })
  chosen.forEach((a, i) =>
    chosen.slice(i + 1).forEach((b) => assert.ok(a.range.end <= b.range.start || b.range.end <= a.range.start))
  )
})

test('a recording is planned as consecutive chunks with a shorter last one', () => {
  assert.deepEqual(planChunks(25, 10), [
    { start: 0, length: 10 },
    { start: 10, length: 10 },
    { start: 20, length: 5 }
  ])
  assert.deepEqual(planChunks(10, 10), [{ start: 0, length: 10 }])
  assert.deepEqual(planChunks(0, 10), [])
  assert.deepEqual(planChunks(Number.NaN, 10), [])
})

test('a long recording is planned in 10-minute chunks by default', () => {
  const chunks = planChunks(4 * 3600)
  assert.equal(chunks.length, 24)
  assert.ok(chunks.every((chunk) => chunk.length === 600))
})

test('a chunk keeps exactly its expected number of windows, whatever the decoder returned', () => {
  const loud = (samples: number): Int16Array => new Int16Array(samples).fill(1000)
  const toBytes = (data: Int16Array): Uint8Array => new Uint8Array(data.buffer)
  const exact = windowsOfChunk(toBytes(loud(8000 * 2)), 20)
  assert.equal(exact.length, 20)
  // One sample too many would start an extra window and push everything after it 0.1 s late.
  assert.equal(windowsOfChunk(toBytes(loud(8000 * 2 + 1)), 20).length, 20)
  // A short decode is padded with silence so later chunks keep their place in time.
  const padded = windowsOfChunk(toBytes(loud(8000 * 1)), 20)
  assert.equal(padded.length, 20)
  assert.equal(padded[19], 0)
  // Without an expected count (the last chunk) every window is kept.
  assert.equal(windowsOfChunk(toBytes(loud(8000 * 2 + 400)), null).length, 21)
})

/** PCM for a quiet chunk with a loud burst at `at` seconds into it. */
function chunkPcm(seconds: number, at: number | null, extraSamples = 0): Uint8Array {
  const samples = new Int16Array(8000 * seconds + extraSamples).fill(100)
  if (at !== null) samples.fill(20000, Math.round(at * 8000), Math.round((at + 0.4) * 8000))
  return new Uint8Array(samples.buffer)
}

test('peaks found chunk by chunk land at their time in the whole recording', async () => {
  const bursts: Record<number, number | null> = { 0: 3, 1: null, 2: 3 }
  const peaks = await peaksFromChunks({
    durationSeconds: 25,
    chunkSeconds: 10,
    decode: async (chunk, index) => chunkPcm(chunk.length, bursts[index] ?? null)
  })
  const times = peaks.map((peak) => peak.time).sort((a, b) => a - b)
  assert.equal(times.length, 2)
  assert.ok(Math.abs(times[0] - 3) < 0.3, `first at ${times[0]}`)
  assert.ok(Math.abs(times[1] - 23) < 0.3, `second at ${times[1]}`)
})

test('a decoder that returns an extra sample per chunk does not drift later peaks', async () => {
  const peaks = await peaksFromChunks({
    durationSeconds: 40,
    chunkSeconds: 10,
    decode: async (chunk, index) => chunkPcm(chunk.length, index === 3 ? 5 : null, 1)
  })
  assert.equal(peaks.length, 1)
  assert.ok(Math.abs(peaks[0].time - 35) < 0.2, `at ${peaks[0].time}`)
})

test('a chunk that fails to decode fails the whole search', async () => {
  await assert.rejects(
    peaksFromChunks({
      durationSeconds: 20,
      chunkSeconds: 10,
      decode: async (_chunk, index) => {
        if (index === 1) throw new Error('decode failed')
        return chunkPcm(10, null)
      }
    }),
    /decode failed/
  )
})

test('the chunks are asked for in order, one at a time', async () => {
  const asked: number[] = []
  let running = 0
  await peaksFromChunks({
    durationSeconds: 30,
    chunkSeconds: 10,
    decode: async (chunk, index) => {
      running += 1
      assert.equal(running, 1)
      asked.push(index)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running -= 1
      return chunkPcm(chunk.length, null)
    }
  })
  assert.deepEqual(asked, [0, 1, 2])
})
