import { lowerThirdLabel } from './brandingSettings.ts'
import type { BrandingSettings } from './brandingSettings.ts'
import type { Size } from './outputGeometry.ts'
import { cardLayout, lowerThirdLayout } from './overlayLayout.ts'
import { truncateToWidth } from './textFit.ts'

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const CARD_NAME_MAX_WIDTH_RATIO = 0.9
const LOGO_FILE = 'astrofrags-logo.png'

export interface Logo {
  /** The PNG as shipped, handed to ffmpeg for the watermark. */
  readonly bytes: Uint8Array
  readonly image: ImageBitmap
  readonly size: Size
}

let logoPromise: Promise<Logo> | null = null

async function fetchLogo(): Promise<Logo> {
  const response = await fetch(new URL(LOGO_FILE, document.baseURI))
  if (!response.ok) throw new Error('The Astrofrags logo could not be loaded.')
  const buffer = await response.arrayBuffer()
  const image = await createImageBitmap(new Blob([buffer], { type: 'image/png' }))
  return { bytes: new Uint8Array(buffer), image, size: { width: image.width, height: image.height } }
}

/** The bundled logo, fetched once; a failed load is retried on the next call. */
export function loadLogo(): Promise<Logo> {
  if (!logoPromise) {
    logoPromise = fetchLogo().catch((error: unknown) => {
      logoPromise = null
      throw error
    })
  }
  return logoPromise
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the intro/outro images.')
  return ctx
}

function sizedCanvas(size: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The overlay image could not be created.'))
        return
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}

export type CardStyle = Pick<BrandingSettings, 'displayName' | 'accentColor'>

/** Draws an intro/outro card: accent background, centred logo, and the display name below it. */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  settings: CardStyle,
  size: Size,
  logo: Logo
): void {
  const layout = cardLayout(size, logo.size)
  ctx.fillStyle = settings.accentColor
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(logo.image, layout.logo.x, layout.logo.y, layout.logo.width, layout.logo.height)

  ctx.font = `bold ${layout.nameFontSize}px ${FONT_FAMILY}`
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const name = truncateToWidth(
    (text) => ctx.measureText(text).width,
    settings.displayName,
    size.width * CARD_NAME_MAX_WIDTH_RATIO
  )
  ctx.fillText(name, layout.nameCenterX, layout.nameCenterY)
}

/** Draws the lower-third on a transparent canvas: a translucent box with the text, bottom-left. */
export function drawLowerThird(ctx: CanvasRenderingContext2D, text: string, size: Size): void {
  const layout = lowerThirdLayout(size)
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.font = `bold ${layout.fontSize}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  const maxTextWidth = size.width - 2 * (layout.marginLeft + layout.padding)
  const shown = truncateToWidth((value) => ctx.measureText(value).width, text, maxTextWidth)
  if (maxTextWidth <= 0 || shown === '') return

  const metrics = ctx.measureText(shown)
  const boxHeight = layout.fontSize + 2 * layout.padding
  const boxWidth = metrics.width + 2 * layout.padding
  const boxX = layout.marginLeft
  const boxY = size.height - layout.marginBottom - boxHeight

  ctx.fillStyle = layout.boxColor
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
  ctx.fillStyle = layout.fontColor
  // Alphabetic baseline sits roughly 80% down the em box; the padding frames the glyphs evenly.
  ctx.fillText(shown, boxX + layout.padding, boxY + layout.padding + layout.fontSize * 0.8)
}

async function fontsReady(): Promise<void> {
  await document.fonts?.ready
}

/** A card as a PNG the size of the output frame. */
export async function renderCardPng(settings: BrandingSettings, size: Size, logo: Logo): Promise<Uint8Array> {
  await fontsReady()
  const canvas = sizedCanvas(size)
  drawCard(context2d(canvas), settings, size, logo)
  return canvasToPng(canvas)
}

/** The lower-third as a transparent PNG covering the whole output frame. */
export async function renderLowerThirdPng(settings: BrandingSettings, size: Size): Promise<Uint8Array> {
  await fontsReady()
  const canvas = sizedCanvas(size)
  drawLowerThird(context2d(canvas), lowerThirdLabel(settings), size)
  return canvasToPng(canvas)
}
