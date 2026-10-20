import { parseExportFormat } from './exportFormat.ts'
import type { ExportFormat } from './exportFormat.ts'

export type WatermarkCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface BrandingSettings {
  readonly displayName: string
  readonly accentColor: string
  readonly introEnabled: boolean
  readonly outroEnabled: boolean
  readonly cardDurationSeconds: number
  readonly lowerThirdEnabled: boolean
  readonly lowerThirdText: string
  readonly watermarkCorner: WatermarkCorner
  readonly exportFormat: ExportFormat
}

export const BRANDING_STORAGE_KEY = 'astrofrags.branding.v1'

// Same defaults as the desktop app (src/main/brandingSettings.ts).
export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  displayName: 'Astroy',
  accentColor: '#1a1a2e',
  introEnabled: false,
  outroEnabled: false,
  cardDurationSeconds: 3,
  lowerThirdEnabled: false,
  lowerThirdText: '',
  watermarkCorner: 'bottom-right',
  exportFormat: 'original'
}

const CORNERS: readonly WatermarkCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const MIN_CARD_SECONDS = 1
const MAX_CARD_SECONDS = 10
const MAX_NAME_LENGTH = 60
const MAX_LOWER_THIRD_LENGTH = 120

function cleanText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function cleanColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanDuration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_CARD_SECONDS, Math.max(MIN_CARD_SECONDS, value))
}

function cleanCorner(value: unknown, fallback: WatermarkCorner): WatermarkCorner {
  return CORNERS.find((corner) => corner === value) ?? fallback
}

/** Validates each stored field on its own, so one bad value never discards the rest. */
export function parseBrandingSettings(raw: string | null): BrandingSettings {
  let stored: unknown
  try {
    stored = raw ? JSON.parse(raw) : null
  } catch {
    return DEFAULT_BRANDING_SETTINGS
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return DEFAULT_BRANDING_SETTINGS
  }
  const fields = stored as Record<string, unknown>
  const d = DEFAULT_BRANDING_SETTINGS
  return {
    displayName: cleanText(fields.displayName, MAX_NAME_LENGTH, d.displayName),
    accentColor: cleanColor(fields.accentColor, d.accentColor),
    introEnabled: cleanBoolean(fields.introEnabled, d.introEnabled),
    outroEnabled: cleanBoolean(fields.outroEnabled, d.outroEnabled),
    cardDurationSeconds: cleanDuration(fields.cardDurationSeconds, d.cardDurationSeconds),
    lowerThirdEnabled: cleanBoolean(fields.lowerThirdEnabled, d.lowerThirdEnabled),
    lowerThirdText: cleanText(fields.lowerThirdText, MAX_LOWER_THIRD_LENGTH, d.lowerThirdText),
    watermarkCorner: cleanCorner(fields.watermarkCorner, d.watermarkCorner),
    exportFormat: parseExportFormat(fields.exportFormat, d.exportFormat)
  }
}

export function serializeBrandingSettings(settings: BrandingSettings): string {
  return JSON.stringify(settings)
}

/** The lower-third text, falling back to the display name when empty (as on desktop). */
export function lowerThirdLabel(settings: BrandingSettings): string {
  return settings.lowerThirdText || settings.displayName
}
