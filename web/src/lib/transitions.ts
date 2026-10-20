// The same styles, labels and limits as the desktop reel (src/main/exportReel.ts, App.tsx).
export const TRANSITION_STYLES = [
  'fade',
  'dissolve',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'circleopen',
  'circleclose',
  'pixelize',
  'zoomin',
  'random'
] as const
export type TransitionStyle = (typeof TRANSITION_STYLES)[number]
/** A style that can actually be used for one join; "random" is resolved to one of these. */
export type JoinStyle = Exclude<TransitionStyle, 'random'>

export const TRANSITION_LABELS: Record<TransitionStyle, string> = {
  fade: 'Fade',
  dissolve: 'Dissolve',
  wipeleft: 'Wipe left',
  wiperight: 'Wipe right',
  slideleft: 'Slide left',
  slideright: 'Slide right',
  circleopen: 'Circle open',
  circleclose: 'Circle close',
  pixelize: 'Pixelize',
  zoomin: 'Zoom in',
  random: 'Random (per cut)'
}

export const DEFAULT_TRANSITION_SECONDS = 0.75
export const MIN_TRANSITION_SECONDS = 0.1
export const MAX_TRANSITION_SECONDS = 2

const JOIN_POOL: readonly JoinStyle[] = TRANSITION_STYLES.filter(
  (style): style is JoinStyle => style !== 'random'
)

export function parseTransitionStyle(value: unknown, fallback: TransitionStyle): TransitionStyle {
  return TRANSITION_STYLES.find((style) => style === value) ?? fallback
}

/** Desktop's rule: clamp to 0.1-2 s, then to half the shortest clip so the fade always fits. */
export function effectiveTransitionSeconds(requested: number, clipSeconds: readonly number[]): number {
  const clamped = Math.min(Math.max(requested, MIN_TRANSITION_SECONDS), MAX_TRANSITION_SECONDS)
  return Math.min(clamped, Math.min(...clipSeconds) / 2)
}

/** One style per join. "random" is rolled per join so a long reel does not repeat one wipe. */
export function resolveJoinStyles(
  style: TransitionStyle,
  joins: number,
  random: () => number = Math.random
): JoinStyle[] {
  return Array.from({ length: joins }, () =>
    style === 'random' ? JOIN_POOL[Math.floor(random() * JOIN_POOL.length)] : style
  )
}

/** Total length: every clip, minus the overlap each transition eats at its join. */
export function reelSeconds(clipSeconds: readonly number[], transitionSeconds: number | null): number {
  const total = clipSeconds.reduce((sum, seconds) => sum + seconds, 0)
  const joins = Math.max(0, clipSeconds.length - 1)
  return transitionSeconds === null ? total : total - joins * transitionSeconds
}
