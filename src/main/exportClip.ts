import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import { escapeSubtitlesPath } from './subtitlesPath'
import { buildReframeFilter, presetBitrate, type ExportPreset } from './exportPresets'
import { buildWatermarkFilter, buildLowerThirdFilter, LOUDNORM_FILTER } from './branding'
import { getBundledLogoPath } from './assetPath'
import type { BrandingSettings } from './brandingSettings'

export async function renderClip(
  videoPath: string,
  start: number,
  end: number,
  outputPath: string,
  srtPath?: string,
  preset: ExportPreset = 'original',
  branding?: BrandingSettings
): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const duration = end - start
  if (duration <= 0) {
    throw new Error('Clip end must be after start')
  }

  const args = ['-y', '-ss', String(start), '-i', videoPath]

  // Reframe (if any) runs before captions so subtitles land on the finished vertical/square
  // canvas — burning them onto the pre-reframe source would duplicate blurry captions into
  // the background layer too. Watermark/lower-third run last, on top of the fully composed
  // frame, so they sit correctly at the final canvas's actual dimensions.
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

  // The bundled Astrofrags logo is a permanent watermark on every export — not a toggle,
  // not user-replaceable. The logo input must be added before the trailing -t below
  // (anything before the last -i is parsed as an input option for that upcoming input, not
  // an output option) — and -loop 1 keeps this single-frame still image available for the
  // clip's whole duration.
  args.push('-loop', '1', '-i', getBundledLogoPath())
  filterStages.push(buildWatermarkFilter(1, branding?.watermarkCorner ?? 'bottom-right', videoLabel, '[watermarked]'))
  videoLabel = '[watermarked]'

  if (branding?.lowerThirdEnabled) {
    const text = branding.lowerThirdText || branding.displayName
    filterStages.push(buildLowerThirdFilter(text, videoLabel, '[lowerthird]'))
    videoLabel = '[lowerthird]'
  }

  // Loudness normalization always runs, unlike the opt-in video-side stages above — there's
  // no real downside to consistent audio levels, so it isn't a toggle.
  filterStages.push(`[0:a]${LOUDNORM_FILTER}[loudaudio]`)

  args.push(
    // Now unambiguously an output option: it's past every -i, so it limits the final output
    // instead of being mistaken for an input option on whichever -i happens to follow it.
    '-t', String(duration),
    // -filter_complex disables ffmpeg's automatic stream selection entirely, so both the
    // video and audio outputs need an explicit -map.
    '-filter_complex', filterStages.join('; '),
    '-map', videoLabel,
    '-map', '[loudaudio]'
  )

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
