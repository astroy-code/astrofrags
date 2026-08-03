/** ffmpeg's subtitles filter treats ':' and '\' as syntax characters, so Windows
 * paths (drive-letter colon, backslash separators) need escaping to be passed through. */
export function escapeSubtitlesPath(path: string): string {
  const forwardSlashes = path.replace(/\\/g, '/')
  const escapedColons = forwardSlashes.replace(/:/g, '\\:')
  return `'${escapedColons}'`
}
