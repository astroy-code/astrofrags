import { app } from 'electron'
import { spawn } from 'child_process'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import ffmpegPath from './ffmpegBinary'

/** Extracts a compressed mono wav for waveform display/playback, written to a temp file. */
export async function extractPlaybackWav(videoPath: string): Promise<string> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const dir = join(app.getPath('temp'), 'highlight-editor')
  await mkdir(dir, { recursive: true })
  const outPath = join(dir, `${randomUUID()}.wav`)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, [
      '-y',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
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
