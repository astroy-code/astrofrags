// Pieces shared by the export graph's stages (exportGraph.ts, reelGraph.ts).

// Fixed sample format too: concat needs every segment's audio to match exactly.
export const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo:sample_fmts=fltp'
export const SILENCE_SOURCE = 'anullsrc=r=48000:cl=stereo'
// concat/xfade need matching frame rates across segments; this is also desktop's card frame rate.
export const FRAME_RATE = 30
export const RESET_TIMESTAMPS = 'setpts=PTS-STARTPTS'

export const seconds = (value: number): string => value.toFixed(3)
