import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import { createWorker } from 'tesseract.js'

export interface VisualRegion {
  x: number
  y: number
  w: number
  h: number
}

export interface VisualPeak {
  time: number
  score: number
}

interface FrameContrast {
  time: number
  contrast: number
}

// White HUD text on a dark panel has a stark light/dark split within the crop — the 10th
// vs 90th luma percentile spread (YLOW/YHIGH) is large. Bright but uniform background
// content (sky, a ceiling light) raises average brightness similarly but doesn't have that
// same internal dark/light split, so contrast spread separates the two better than raw
// brightness did. Tuned like the audio detector: mean + N·stddev over the whole clip.
//
// This only needs to be a wide net, not a precise one: OCR confirmation below does the
// real precision work, so it's better to catch more candidates (even most-false ones) than
// to miss a real kill-counter change by being too strict here.
const CONTRAST_STDDEV_MULTIPLIER = 2
const MIN_GAP_SECONDS = 1

// The rising edge itself often lands mid fade-in/animation, before the text is fully
// rendered — OCR reads a garbled fragment there even though the same event reads cleanly
// a moment later once it's settled. The candidate's own timestamp (used for the peak
// marker) is left untouched; only the frame grabbed for OCR is nudged forward.
const OCR_FRAME_OFFSET_SECONDS = 0.25

// Contrast spikes are cheap but not semantically verified (a bright cloud or light fixture
// can still trigger one). OCR is precise but too slow to run on every frame, so it's used
// only to confirm the handful of contrast candidates — reading "N VS M" text out of a
// slightly padded crop at each candidate's timestamp and discarding any that don't match.
const KILL_COUNTER_PATTERN = /\d\s*vs\s*\d/i
const OCR_CROP_PADDING = 0.02

async function collectContrastStats(videoPath: string, region: VisualRegion): Promise<FrameContrast[]> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const crop = `crop=iw*${region.w}:ih*${region.h}:iw*${region.x}:ih*${region.y}`
  const filter = `${crop},signalstats,metadata=print:file=-`

  const stdout = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, ['-i', videoPath, '-vf', filter, '-f', 'null', '-'])
    let out = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
        return
      }
      resolve(out)
    })
  })

  const stats: FrameContrast[] = []
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const frameMatch = lines[i].match(/frame:\s*(\d+).*pts_time:([\d.]+)/)
    if (!frameMatch || frameMatch[1] === '0') continue

    let low: number | null = null
    let high: number | null = null
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('frame:'); j++) {
      const lowMatch = lines[j].match(/lavfi\.signalstats\.YLOW=([\d.]+)/)
      if (lowMatch) low = parseFloat(lowMatch[1])
      const highMatch = lines[j].match(/lavfi\.signalstats\.YHIGH=([\d.]+)/)
      if (highMatch) high = parseFloat(highMatch[1])
      if (low !== null && high !== null) break
    }
    if (low !== null && high !== null) {
      stats.push({ time: parseFloat(frameMatch[2]), contrast: high - low })
    }
  }
  return stats
}

/** Cheap first pass: moments a region's internal light/dark contrast spikes well above its
 * own baseline — e.g. bright white HUD text appearing over a dark panel. Not semantically
 * verified; see detectVisualActivity for the OCR confirmation step. */
async function detectContrastCandidates(videoPath: string, region: VisualRegion): Promise<VisualPeak[]> {
  const stats = await collectContrastStats(videoPath, region)
  if (stats.length === 0) return []

  const mean = stats.reduce((sum, s) => sum + s.contrast, 0) / stats.length
  const variance = stats.reduce((sum, s) => sum + (s.contrast - mean) ** 2, 0) / stats.length
  const stddev = Math.sqrt(variance)
  const threshold = mean + CONTRAST_STDDEV_MULTIPLIER * stddev

  const peaks: VisualPeak[] = []
  let wasAbove = false
  let lastPeakTime = -Infinity
  for (const stat of stats) {
    const isAbove = stat.contrast > threshold
    if (isAbove && !wasAbove && stat.time - lastPeakTime > MIN_GAP_SECONDS) {
      peaks.push({ time: stat.time, score: stat.contrast / 255 })
      lastPeakTime = stat.time
    }
    wasAbove = isAbove
  }
  return peaks
}

function padRegion(region: VisualRegion, pad: number): VisualRegion {
  const x = Math.max(0, region.x - pad)
  const y = Math.max(0, region.y - pad)
  const w = Math.min(1 - x, region.w + pad * 2)
  const h = Math.min(1 - y, region.h + pad * 2)
  return { x, y, w, h }
}

async function extractFramePng(videoPath: string, time: number, region: VisualRegion): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const padded = padRegion(region, OCR_CROP_PADDING)
  const crop = `crop=iw*${padded.w}:ih*${padded.h}:iw*${padded.x}:ih*${padded.y}`

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, [
      '-i', videoPath,
      '-ss', String(time),
      '-vf', crop,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-c:v', 'png',
      'pipe:1'
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}

/** Finds contrast-spike candidates, then confirms each one with OCR — keeping only
 * candidates whose cropped frame actually reads as "N VS M" style text, which rules out
 * bright non-text content (sky, lights) that a pure pixel heuristic can't distinguish. */
export async function detectVisualActivity(videoPath: string, region: VisualRegion): Promise<VisualPeak[]> {
  const candidates = await detectContrastCandidates(videoPath, region)
  if (candidates.length === 0) return []

  const worker = await createWorker('eng')
  try {
    // Restricting the character set resolves ambiguous shapes (e.g. a stylized "1" getting
    // read as "i") in favor of the characters we actually expect, instead of leaving
    // Tesseract to guess across its full alphabet.
    await worker.setParameters({ tessedit_char_whitelist: '0123456789VSvs ' })

    const confirmed: VisualPeak[] = []
    for (const candidate of candidates) {
      const png = await extractFramePng(videoPath, candidate.time + OCR_FRAME_OFFSET_SECONDS, region)
      const { data } = await worker.recognize(png)
      if (KILL_COUNTER_PATTERN.test(data.text)) {
        confirmed.push(candidate)
      }
    }
    return confirmed
  } finally {
    await worker.terminate()
  }
}
