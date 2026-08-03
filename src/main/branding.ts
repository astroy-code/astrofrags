import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import type { BrandingSettings } from './brandingSettings'

/** ffmpeg's drawtext filter treats backslash, colon, single-quote, and percent as syntax
 * characters — a different rule set from escapeSubtitlesPath (subtitlesPath.ts), which
 * escapes for the unrelated `subtitles` filter. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
}

// This ffmpeg-static build isn't guaranteed to have fontconfig for system-font discovery, and
// this app is Windows-only already (see README) — pointing straight at a font every Windows
// install ships avoids bundling a font asset entirely.
export const FONT_PATH = 'C:/Windows/Fonts/arialbd.ttf'

export const LOUDNORM_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11'

export const CANONICAL_CARD_RESOLUTION = { width: 1920, height: 1080 }
// concat requires matching frame rates across every spliced input, and gameplay capture is
// often 60fps — cards render at this same rate (a static card gains nothing from higher fps,
// but exportReel.ts also forces the main sequence to it before splicing cards on).
export const CANONICAL_FRAME_RATE = 30

export type WatermarkCorner = BrandingSettings['watermarkCorner']

const WATERMARK_MARGIN = 24
const WATERMARK_WIDTH = 160

function watermarkPosition(corner: WatermarkCorner): string {
  switch (corner) {
    case 'top-left':
      return `${WATERMARK_MARGIN}:${WATERMARK_MARGIN}`
    case 'top-right':
      return `W-w-${WATERMARK_MARGIN}:${WATERMARK_MARGIN}`
    case 'bottom-left':
      return `${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}`
    case 'bottom-right':
      return `W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}`
  }
}

/** Scales the logo (its own ffmpeg input, added by the caller with `-loop 1` since it's a
 * static image) down to a fixed width and overlays it in a corner on top of whatever's
 * already been composed (reframe, captions, etc).
 *
 * `shortest=1` is load-bearing, not cosmetic: a `-loop 1` image input never ends, and
 * overlay's default eof_action is to keep repeating the last frame of whichever input
 * finishes first until BOTH inputs are exhausted — since the logo never exhausts, the
 * render would never stop on its own without this (confirmed by reproducing it: a plain
 * 5s clip ran for 6+ minutes and counting before being killed). `shortest=1` makes the
 * output end when the main (video) input ends, exactly like every other stage here. */
export function buildWatermarkFilter(
  logoInputIndex: number,
  corner: WatermarkCorner,
  inLabel: string,
  outLabel: string
): string {
  return (
    `[${logoInputIndex}:v]scale=${WATERMARK_WIDTH}:-1[wm_logo];` +
    `${inLabel}[wm_logo]overlay=${watermarkPosition(corner)}:shortest=1${outLabel}`
  )
}

/** drawtext's built-in box=1 option draws a backing rectangle sized to the rendered text
 * automatically — simpler and more correct than a separate drawbox, which would need the
 * text's rendered width computed some other way. */
export function buildLowerThirdFilter(text: string, inLabel: string, outLabel: string): string {
  const escaped = escapeDrawtext(text)
  return (
    `${inLabel}drawtext=fontfile='${FONT_PATH}':text='${escaped}':fontsize=28:fontcolor=white:` +
    `box=1:boxcolor=black@0.5:boxborderw=12:x=40:y=h-th-40${outLabel}`
  )
}

/** Renders a standalone branding card (intro or outro) as its own small mp4: a solid
 * accent-color background, the logo (if set) and display name centered, with a brief
 * fade in/out. Kept as a fully separate ffmpeg render (its own spawn) rather than folded
 * into the main reel's filter graph, so the main concat/crossfade pipeline in exportReel.ts
 * never has to know cards exist — a card is just another clip to it. */
export async function renderBrandingCard(
  kind: 'intro' | 'outro',
  settings: BrandingSettings,
  outputPath: string
): Promise<void> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found')
  }

  const { width, height } = CANONICAL_CARD_RESOLUTION
  const duration = settings.introDurationSeconds
  const fadeOutStart = Math.max(duration - 0.5, 0)

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${settings.accentColor}:s=${width}x${height}:d=${duration}:r=${CANONICAL_FRAME_RATE}`,
    // anullsrc has no duration of its own (unlike color's `d=`), so it needs an explicit -t
    // as an input option (placed before its -i) or it'd stream silence forever.
    '-t', String(duration), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'
  ]

  const hasLogo = Boolean(settings.logoPath)
  if (hasLogo) {
    // A still image is a single frame — loop it so it's available for the whole card
    // duration instead of vanishing after the overlay filter's first output frame.
    args.push('-loop', '1', '-i', settings.logoPath as string)
  }

  const nameEscaped = escapeDrawtext(settings.displayName)
  const filterStages: string[] = []
  let videoLabel = '[0:v]'

  if (hasLogo) {
    filterStages.push('[2:v]scale=-1:300[card_logo]')
    // shortest=1: same reasoning as buildWatermarkFilter above — the looped logo never
    // ends, and this render's own trailing -t output flag is the only other thing that
    // would otherwise stop it, which is one guard rail too few for comfort.
    filterStages.push(`${videoLabel}[card_logo]overlay=(W-w)/2:(H-h)/2-80:shortest=1[card_withlogo]`)
    videoLabel = '[card_withlogo]'
  }

  filterStages.push(
    `${videoLabel}drawtext=fontfile='${FONT_PATH}':text='${nameEscaped}':fontsize=64:fontcolor=white:` +
      `x=(w-tw)/2:y=(h-th)/2+120[card_text]`
  )
  videoLabel = '[card_text]'

  filterStages.push(`${videoLabel}fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOutStart}:d=0.5[card_final]`)
  videoLabel = '[card_final]'

  args.push(
    // Output-level safety net: unambiguous once it's past every -i, guarantees the card
    // can't run long even if a filter stage above ever behaved unexpectedly.
    '-t', String(duration),
    '-filter_complex', filterStages.join('; '),
    '-map', videoLabel,
    '-map', '1:a',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    outputPath
  )

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args)

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code} rendering ${kind} card: ${stderr.slice(-2000)}`))
        return
      }
      resolve()
    })
  })
}
