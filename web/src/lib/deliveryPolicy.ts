import type { Platform } from './sizeLimit.ts'

/**
 * Web Share and file downloads need a recent user gesture on phones, and a WASM export always
 * outlasts that window. So phones show a "Save or share" button for the user to tap; desktop
 * browsers can start the download as soon as the export finishes.
 */
export function shouldAutoDeliver(platform: Platform): boolean {
  return platform === 'desktop'
}
