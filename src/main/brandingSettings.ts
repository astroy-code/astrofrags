import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'

export interface BrandingSettings {
  displayName: string
  accentColor: string
  introEnabled: boolean
  outroEnabled: boolean
  introDurationSeconds: number
  lowerThirdEnabled: boolean
  lowerThirdText: string
  watermarkCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  displayName: 'Astroy',
  accentColor: '#1a1a2e',
  introEnabled: false,
  outroEnabled: false,
  introDurationSeconds: 3,
  lowerThirdEnabled: false,
  lowerThirdText: '',
  watermarkCorner: 'bottom-right'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'branding.json')
}

export async function loadBrandingSettings(): Promise<BrandingSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf-8')
    // Spread defaults first so fields added in a later version of the app don't come back
    // as undefined for a settings file saved by an older version.
    return { ...DEFAULT_BRANDING_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_BRANDING_SETTINGS
  }
}

export async function saveBrandingSettings(settings: BrandingSettings): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}
