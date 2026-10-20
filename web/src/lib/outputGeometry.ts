export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const MAX_OUTPUT: Size = { width: 1920, height: 1080 }

// The desktop layout numbers are specified at 1080 on the shorter side.
const REFERENCE_SHORT_SIDE = 1080
const MIN_DIMENSION = 2

const floorToEven = (value: number): number => Math.max(MIN_DIMENSION, Math.floor(value / 2) * 2)

/** Fits a source inside `max` keeping its aspect ratio, never upscaling, with even dimensions. */
export function fitWithin(source: Size, max: Size = MAX_OUTPUT): Size {
  const scale = Math.min(1, max.width / source.width, max.height / source.height)
  return { width: floorToEven(source.width * scale), height: floorToEven(source.height * scale) }
}

/** Factor that scales the 1080p reference layout numbers to an output of this size. */
export function layoutScale(size: Size): number {
  return Math.min(size.width, size.height) / REFERENCE_SHORT_SIDE
}
