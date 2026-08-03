import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'

const SAMPLE_RATE = 16000
const WINDOW_SECONDS = 0.1
const WINDOW_SAMPLES = Math.round(SAMPLE_RATE * WINDOW_SECONDS)
const MERGE_GAP_SECONDS = 3
const PEAK_STDDEV_MULTIPLIER = 3
const MAX_PEAKS = 12

export interface Peak {
  time: number
  score: number
}

/** Decodes the video's audio track to raw mono PCM via ffmpeg, no intermediate file. */
function decodeToPcm(videoPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static binary not found'))
      return
    }

    const args = [
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ]

    const proc = spawn(ffmpegPath, args)
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

function rmsPerWindow(pcm: Buffer): number[] {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
  const windows: number[] = []

  for (let start = 0; start < samples.length; start += WINDOW_SAMPLES) {
    const end = Math.min(start + WINDOW_SAMPLES, samples.length)
    let sumSquares = 0
    for (let i = start; i < end; i++) {
      const normalized = samples[i] / 32768
      sumSquares += normalized * normalized
    }
    windows.push(Math.sqrt(sumSquares / (end - start)))
  }

  return windows
}

function findPeaks(windows: number[]): Peak[] {
  const mean = windows.reduce((a, b) => a + b, 0) / windows.length
  const variance = windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length
  const stddev = Math.sqrt(variance)
  const threshold = mean + PEAK_STDDEV_MULTIPLIER * stddev

  const rawPeaks: Peak[] = []
  for (let i = 0; i < windows.length; i++) {
    if (windows[i] > threshold) {
      rawPeaks.push({ time: i * WINDOW_SECONDS, score: windows[i] })
    }
  }

  // Merge peaks that fall within MERGE_GAP_SECONDS of each other, keeping the strongest.
  const merged: Peak[] = []
  for (const peak of rawPeaks) {
    const last = merged[merged.length - 1]
    if (last && peak.time - last.time <= MERGE_GAP_SECONDS) {
      if (peak.score > last.score) {
        last.time = peak.time
        last.score = peak.score
      }
    } else {
      merged.push({ ...peak })
    }
  }

  return merged.sort((a, b) => b.score - a.score).slice(0, MAX_PEAKS)
}

export async function detectPeaks(videoPath: string): Promise<Peak[]> {
  const pcm = await decodeToPcm(videoPath)
  const windows = rmsPerWindow(pcm)
  return findPeaks(windows)
}
