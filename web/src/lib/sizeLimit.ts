export type Platform = 'desktop' | 'mobile'

const MEGABYTE = 1024 * 1024

// Soft limits: above these the UI warns but never blocks. The mobile value is a starting
// guess to tune on a real phone.
export const SOFT_LIMIT_BYTES: Record<Platform, number> = {
  desktop: 500 * MEGABYTE,
  mobile: 200 * MEGABYTE
}

export function checkFileSize(
  bytes: number,
  platform: Platform,
  limits: Record<Platform, number> = SOFT_LIMIT_BYTES
): 'ok' | 'warn' {
  return bytes > limits[platform] ? 'warn' : 'ok'
}

/**
 * Reads `?softLimitBytes=N` from a query string so the warning path can be exercised with a
 * tiny file (used by the E2E tests). Anything that isn't a positive number is ignored.
 */
export function parseLimitOverride(search: string): Record<Platform, number> | null {
  const raw = new URLSearchParams(search).get('softLimitBytes')
  const bytes = raw === null ? NaN : Number(raw)
  return Number.isFinite(bytes) && bytes > 0 ? { desktop: bytes, mobile: bytes } : null
}

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'mobile'
  // iPadOS reports a Macintosh user agent; a touch-capable "Mac" is an iPad.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'mobile'
  return 'desktop'
}
