import { useEffect, useRef } from 'react'
import { drawCard, loadLogo } from '../lib/cardImages.ts'
import type { CardStyle } from '../lib/cardImages.ts'
import type { Size } from '../lib/outputGeometry.ts'

interface CardPreviewProps {
  readonly style: CardStyle
}

const PREVIEW_SIZE: Size = { width: 320, height: 180 }

/** A small live view of the intro/outro card, redrawn whenever the name or colour changes. */
export function CardPreview({ style }: CardPreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { displayName, accentColor } = style

  useEffect(() => {
    let cancelled = false
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return undefined
    void loadLogo()
      .then(async (logo) => {
        await document.fonts?.ready
        if (!cancelled) drawCard(ctx, { displayName, accentColor }, PREVIEW_SIZE, logo)
      })
      // The preview is a convenience; the export reports a missing logo itself.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [displayName, accentColor])

  return (
    <canvas
      ref={canvasRef}
      className="card-preview"
      data-testid="card-preview"
      width={PREVIEW_SIZE.width}
      height={PREVIEW_SIZE.height}
      aria-label="Preview of the intro and outro card"
    />
  )
}
