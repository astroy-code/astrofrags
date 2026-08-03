export const EXPORT_PRESETS = ['original', 'vertical', 'square'] as const
export type ExportPreset = (typeof EXPORT_PRESETS)[number]

interface PresetSpec {
  width: number
  height: number
  bitrate: string
}

// Bitrates tuned toward what TikTok/Shorts/Reels re-encode to anyway, so uploads don't lose
// much more quality in their own compression pass.
const PRESET_SPECS: Record<Exclude<ExportPreset, 'original'>, PresetSpec> = {
  vertical: { width: 1080, height: 1920, bitrate: '10M' },
  square: { width: 1080, height: 1080, bitrate: '8M' }
}

export function presetDimensions(preset: ExportPreset): { width: number; height: number } | null {
  if (preset === 'original') return null
  return PRESET_SPECS[preset]
}

export function presetBitrate(preset: ExportPreset): string | null {
  if (preset === 'original') return null
  return PRESET_SPECS[preset].bitrate
}

/** Fits widescreen gameplay into a taller/squarer canvas without cropping any of the actual
 * footage: a heavily blurred, cropped-to-fill copy of the source sits behind a sharp copy
 * that's scaled down to fit entirely within the canvas, centered. This is the standard
 * "TikTok-style" reframe for turning 16:9 video into vertical/square short-form video. */
export function buildReframeFilter(preset: ExportPreset, inLabel: string, outLabel: string): string {
  const dims = presetDimensions(preset)
  if (!dims) {
    throw new Error(`buildReframeFilter called with preset '${preset}', which has no target dimensions`)
  }
  const { width, height } = dims
  return (
    `${inLabel}split=2[reframe_bg_in][reframe_fg_in];` +
    `[reframe_bg_in]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},gblur=sigma=20[reframe_bg];` +
    `[reframe_fg_in]scale=${width}:${height}:force_original_aspect_ratio=decrease[reframe_fg];` +
    `[reframe_bg][reframe_fg]overlay=(W-w)/2:(H-h)/2${outLabel}`
  )
}
