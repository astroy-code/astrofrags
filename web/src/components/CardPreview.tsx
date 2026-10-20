import { useEffect, useRef } from 'react'
import { drawCard, loadLogo } from '../lib/cardImages.ts'
import type { CardStyle } from '../lib/cardImages.ts'
import type { ExportFormat } from '../lib/exportFormat.ts'
import type { Size } from '../lib/outputGeometry.ts'

interface CardPreviewProps {
  readonly style: CardStyle
  readonly format: ExportFormat
}

// Small canvases with the shape of each format's frame; original is shown as widescreen.
const PREVIEW_SIZES: Record<ExportFormat, Size> = {
  original: { width: 320, height: 180 },
  vertical: { width: 180, height: 320 },
  'vertical-crop': { width: 180, height: 320 },
  square: { width: 240, height: 240 }
}

/** A small live view of the intro/outro card, redrawn whenever the name, colour or shape changes. */
export function CardPreview({ style, format }: CardPreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { displayName, accentColor } = style
  const size = PREVIEW_SIZES[format]

  useEffect(() => {
    let cancelled = false
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return undefined
    void loadLogo()
      .then(async (logo) => {
        await document.fonts?.ready
        if (!cancelled) drawCard(ctx, { displayName, accentColor }, size, logo)
      })
      // The preview is a convenience; the export reports a missing logo itself.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [displayName, accentColor, size])

  return (
    <canvas
      ref={canvasRef}
      className="card-preview"
      data-testid="card-preview"
      width={size.width}
      height={size.height}
      aria-label="Preview of the intro and outro card"
    />
  )
}
