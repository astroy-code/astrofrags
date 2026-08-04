import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, dirname, basename, extname } from 'path'
import { readFile, unlink, writeFile, mkdir, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import { extractPlaybackWav } from './extractAudio'
import { detectPeaks } from './audioAnalysis'
import { renderClip } from './exportClip'
import { renderReel, type TransitionStyle } from './exportReel'
import type { ExportPreset } from './exportPresets'
import { extractFaststartPreview } from './previewVideo'
import { transcribeClip, type CaptionLine } from './transcribe'
import { buildSrt } from './srt'
import { detectVisualActivity, type VisualRegion } from './visualDetection'
import { startWatchingFolder, stopWatchingFolder } from './watchFolder'
import { initAutoUpdater, installUpdateAndRestart } from './autoUpdate'
import { loadBrandingSettings, saveBrandingSettings, type BrandingSettings } from './brandingSettings'
import {
  loadSessionHistory,
  saveSessionSnapshot,
  deleteSessionSnapshot,
  type SessionSnapshot
} from './sessionHistory'

let lastPreviewPath: string | null = null
let lastReelPreviewPath: string | null = null

// Works around a black-video-frame bug on some GPU/driver combos where hardware
// video decode silently fails (seeking/duration still work, but no frames render).
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null

async function generateSrtIfRequested(
  videoPath: string,
  start: number,
  end: number,
  captions: boolean,
  captionLines?: CaptionLine[]
): Promise<string | undefined> {
  if (!captions) return undefined
  // If the user already previewed (and possibly edited) captions in the UI, use those
  // exact lines rather than re-transcribing and discarding their edits.
  const lines = captionLines ?? (await transcribeClip(videoPath, start, end))
  if (lines.length === 0) return undefined

  const dir = join(app.getPath('temp'), 'highlight-editor')
  await mkdir(dir, { recursive: true })
  const srtPath = join(dir, `${randomUUID()}.srt`)
  await writeFile(srtPath, buildSrt(lines), 'utf-8')
  return srtPath
}

async function resolveClipsWithSrt(
  clips: { videoPath: string; start: number; end: number; captions: boolean; captionLines?: CaptionLine[] }[]
): Promise<{ videoPath: string; start: number; end: number; srtPath?: string }[]> {
  return Promise.all(
    clips.map(async (clip) => ({
      videoPath: clip.videoPath,
      start: clip.start,
      end: clip.end,
      srtPath: await generateSrtIfRequested(clip.videoPath, clip.start, clip.end, clip.captions, clip.captionLines)
    }))
  )
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // This is a local desktop tool that only ever loads its own bundled app code —
      // it never renders remote/untrusted web content. Same-origin enforcement here
      // just blocks the dev-mode renderer (served over http://localhost by Vite) from
      // loading local video files, with no actual security benefit for this app.
      webSecurity: false
    }
  })
  mainWindow = win

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('dialog:selectVideo', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return Promise.all(
    result.filePaths.map(async (path) => ({ path, createdAtMs: (await stat(path)).birthtimeMs }))
  )
})

ipcMain.handle('dialog:selectAudio', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('settings:getBranding', () => loadBrandingSettings())

ipcMain.handle('settings:saveBranding', (_event, settings: BrandingSettings) => saveBrandingSettings(settings))

ipcMain.handle('settings:getSessionHistory', () => loadSessionHistory())

ipcMain.handle('settings:saveSessionSnapshot', (_event, snapshot: SessionSnapshot) => saveSessionSnapshot(snapshot))

ipcMain.handle('settings:deleteSessionSnapshot', (_event, id: string) => deleteSessionSnapshot(id))

ipcMain.handle('watch:start', (_event, folder: string) => {
  startWatchingFolder(folder, (filePath, createdAtMs) => {
    mainWindow?.webContents.send('watch:newClip', filePath, createdAtMs)
  })
})

ipcMain.handle('watch:stop', () => {
  stopWatchingFolder()
})

ipcMain.handle(
  'video:detectVisualEvents',
  async (_event, args: { videoPath: string; region: VisualRegion }) => {
    return detectVisualActivity(args.videoPath, args.region)
  }
)

ipcMain.handle('audio:analyze', async (_event, videoPath: string) => {
  const wavPath = await extractPlaybackWav(videoPath)
  try {
    const [wavBuffer, peaks, previewPath] = await Promise.all([
      readFile(wavPath),
      detectPeaks(videoPath),
      extractFaststartPreview(videoPath)
    ])

    if (lastPreviewPath) {
      unlink(lastPreviewPath).catch(() => {})
    }
    lastPreviewPath = previewPath

    return { wav: new Uint8Array(wavBuffer), peaks, previewPath }
  } finally {
    unlink(wavPath).catch(() => {})
  }
})

ipcMain.handle(
  'clip:previewCaptions',
  async (_event, args: { videoPath: string; start: number; end: number }) => {
    const { videoPath, start, end } = args
    return transcribeClip(videoPath, start, end)
  }
)

ipcMain.handle(
  'clip:export',
  async (
    _event,
    args: {
      videoPath: string
      start: number
      end: number
      captions: boolean
      captionLines?: CaptionLine[]
      preset?: ExportPreset
    }
  ) => {
    const { videoPath, start, end, captions, captionLines, preset } = args
    const ext = extname(videoPath)
    const base = basename(videoPath, ext)
    const defaultName = `${base}-clip-${Math.round(start)}s${ext || '.mp4'}`

    const saveOptions = {
      defaultPath: join(dirname(videoPath), defaultName),
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return null

    const srtPath = await generateSrtIfRequested(videoPath, start, end, captions, captionLines)
    const branding = await loadBrandingSettings()

    try {
      await renderClip(videoPath, start, end, result.filePath, srtPath, preset, branding)
    } finally {
      if (srtPath) unlink(srtPath).catch(() => {})
    }
    return { path: result.filePath, captionsAdded: Boolean(srtPath) }
  }
)

ipcMain.handle(
  'clip:exportReel',
  async (
    _event,
    args: {
      clips: { videoPath: string; start: number; end: number; captions: boolean; captionLines?: CaptionLine[] }[]
      transitions?: boolean
      transitionStyle?: TransitionStyle
      transitionDuration?: number
      musicPath?: string
      muteOriginal?: boolean
      preset?: ExportPreset
    }
  ) => {
    const { clips, transitions, transitionStyle, transitionDuration, musicPath, muteOriginal, preset } = args
    // Clips can span multiple source files; the first clip's file just seeds a sensible
    // default save location/name, it isn't otherwise special.
    const firstVideoPath = clips[0].videoPath
    const ext = extname(firstVideoPath)
    const base = basename(firstVideoPath, ext)
    const defaultName = `${base}-reel${ext || '.mp4'}`

    const saveOptions = {
      defaultPath: join(dirname(firstVideoPath), defaultName),
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return null

    const clipsWithSrt = await resolveClipsWithSrt(clips)
    const branding = await loadBrandingSettings()

    try {
      await renderReel(clipsWithSrt, result.filePath, {
        transitions,
        transitionStyle,
        transitionDuration,
        musicPath,
        muteOriginal,
        preset,
        branding
      })
    } catch (err) {
      console.error('clip:exportReel failed:', err)
      throw err
    } finally {
      for (const clip of clipsWithSrt) {
        if (clip.srtPath) unlink(clip.srtPath).catch(() => {})
      }
    }
    return { path: result.filePath, captionsAdded: clipsWithSrt.some((c) => Boolean(c.srtPath)) }
  }
)

ipcMain.handle(
  'clip:previewReel',
  async (
    _event,
    args: {
      clips: { videoPath: string; start: number; end: number; captions: boolean; captionLines?: CaptionLine[] }[]
      transitions?: boolean
      transitionStyle?: TransitionStyle
      transitionDuration?: number
      musicPath?: string
      muteOriginal?: boolean
      preset?: ExportPreset
    }
  ) => {
    const { clips, transitions, transitionStyle, transitionDuration, musicPath, muteOriginal, preset } = args
    const clipsWithSrt = await resolveClipsWithSrt(clips)

    const dir = join(app.getPath('temp'), 'highlight-editor')
    await mkdir(dir, { recursive: true })
    const outPath = join(dir, `${randomUUID()}-reel-preview.mp4`)
    const branding = await loadBrandingSettings()

    try {
      await renderReel(clipsWithSrt, outPath, {
        transitions,
        transitionStyle,
        transitionDuration,
        musicPath,
        muteOriginal,
        preset,
        branding
      })
    } catch (err) {
      console.error('clip:previewReel failed:', err)
      throw err
    } finally {
      for (const clip of clipsWithSrt) {
        if (clip.srtPath) unlink(clip.srtPath).catch(() => {})
      }
    }

    if (lastReelPreviewPath) {
      unlink(lastReelPreviewPath).catch(() => {})
    }
    lastReelPreviewPath = outPath

    return outPath
  }
)

ipcMain.handle('update:install', () => {
  installUpdateAndRestart()
})

app.whenReady().then(() => {
  createWindow()
  initAutoUpdater((status) => mainWindow?.webContents.send('update:status', status))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatchingFolder()
  if (process.platform !== 'darwin') app.quit()
})
