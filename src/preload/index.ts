import { contextBridge, ipcRenderer } from 'electron'
import type { Peak } from '../main/audioAnalysis'
import type { CaptionLine } from '../main/transcribe'
import type { VisualRegion, VisualPeak } from '../main/visualDetection'
import type { TransitionStyle } from '../main/exportReel'
import type { ExportPreset } from '../main/exportPresets'
import type { UpdateStatus } from '../main/autoUpdate'
import type { BrandingSettings } from '../main/brandingSettings'

interface AnalyzeResult {
  wav: Uint8Array
  peaks: Peak[]
  previewPath: string
}

interface ExportClipResult {
  path: string
  captionsAdded: boolean
}

const api = {
  showInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('shell:showInFolder', filePath),
  selectVideo: (): Promise<{ path: string; createdAtMs: number }[] | null> =>
    ipcRenderer.invoke('dialog:selectVideo'),
  selectAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectAudio'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  startWatching: (folder: string): Promise<void> => ipcRenderer.invoke('watch:start', folder),
  stopWatching: (): Promise<void> => ipcRenderer.invoke('watch:stop'),
  onNewClip: (callback: (filePath: string, createdAtMs: number) => void): (() => void) => {
    const listener = (_event: unknown, filePath: string, createdAtMs: number): void =>
      callback(filePath, createdAtMs)
    ipcRenderer.on('watch:newClip', listener)
    return () => ipcRenderer.removeListener('watch:newClip', listener)
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus): void => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  selectLogo: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectLogo'),
  getBrandingSettings: (): Promise<BrandingSettings> => ipcRenderer.invoke('settings:getBranding'),
  saveBrandingSettings: (settings: BrandingSettings): Promise<void> =>
    ipcRenderer.invoke('settings:saveBranding', settings),
  analyzeVideo: (videoPath: string): Promise<AnalyzeResult> =>
    ipcRenderer.invoke('audio:analyze', videoPath),
  previewCaptions: (videoPath: string, start: number, end: number): Promise<CaptionLine[]> =>
    ipcRenderer.invoke('clip:previewCaptions', { videoPath, start, end }),
  detectVisualEvents: (videoPath: string, region: VisualRegion): Promise<VisualPeak[]> =>
    ipcRenderer.invoke('video:detectVisualEvents', { videoPath, region }),
  exportClip: (
    videoPath: string,
    start: number,
    end: number,
    captions: boolean,
    captionLines?: CaptionLine[],
    preset?: ExportPreset
  ): Promise<ExportClipResult | null> =>
    ipcRenderer.invoke('clip:export', { videoPath, start, end, captions, captionLines, preset }),
  exportReel: (
    clips: {
      videoPath: string
      start: number
      end: number
      captions: boolean
      captionLines?: CaptionLine[]
    }[],
    transitions: boolean,
    musicPath?: string,
    muteOriginal?: boolean,
    transitionStyle?: TransitionStyle,
    transitionDuration?: number,
    preset?: ExportPreset
  ): Promise<ExportClipResult | null> =>
    ipcRenderer.invoke('clip:exportReel', {
      clips,
      transitions,
      transitionStyle,
      transitionDuration,
      musicPath,
      muteOriginal,
      preset
    }),
  previewReel: (
    clips: {
      videoPath: string
      start: number
      end: number
      captions: boolean
      captionLines?: CaptionLine[]
    }[],
    transitions: boolean,
    musicPath?: string,
    muteOriginal?: boolean,
    transitionStyle?: TransitionStyle,
    transitionDuration?: number,
    preset?: ExportPreset
  ): Promise<string> =>
    ipcRenderer.invoke('clip:previewReel', {
      clips,
      transitions,
      transitionStyle,
      transitionDuration,
      musicPath,
      muteOriginal,
      preset
    })
}

contextBridge.exposeInMainWorld('api', api)
