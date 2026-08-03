import { watch, FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { extname, join } from 'path'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi'])
// Capture software writes the file over time; waiting for the size to stop changing
// between two checks avoids treating a still-recording clip as ready.
const STABILITY_CHECK_DELAY_MS = 1500

let activeWatcher: FSWatcher | null = null
const pendingTimers = new Map<string, NodeJS.Timeout>()
const notifiedPaths = new Set<string>()

export function stopWatchingFolder(): void {
  if (activeWatcher) {
    activeWatcher.close()
    activeWatcher = null
  }
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer)
  }
  pendingTimers.clear()
  notifiedPaths.clear()
}

async function checkStable(filePath: string, onNewFile: (path: string, createdAtMs: number) => void): Promise<void> {
  pendingTimers.delete(filePath)
  if (notifiedPaths.has(filePath)) return

  try {
    const statBefore = await stat(filePath)
    await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_DELAY_MS))
    const statAfter = await stat(filePath)

    if (statBefore.size === statAfter.size && statAfter.size > 0) {
      notifiedPaths.add(filePath)
      onNewFile(filePath, statAfter.birthtimeMs)
    } else {
      pendingTimers.set(
        filePath,
        setTimeout(() => checkStable(filePath, onNewFile), STABILITY_CHECK_DELAY_MS)
      )
    }
  } catch {
    // File may have been removed/renamed away before we could stat it — not our concern.
  }
}

export function startWatchingFolder(folder: string, onNewFile: (path: string, createdAtMs: number) => void): void {
  stopWatchingFolder()

  activeWatcher = watch(folder, { recursive: true }, (_eventType, filename) => {
    if (!filename) return
    const ext = extname(filename).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(ext)) return

    const fullPath = join(folder, filename)
    const existingTimer = pendingTimers.get(fullPath)
    if (existingTimer) clearTimeout(existingTimer)
    pendingTimers.set(
      fullPath,
      setTimeout(() => checkStable(fullPath, onNewFile), STABILITY_CHECK_DELAY_MS)
    )
  })
}
