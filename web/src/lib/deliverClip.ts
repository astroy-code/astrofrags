import type { Platform } from './sizeLimit.ts'

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled'

const OBJECT_URL_LIFETIME_MS = 30_000

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS)
}

/**
 * Phones get the native share sheet when it can carry files (so the clip can go straight to
 * the gallery); everything else, and any share failure other than the user dismissing the
 * sheet, falls back to a normal download.
 */
export async function deliverClip(blob: Blob, fileName: string, platform: Platform): Promise<DeliveryResult> {
  if (platform === 'mobile' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: 'video/mp4' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      }
    }
  }
  download(blob, fileName)
  return 'downloaded'
}
