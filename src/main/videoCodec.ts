export interface VideoStreamInfo {
  codec: string
  pixFmt: string
}

// Codecs Electron's bundled Chromium can decode in <video>. HEVC is deliberately absent:
// Chromium ships without a software HEVC decoder, so such files play audio but render black.
const CHROMIUM_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])

/** Extracts the first video stream's codec and pixel format from `ffmpeg -i` stderr. */
export function parseVideoStream(ffmpegStderr: string): VideoStreamInfo | null {
  const line = ffmpegStderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video:/.test(l))
  if (!line) return null

  const codec = /Video:\s*([a-z0-9_]+)/i.exec(line)?.[1]?.toLowerCase()
  if (!codec) return null

  // Pixel format is the first comma-separated field after the codec/profile/tag parentheticals.
  const afterTags = line.replace(/\([^)]*\)/g, '')
  const pixFmt = /Video:\s*[a-z0-9_]+[^,]*,\s*([a-z0-9_]+)/i.exec(afterTags)?.[1]?.toLowerCase() ?? ''
  return { codec, pixFmt }
}

/** True when the stream can be stream-copied into a preview and shown by Chromium as-is. */
export function isChromiumPlayable(info: VideoStreamInfo | null): boolean {
  if (!info) return false
  if (!CHROMIUM_VIDEO_CODECS.has(info.codec)) return false
  // 10-bit and 4:2:2/4:4:4 H.264 are not hardware/software decodable in Chromium.
  return info.pixFmt === '' || info.pixFmt === 'yuv420p' || info.pixFmt === 'yuvj420p' || info.codec !== 'h264'
}
