import { useCallback, useState } from 'react'
import {
  BRANDING_STORAGE_KEY,
  parseBrandingSettings,
  serializeBrandingSettings
} from './lib/brandingSettings.ts'
import type { BrandingSettings } from './lib/brandingSettings.ts'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(BRANDING_STORAGE_KEY)
  } catch {
    // Storage can be blocked (private window, site data cleared); settings then live in memory.
    return null
  }
}

function writeStored(settings: BrandingSettings): void {
  try {
    window.localStorage.setItem(BRANDING_STORAGE_KEY, serializeBrandingSettings(settings))
  } catch {
    // Same as above: failing to persist must never break the page.
  }
}

/** Branding settings remembered in localStorage, with every storage access guarded. */
export function useBrandingSettings(): readonly [BrandingSettings, (patch: Partial<BrandingSettings>) => void] {
  const [settings, setSettings] = useState<BrandingSettings>(() => parseBrandingSettings(readStored()))

  const update = useCallback((patch: Partial<BrandingSettings>) => {
    setSettings((current) => {
      const next = parseBrandingSettings(serializeBrandingSettings({ ...current, ...patch }))
      writeStored(next)
      return next
    })
  }, [])

  return [settings, update]
}
