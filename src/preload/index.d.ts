export {}

interface Peak {
  time: number
  score: number
}

interface AnalyzeResult {
  wav: Uint8Array
  peaks: Peak[]
  previewPath: string
}

interface ExportClipResult {
  path: string
  captionsAdded: boolean
}

interface CaptionLine {
  start: number
  end: number
  text: string
}

interface VisualRegion {
  x: number
  y: number
  w: number
  h: number
}

type TransitionStyle =
  | 'fade'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'circleopen'
  | 'circleclose'
  | 'pixelize'
  | 'zoomin'
  | 'random'

type ExportPreset = 'original' | 'vertical' | 'vertical-crop' | 'square'

interface UpdateStatus {
  state: 'available' | 'downloaded' | 'error'
  version?: string
  message?: string
}

interface BrandingSettings {
  displayName: string
  accentColor: string
  introEnabled: boolean
  outroEnabled: boolean
  introDurationSeconds: number
  lowerThirdEnabled: boolean
  lowerThirdText: string
  watermarkCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

interface SessionClipSnapshot {
  id: number
  sourceVideoPath: string
  start: number
  end: number
  captions: boolean
}

interface SessionSnapshot {
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

declare global {
  interface Window {
    api: {
      showInFolder: (filePath: string) => Promise<void>
      selectVideo: () => Promise<{ path: string; createdAtMs: number }[] | null>
      selectAudio: () => Promise<string | null>
      selectFolder: () => Promise<string | null>
      startWatching: (folder: string) => Promise<void>
      stopWatching: () => Promise<void>
      onNewClip: (callback: (filePath: string, createdAtMs: number) => void) => () => void
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
      installUpdate: () => Promise<void>
      getBrandingSettings: () => Promise<BrandingSettings>
      saveBrandingSettings: (settings: BrandingSettings) => Promise<void>
      getSessionHistory: () => Promise<SessionSnapshot[]>
      saveSessionSnapshot: (snapshot: SessionSnapshot) => Promise<SessionSnapshot[]>
      deleteSessionSnapshot: (id: string) => Promise<SessionSnapshot[]>
      analyzeVideo: (videoPath: string) => Promise<AnalyzeResult>
      previewCaptions: (videoPath: string, start: number, end: number) => Promise<CaptionLine[]>
      detectVisualEvents: (videoPath: string, region: VisualRegion) => Promise<Peak[]>
      exportClip: (
        videoPath: string,
        start: number,
        end: number,
        captions: boolean,
        captionLines?: CaptionLine[],
        preset?: ExportPreset
      ) => Promise<ExportClipResult | null>
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
      ) => Promise<ExportClipResult | null>
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
      ) => Promise<string>
    }
  }
}
