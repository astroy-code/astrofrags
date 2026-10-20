import { app } from 'electron'
import { spawn } from 'child_process'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import ffmpegPath from './ffmpegBinary'
import { parseVideoStream, isChromiumPlayable, type VideoStreamInfo } from './videoCodec'

/** ffmpeg with no output file prints stream info to stderr — avoids needing ffprobe. */
async function probeVideoStream(videoPath: string): Promise<VideoStreamInfo | null> {
  const stderr = await new Promise<string>((resolve) => {
    const proc = spawn(ffmpegPath as string, ['-i', videoPath])
    let out = ''
    proc.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
    proc.on('close', () => resolve(out))
    proc.on('error', () => resolve(out))
  })
  return parseVideoStream(stderr)
}

/**
 * Game-capture recordings are usually written with the MP4 "moov" index at the
 * end of the file (no faststart). A custom local-file protocol handler can serve
 * the container fine but never resolves a proper seek into a large non-faststart
 * file, leaving <video> stuck with no visible frames. Stream-copy remuxing to
 * move moov to the front fixes preview playback without re-encoding.
 *
 * Chromium cannot decode HEVC (and a few other codecs): <video> shows black while audio
 * still plays. Those sources are transcoded to H.264 for the preview only; exports always
 * read the original file.
 */
export async function extractFaststartPreview(videoPath: string): Promise<string> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const dir = join(app.getPath('temp'), 'highlight-editor')
  await mkdir(dir, { recursive: true })
  const outPath = join(dir, `${randomUUID()}-preview.mp4`)

  const playable = isChromiumPlayable(await probeVideoStream(videoPath))
  const videoArgs = playable
    ? ['-c', 'copy']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac']

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, [
      '-y',
      '-i', videoPath,
      ...videoArgs,
      '-movflags', '+faststart',
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
