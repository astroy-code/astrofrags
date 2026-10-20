export type Platform = 'desktop' | 'mobile'

const MEGABYTE = 1024 * 1024

// Soft limits: above these the UI warns but never blocks. The mobile value is a starting
// guess to tune on a real phone.
export const SOFT_LIMIT_BYTES: Record<Platform, number> = {
  desktop: 500 * MEGABYTE,
  mobile: 200 * MEGABYTE
}

export function checkFileSize(bytes: number, platform: Platform): 'ok' | 'warn' {
  return bytes > SOFT_LIMIT_BYTES[platform] ? 'warn' : 'ok'
}

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'mobile'
  // iPadOS reports a Macintosh user agent; a touch-capable "Mac" is an iPad.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'mobile'
  return 'desktop'
}
