const MUSIC_FADE_SECONDS = 2

/** Fade length for the music bed: two seconds, but never more than half the clip. */
export function musicFadeSeconds(clipDurationSeconds: number): number {
  if (clipDurationSeconds <= 0) return 0
  return Math.min(MUSIC_FADE_SECONDS, clipDurationSeconds / 2)
}
