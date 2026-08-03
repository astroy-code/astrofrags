import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export interface UpdateStatus {
  state: 'available' | 'downloaded' | 'error'
  version?: string
  message?: string
}

export function initAutoUpdater(onStatus: (status: UpdateStatus) => void): void {
  // Dev/unpacked runs have no update feed (no packaged app.asar, no published releases to
  // diff against) — checkForUpdates() would just throw. Only real installed builds check.
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => onStatus({ state: 'available', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => onStatus({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    // Not surfaced to the UI as a scary banner — "no releases published yet" or "no network"
    // are routine, not failures worth interrupting the user over — but logged so a genuine
    // update problem is still diagnosable.
    console.error('autoUpdater error:', err)
    onStatus({ state: 'error', message: err.message })
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('autoUpdater checkForUpdates failed:', err)
    onStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}

export function installUpdateAndRestart(): void {
  autoUpdater.quitAndInstall()
}
