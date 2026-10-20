const TENTHS_PER_MINUTE = 600

/** Formats seconds as m:ss.t; negative and non-finite values show as zero. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const tenths = Math.round(safe * 10)
  const minutes = Math.floor(tenths / TENTHS_PER_MINUTE)
  const rest = (tenths % TENTHS_PER_MINUTE) / 10
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}
