const FALLBACK_BASE_NAME = 'clip'
// Leaves room for the suffix so the whole name stays well inside common 255-byte limits.
const MAX_BASE_NAME_LENGTH = 60

function safeBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]*$/, '')
  const sanitized = withoutExtension
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized.slice(0, MAX_BASE_NAME_LENGTH).replace(/_+$/, '') || FALLBACK_BASE_NAME
}

export function trimmedFileName(originalName: string, start: number, end: number): string {
  return `${safeBaseName(originalName)}-trim-${Math.round(start)}s-${Math.round(end)}s.mp4`
}

export function reelFileName(firstName: string, clipCount: number): string {
  return `${safeBaseName(firstName)}-reel-${clipCount}-clips.mp4`
}
