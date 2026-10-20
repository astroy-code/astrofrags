import type { WatermarkCorner } from './brandingSettings.ts'
import { layoutScale } from './outputGeometry.ts'
import type { Rect, Size } from './outputGeometry.ts'

// Reference numbers from the desktop app (src/main/branding.ts), at 1080 on the shorter side.
export const CARD_FADE_SECONDS = 0.5
const WATERMARK_WIDTH = 160
const WATERMARK_MARGIN = 24
const CARD_LOGO_HEIGHT = 300
const CARD_LOGO_LIFT = 80
const CARD_NAME_FONT = 64
const CARD_NAME_DROP = 120
const LOWER_THIRD_FONT = 28
const LOWER_THIRD_MARGIN = 40
const LOWER_THIRD_PADDING = 12

const scaled = (value: number, canvas: Size): number => Math.round(value * layoutScale(canvas))

export function watermarkRect(corner: WatermarkCorner, canvas: Size, logo: Size): Rect {
  const width = scaled(WATERMARK_WIDTH, canvas)
  const height = Math.round((width * logo.height) / logo.width)
  const margin = scaled(WATERMARK_MARGIN, canvas)
  const x = corner.endsWith('left') ? margin : canvas.width - width - margin
  const y = corner.startsWith('top') ? margin : canvas.height - height - margin
  return { x, y, width, height }
}

export interface CardLayout {
  readonly logo: Rect
  readonly nameFontSize: number
  readonly nameCenterX: number
  readonly nameCenterY: number
}

export function cardLayout(canvas: Size, logo: Size): CardLayout {
  const height = scaled(CARD_LOGO_HEIGHT, canvas)
  const width = Math.round((height * logo.width) / logo.height)
  return {
    logo: {
      x: Math.round((canvas.width - width) / 2),
      y: Math.round((canvas.height - height) / 2 - CARD_LOGO_LIFT * layoutScale(canvas)),
      width,
      height
    },
    nameFontSize: scaled(CARD_NAME_FONT, canvas),
    nameCenterX: Math.round(canvas.width / 2),
    nameCenterY: Math.round(canvas.height / 2 + CARD_NAME_DROP * layoutScale(canvas))
  }
}

export interface LowerThirdLayout {
  readonly fontSize: number
  readonly marginLeft: number
  readonly marginBottom: number
  readonly padding: number
  readonly boxColor: string
  readonly fontColor: string
}

export function lowerThirdLayout(canvas: Size): LowerThirdLayout {
  return {
    fontSize: scaled(LOWER_THIRD_FONT, canvas),
    marginLeft: scaled(LOWER_THIRD_MARGIN, canvas),
    marginBottom: scaled(LOWER_THIRD_MARGIN, canvas),
    padding: scaled(LOWER_THIRD_PADDING, canvas),
    boxColor: 'rgba(0,0,0,0.5)',
    fontColor: '#ffffff'
  }
}
