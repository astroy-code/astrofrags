const ELLIPSIS = '…'

/**
 * The longest start of `text` that, with an ellipsis added, fits `maxWidth`. Works on whole code
 * points so an emoji is never split. `measure` is the drawing context's text width.
 */
export function truncateToWidth(
  measure: (text: string) => number,
  text: string,
  maxWidth: number
): string {
  if (measure(text) <= maxWidth) return text

  const characters = Array.from(text)
  for (let count = characters.length - 1; count > 0; count--) {
    const candidate = characters.slice(0, count).join('').trimEnd() + ELLIPSIS
    if (measure(candidate) <= maxWidth) return candidate
  }
  return ELLIPSIS
}
