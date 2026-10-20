import { fitWithin } from './outputGeometry.ts'
import type { Size } from './outputGeometry.ts'

// The same four formats, sizes and bitrates as the desktop app (src/main/exportPresets.ts).
export const EXPORT_FORMATS = ['original', 'vertical', 'vertical-crop', 'square'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  original: 'Original (keeps the clip’s shape)',
  vertical: 'Vertical, blurred bars (9:16)',
  'vertical-crop': 'Vertical, cropped, no bars (9:16)',
  square: 'Square (1:1)'
}

type Preset = Exclude<ExportFormat, 'original'>

interface PresetSpec {
  readonly size: Size
  readonly bitrate: string
}

const PRESETS: Record<Preset, PresetSpec> = {
  vertical: { size: { width: 1080, height: 1920 }, bitrate: '10M' },
  'vertical-crop': { size: { width: 1080, height: 1920 }, bitrate: '10M' },
  square: { size: { width: 1080, height: 1080 }, bitrate: '8M' }
}

const BLUR_SIGMA = 20

export function parseExportFormat(value: unknown, fallback: ExportFormat): ExportFormat {
  return EXPORT_FORMATS.find((format) => format === value) ?? fallback
}

/** The final frame size: a preset's own size, or the clip's shape fitted within 1920x1080. */
export function formatOutputSize(format: ExportFormat, source: Size): Size {
  return format === 'original' ? fitWithin(source) : PRESETS[format].size
}

/** A target bitrate for the presets; null for original, which keeps constant-quality encoding. */
export function formatBitrate(format: ExportFormat): string | null {
  return format === 'original' ? null : PRESETS[format].bitrate
}

/**
 * Desktop's reframe (exportPresets.ts buildReframeFilter): bars mode puts a blurred fill copy
 * behind a sharp copy scaled to fit; crop mode fills the canvas and trims the overflow.
 */
export function buildReframeStage(format: ExportFormat, inLabel: string, outLabel: string): string {
  if (format === 'original') throw new Error('The original format has no reframe stage.')
  const { width, height } = PRESETS[format].size

  if (format === 'vertical-crop') {
    return `${inLabel}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${outLabel}`
  }
  return (
    `${inLabel}split=2[reframe_bg_in][reframe_fg_in];` +
    `[reframe_bg_in]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},gblur=sigma=${BLUR_SIGMA}[reframe_bg];` +
    `[reframe_fg_in]scale=${width}:${height}:force_original_aspect_ratio=decrease[reframe_fg];` +
    `[reframe_bg][reframe_fg]overlay=(W-w)/2:(H-h)/2${outLabel}`
  )
}
