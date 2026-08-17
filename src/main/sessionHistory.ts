import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import type { TransitionStyle } from './exportReel'
import type { ExportPreset } from './exportPresets'
import type { BrandingSettings } from './brandingSettings'

export interface SessionClipSnapshot {
  id: number
  sourceVideoPath: string
  start: number
  end: number
  captions: boolean
  audioTrackIndex: number
}

export interface SessionSnapshot {
  id: string
  savedAt: number
  videoPath: string
  videoPaths: string[]
  clips: SessionClipSnapshot[]
  transitionsEnabled: boolean
  transitionStyle: TransitionStyle
  transitionDuration: number
  musicPath: string | null
  muteOriginal: boolean
  exportPreset: ExportPreset
  branding: BrandingSettings
}

const MAX_HISTORY = 20

function historyPath(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

export async function loadSessionHistory(): Promise<SessionSnapshot[]> {
  try {
    const raw = await readFile(historyPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeHistory(history: SessionSnapshot[]): Promise<void> {
  await writeFile(historyPath(), JSON.stringify(history, null, 2), 'utf-8')
}

/** Upserts by id — a session actively being worked on keeps updating its own entry rather
 * than piling up a new one on every debounced save, but a genuinely new session (fresh id)
 * gets prepended. Capped so the list can't grow forever. */
export async function saveSessionSnapshot(snapshot: SessionSnapshot): Promise<SessionSnapshot[]> {
  const history = await loadSessionHistory()
  const withoutExisting = history.filter((s) => s.id !== snapshot.id)
  const next = [snapshot, ...withoutExisting].slice(0, MAX_HISTORY)
  await writeHistory(next)
  return next
}

export async function deleteSessionSnapshot(id: string): Promise<SessionSnapshot[]> {
  const history = await loadSessionHistory()
  const next = history.filter((s) => s.id !== id)
  await writeHistory(next)
  return next
}
