import { app } from 'electron'
import { spawn } from 'child_process'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import ffmpegPath from './ffmpegBinary'

const PREVIEW_DURATION_SECONDS = 6

/** ffmpeg with no output file specified prints full stream info to stderr and exits non-zero
 * — the standard trick to get stream metadata without needing ffprobe as a dependency. */
export async function probeAudioTrackCount(videoPath: string): Promise<number> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const stderr = await new Promise<string>((resolve) => {
    const proc = spawn(ffmpegPath as string, ['-i', videoPath])
    let out = ''
    proc.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
    proc.on('close', () => resolve(out))
    proc.on('error', () => resolve(out))
  })

  return [...stderr.matchAll(/Stream #\d+:\d+.*: Audio:/g)].length
}

/** Extracts a short audio-only snippet of a single track so the user can identify it by ear
 * (e.g. distinguishing mic from game audio) without a full export. */
export async function extractAudioTrackPreview(
  videoPath: string,
  trackIndex: number,
  seekSeconds: number
): Promise<string> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const dir = join(app.getPath('temp'), 'highlight-editor')
  await mkdir(dir, { recursive: true })
  const outPath = join(dir, `${randomUUID()}-track-preview.wav`)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, [
      '-y',
      '-ss', String(Math.max(0, seekSeconds)),
      '-i', videoPath,
      '-map', `0:a:${trackIndex}`,
      '-t', String(PREVIEW_DURATION_SECONDS),
      outPath
    ])

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
        return
      }
      resolve()
    })
  })

  return outPath
}
