import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import { escapeSubtitlesPath } from './subtitlesPath'
import { buildReframeFilter, presetBitrate, type ExportPreset } from './exportPresets'

export async function renderClip(
  videoPath: string,
  start: number,
  end: number,
  outputPath: string,
  srtPath?: string,
  preset: ExportPreset = 'original'
): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const duration = end - start
  if (duration <= 0) {
    throw new Error('Clip end must be after start')
  }

  const args = [
    '-y',
    '-ss', String(start),
    '-i', videoPath,
    '-t', String(duration)
  ]

  // Reframe (if any) runs before captions so subtitles land on the finished vertical/square
  // canvas — burning them onto the pre-reframe source would duplicate blurry captions into
  // the background layer too.
  const filterStages: string[] = []
  let videoLabel = '[0:v]'
  if (preset !== 'original') {
    filterStages.push(buildReframeFilter(preset, videoLabel, '[reframed]'))
    videoLabel = '[reframed]'
  }
  if (srtPath) {
    filterStages.push(`${videoLabel}subtitles=${escapeSubtitlesPath(srtPath)}[captioned]`)
    videoLabel = '[captioned]'
  }

  if (filterStages.length > 0) {
    // -filter_complex disables ffmpeg's automatic stream selection entirely, so the audio
    // stream needs an explicit -map too, not just the filtered video output.
    args.push('-filter_complex', filterStages.join('; '), '-map', videoLabel, '-map', '0:a')
  }

  const bitrate = presetBitrate(preset)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast')
  if (bitrate) {
    args.push('-b:v', bitrate)
  } else {
    args.push('-crf', '20')
  }
  args.push('-c:a', 'aac', outputPath)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args)

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
}
