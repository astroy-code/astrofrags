export interface PreviewElementState {
  readonly videoWidth: number
  readonly videoHeight: number
  readonly error: unknown
}

export const UNDECODABLE_MESSAGE =
  "This browser can't decode this video (it is probably HEVC/H.265). The audio may play, but the picture won't. " +
  'Try a different browser or device, or use the Astrofrags desktop app, which can handle it.'

/**
 * When a browser can't decode a video codec it often still decodes the audio, so
 * `loadedmetadata` fires with zero video dimensions and the player renders black.
 */
export function isPreviewUndecodable(el: PreviewElementState): boolean {
  return el.error != null || el.videoWidth === 0 || el.videoHeight === 0
}
