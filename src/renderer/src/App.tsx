import { useRef, useState, useEffect } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'

interface Peak {
  time: number
  score: number
}

interface DisplayPeak extends Peak {
  id: number
  source: 'audio' | 'visual'
}

interface VisualRegion {
  x: number
  y: number
  w: number
  h: number
}

interface CaptionLine {
  start: number
  end: number
  text: string
}

interface UpdateStatus {
  state: 'available' | 'downloaded' | 'error'
  version?: string
  message?: string
}

const WATERMARK_CORNERS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' }
] as const
type WatermarkCorner = (typeof WATERMARK_CORNERS)[number]['value']

interface BrandingSettings {
  displayName: string
  accentColor: string
  introEnabled: boolean
  outroEnabled: boolean
  introDurationSeconds: number
  lowerThirdEnabled: boolean
  lowerThirdText: string
  watermarkCorner: WatermarkCorner
}

const EXPORT_PRESETS = [
  { value: 'original', label: 'Original (16:9)' },
  { value: 'vertical', label: 'Vertical — blurred bars (9:16)' },
  { value: 'vertical-crop', label: 'Vertical — cropped, no bars (9:16)' },
  { value: 'square', label: 'Square (1:1)' }
] as const
type ExportPreset = (typeof EXPORT_PRESETS)[number]['value']

const TRANSITION_STYLES = [
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'wipeleft', label: 'Wipe left' },
  { value: 'wiperight', label: 'Wipe right' },
  { value: 'slideleft', label: 'Slide left' },
  { value: 'slideright', label: 'Slide right' },
  { value: 'circleopen', label: 'Circle open' },
  { value: 'circleclose', label: 'Circle close' },
  { value: 'pixelize', label: 'Pixelize' },
  { value: 'zoomin', label: 'Zoom in' },
  { value: 'random', label: 'Random (per cut)' }
] as const
type TransitionStyle = (typeof TRANSITION_STYLES)[number]['value']

interface ClipItem {
  id: number
  sourceVideoPath: string
  start: number
  end: number
  captions: boolean
  audioTrackIndex: number
  exportStatus: 'idle' | 'exporting' | 'done' | 'error'
  exportedPath: string | null
  exportError: string | null
  captionsAdded: boolean
  captionPreview: CaptionLine[] | null
  captionPreviewStatus: 'idle' | 'loading' | 'done' | 'error'
  captionPreviewError: string | null
}

interface SessionClipSnapshot {
  id: number
  sourceVideoPath: string
  start: number
  end: number
  captions: boolean
  audioTrackIndex: number
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

type RegionsPluginInstance = ReturnType<typeof RegionsPlugin.create>
type RegionInstance = ReturnType<RegionsPluginInstance['addRegion']>

const CLIP_PAD_BEFORE = 5
const CLIP_PAD_AFTER = 3
const SHORTS_DURATION_CAP_SECONDS = 180
const MIN_CLIP_DURATION_SECONDS = 1.5
const AUTO_BUILD_CLIP_COUNT = 8

function toFileUrl(path: string): string {
  return `file:///${encodeURI(path.replace(/\\/g, '/'))}`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export default function App(): JSX.Element {
  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPluginInstance | null>(null)
  const clipRegionsRef = useRef<Map<number, RegionInstance>>(new Map())
  const videoRef = useRef<HTMLVideoElement>(null)
  const nextPeakIdRef = useRef(0)
  const visualMarkerRegionsRef = useRef<RegionInstance[]>([])
  const isProgrammaticRegionRef = useRef(false)
  const waveformWrapperRef = useRef<HTMLDivElement>(null)
  const manualDragStartXRef = useRef<number | null>(null)
  // loadVideo needs the *current* clips to rebuild that video's own regions, but it reads
  // them well after an await (a real IPC round-trip), by which point a same-tick setClips
  // call (e.g. session restore) would otherwise be invisible to its stale closure — this
  // ref stays current across that gap since the sync effect below runs before the await
  // resolves.
  const clipsRef = useRef<ClipItem[]>([])
  const currentSessionIdRef = useRef<string | null>(null)

  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [manualClipMode, setManualClipMode] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<DisplayPeak[]>([])
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [clips, setClips] = useState<ClipItem[]>([])
  const [activeClipId, setActiveClipId] = useState<number | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [reelStatus, setReelStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle')
  const [reelPath, setReelPath] = useState<string | null>(null)
  const [reelError, setReelError] = useState<string | null>(null)
  const [reelCaptionsAdded, setReelCaptionsAdded] = useState(false)
  const [transitionsEnabled, setTransitionsEnabled] = useState(false)
  const [transitionStyle, setTransitionStyle] = useState<TransitionStyle>('fade')
  const [transitionDuration, setTransitionDuration] = useState(0.75)
  const [exportPreset, setExportPreset] = useState<ExportPreset>('original')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [branding, setBranding] = useState<BrandingSettings | null>(null)
  const [musicPath, setMusicPath] = useState<string | null>(null)
  const [muteOriginal, setMuteOriginal] = useState(false)
  const [reelPreviewPath, setReelPreviewPath] = useState<string | null>(null)
  const [reelPreviewStatus, setReelPreviewStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [reelPreviewError, setReelPreviewError] = useState<string | null>(null)
  const [killfeedRegion, setKillfeedRegion] = useState<VisualRegion | null>(null)
  const [draftRegion, setDraftRegion] = useState<VisualRegion | null>(null)
  const [regionDrawMode, setRegionDrawMode] = useState(false)
  const [visualDetectStatus, setVisualDetectStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [visualDetectError, setVisualDetectError] = useState<string | null>(null)
  const videoWrapperRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [videoBox, setVideoBox] = useState<{ top: number; left: number; width: number; height: number } | null>(
    null
  )
  const [watchFolder, setWatchFolder] = useState<string | null>(null)
  const [recentClips, setRecentClips] = useState<{ path: string; createdAtMs: number }[]>([])
  // These panels are set up once per project rather than checked on every clip, so they
  // start collapsed to shorten the distance between picking a video and finding a moment.
  const [sessionsExpanded, setSessionsExpanded] = useState(false)
  const [brandingExpanded, setBrandingExpanded] = useState(false)
  const [recentClipsExpanded, setRecentClipsExpanded] = useState(false)
  // Which of the loaded video's audio streams new clips should use (e.g. game audio vs. mic
  // on multi-track recordings) — a per-video choice, reset whenever a different video loads.
  const [audioTrackCount, setAudioTrackCount] = useState(1)
  const [audioTrackIndex, setAudioTrackIndex] = useState(0)
  const [trackPreviewPath, setTrackPreviewPath] = useState<string | null>(null)
  const [trackPreviewLoading, setTrackPreviewLoading] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<SessionSnapshot[]>([])

  useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  useEffect(() => {
    window.api.getSessionHistory().then(setSessionHistory)
  }, [])

  useEffect(() => {
    if (!waveformRef.current) return

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#5b8def',
      progressColor: '#2f5fce',
      height: 120,
      dragToSeek: true,
      url: undefined
    })
    ws.setVolume(0) // the <video> element is the audio source; the waveform is visual-only
    const regions = ws.registerPlugin(RegionsPlugin.create())
    wavesurferRef.current = ws
    regionsRef.current = regions

    // 'interaction' only fires once per click/drag; 'drag' fires continuously while
    // the mouse is held, which is what makes scrubbing follow the video in real time.
    ws.on('interaction', (newTime) => {
      if (videoRef.current) videoRef.current.currentTime = newTime
    })
    ws.on('drag', (relativeX) => {
      const duration = ws.getDuration()
      if (videoRef.current && duration > 0) {
        videoRef.current.currentTime = relativeX * duration
      }
    })

    return () => {
      ws.destroy()
    }
  }, [])

  function addOrFocusClip(peak: DisplayPeak): void {
    const ws = wavesurferRef.current
    const regions = regionsRef.current
    if (!ws || !regions || !videoPath) return

    const id = peak.id
    const existing = clips.find((c) => c.id === id)
    if (existing) {
      setActiveClipId(id)
      if (videoRef.current) videoRef.current.currentTime = existing.start
      return
    }

    const duration = ws.getDuration()
    const start = Math.max(0, peak.time - CLIP_PAD_BEFORE)
    const end = duration > 0 ? Math.min(duration, peak.time + CLIP_PAD_AFTER) : peak.time + CLIP_PAD_AFTER

    const newClip: ClipItem = {
      id,
      sourceVideoPath: videoPath,
      start,
      end,
      captions: false,
      audioTrackIndex,
      exportStatus: 'idle',
      exportedPath: null,
      exportError: null,
      captionsAdded: false,
      captionPreview: null,
      captionPreviewStatus: 'idle',
      captionPreviewError: null
    }
    // Appended, not re-sorted by time — clips can be manually reordered afterward (see
    // moveClip), and re-sorting on every add would silently undo that ordering.
    setClips((prev) => [...prev, newClip])
    setActiveClipId(id)
    addClipRegion(newClip)

    if (videoRef.current) {
      videoRef.current.currentTime = start
    }
  }

  function addPeakMarker(peak: DisplayPeak): RegionInstance | undefined {
    const regions = regionsRef.current
    if (!regions) return undefined

    // Suppresses the manual-clip-selection 'region-created' listener below — that listener
    // can't otherwise tell "the app just added a marker/clip region" apart from "the user
    // just drag-selected a new region", since both go through the same wavesurfer event.
    isProgrammaticRegionRef.current = true
    const marker = regions.addRegion({
      start: peak.time,
      end: peak.time + 0.15,
      color: peak.source === 'visual' ? 'rgba(155, 99, 255, 0.6)' : 'rgba(255, 99, 71, 0.6)',
      drag: false,
      resize: false
    })
    isProgrammaticRegionRef.current = false
    marker.on('click', () => addOrFocusClip(peak))
    return marker
  }

  function regionPointFromEvent(e: React.MouseEvent): { x: number; y: number } {
    // The region overlay is sized/positioned to exactly match the video's own rendered
    // box (see updateVideoBox), so the overlay's own rect — not the wrapper's — maps
    // correctly to video-relative fractions even when the video is letterboxed within it.
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1)
    }
  }

  function updateVideoBox(): void {
    if (!videoRef.current || !videoWrapperRef.current) return
    const videoRect = videoRef.current.getBoundingClientRect()
    const wrapperRect = videoWrapperRef.current.getBoundingClientRect()
    setVideoBox({
      top: videoRect.top - wrapperRect.top,
      left: videoRect.left - wrapperRect.left,
      width: videoRect.width,
      height: videoRect.height
    })
  }

  useEffect(() => {
    if (!previewPath) return
    updateVideoBox()
    window.addEventListener('resize', updateVideoBox)
    return () => window.removeEventListener('resize', updateVideoBox)
  }, [previewPath])

  function handleRegionMouseDown(e: React.MouseEvent): void {
    if (!regionDrawMode) return
    const pt = regionPointFromEvent(e)
    dragStartRef.current = pt
    setDraftRegion({ x: pt.x, y: pt.y, w: 0, h: 0 })
  }

  function handleRegionMouseMove(e: React.MouseEvent): void {
    if (!regionDrawMode || !dragStartRef.current) return
    const pt = regionPointFromEvent(e)
    const start = dragStartRef.current
    setDraftRegion({
      x: Math.min(start.x, pt.x),
      y: Math.min(start.y, pt.y),
      w: Math.abs(pt.x - start.x),
      h: Math.abs(pt.y - start.y)
    })
  }

  function handleRegionMouseUp(): void {
    if (!regionDrawMode || !dragStartRef.current) return
    dragStartRef.current = null
    setDraftRegion((current) => {
      if (current && current.w > 0.01 && current.h > 0.01) {
        setKillfeedRegion(current)
      }
      return null
    })
    setRegionDrawMode(false)
  }

  useEffect(() => {
    if (!regionDrawMode) return
    window.addEventListener('mouseup', handleRegionMouseUp)
    return () => window.removeEventListener('mouseup', handleRegionMouseUp)
  }, [regionDrawMode])

  async function handleDetectVisualEvents(): Promise<void> {
    if (!videoPath || !killfeedRegion) return
    setVisualDetectStatus('loading')
    setVisualDetectError(null)

    // Redrawing the region and re-running should replace the previous batch of visual
    // detections, not pile new ones on top of stale (possibly wrong-region) results.
    visualMarkerRegionsRef.current.forEach((region) => region.remove())
    visualMarkerRegionsRef.current = []
    setPeaks((prev) => prev.filter((p) => p.source !== 'visual'))

    try {
      const detected = await window.api.detectVisualEvents(videoPath, killfeedRegion)
      // No dedup against audio peaks here: these are OCR-confirmed real kill-counter
      // readings, not noisy pixel-change guesses, so a nearby gunshot audio spike isn't
      // a reason to silently drop a genuine, independently-verified event.
      const newPeaks: DisplayPeak[] = detected.map((v) => ({
        ...v,
        id: nextPeakIdRef.current++,
        source: 'visual' as const
      }))

      visualMarkerRegionsRef.current = newPeaks
        .map(addPeakMarker)
        .filter((region): region is RegionInstance => Boolean(region))
      setPeaks((prev) => [...prev, ...newPeaks])
      setVisualDetectStatus('idle')
    } catch (err) {
      setVisualDetectError(err instanceof Error ? err.message : String(err))
      setVisualDetectStatus('error')
    }
  }

  function updateClip(id: number, next: { start: number; end: number }): void {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...next } : c)))
    clipRegionsRef.current.get(id)?.setOptions(next)
  }

  function removeClip(id: number): void {
    clipRegionsRef.current.get(id)?.remove()
    clipRegionsRef.current.delete(id)
    const next = clips.filter((c) => c.id !== id)
    setClips(next)
    setActiveClipId((current) => (current === id ? null : current))
    if (next.length === 0) {
      // The reel preview/export result is invalidated once there's nothing left to combine —
      // otherwise the stale <video autoPlay> element remounts and starts playing itself as
      // soon as a fresh clip is added, since the whole "Selected clips" section (including
      // that video) unmounts and remounts based on clips.length.
      setReelPreviewPath(null)
      setReelPreviewStatus('idle')
      setReelPreviewError(null)
      setReelPath(null)
      setReelStatus('idle')
      setReelError(null)
      currentSessionIdRef.current = null
    }
  }

  async function playClip(clip: ClipItem): Promise<void> {
    if (clip.sourceVideoPath !== videoPath) {
      // Clips can come from a different source than whatever's currently loaded — switch
      // to it first (re-runs analysis on that file) before seeking/playing.
      await loadVideo(clip.sourceVideoPath)
    }
    setActiveClipId(clip.id)
    if (videoRef.current) {
      videoRef.current.currentTime = clip.start
      videoRef.current.play()
    }
  }

  // Shared by both addClipRegion (region created by us) and handleManualRegionCreated
  // (region already created by wavesurfer's drag-selection) — either way, once a clip has
  // a region, dragging/clicking it needs to behave identically.
  function wireClipRegionEvents(id: number, region: RegionInstance): void {
    region.on('update-end', () => {
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, start: region.start, end: region.end } : c)))
    })
    region.on('click', () => setActiveClipId(id))
    clipRegionsRef.current.set(id, region)
  }

  function addClipRegion(clip: ClipItem): void {
    const regions = regionsRef.current
    if (!regions) return

    isProgrammaticRegionRef.current = true
    const region = regions.addRegion({
      start: clip.start,
      end: clip.end,
      color: 'rgba(91, 214, 141, 0.35)',
      drag: true,
      resize: true
    })
    isProgrammaticRegionRef.current = false
    wireClipRegionEvents(clip.id, region)
  }

  // Lets the user select an arbitrary span of the waveform as a clip, without needing a
  // detected peak. wavesurfer's own drag-to-create-region feature (regions.enableDragSelection)
  // looks like the obvious tool for this, but it doesn't work here: WaveSurfer permanently
  // wires its own drag-to-seek pointer listener onto the waveform wrapper at creation time
  // (since this app passes dragToSeek: true), and that listener fully consumes every drag
  // gesture before enableDragSelection's own listener ever sees it — confirmed by reproducing
  // it in isolation (enableDragSelection's 'region-created' simply never fired while
  // dragToSeek was active). Fixed the same way the existing kill-feed region drawer on the
  // <video> element already works: an absolutely-positioned transparent overlay, shown only
  // in manual mode, with our own onMouseDown/mouseup tracking a drag and converting pixel
  // position to time ourselves — a real region only gets created once the drag completes.
  function handleManualClipMouseDown(e: React.MouseEvent): void {
    if (!manualClipMode) return
    manualDragStartXRef.current = e.clientX
  }

  function handleManualClipMouseUp(e: MouseEvent): void {
    if (!manualClipMode || manualDragStartXRef.current === null || !videoPath) return
    const ws = wavesurferRef.current
    const regions = regionsRef.current
    const wrapper = waveformWrapperRef.current
    const startX = manualDragStartXRef.current
    manualDragStartXRef.current = null
    if (!ws || !regions || !wrapper) return

    const duration = ws.getDuration()
    if (duration <= 0) return
    const rect = wrapper.getBoundingClientRect()
    const xToTime = (clientX: number): number => {
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      return frac * duration
    }
    const start = Math.min(xToTime(startX), xToTime(e.clientX))
    const end = Math.max(xToTime(startX), xToTime(e.clientX))
    if (end - start < 0.2) return // a plain click, not really a drag selection

    isProgrammaticRegionRef.current = true
    const region = regions.addRegion({
      start,
      end,
      color: 'rgba(91, 214, 141, 0.35)',
      drag: true,
      resize: true
    })
    isProgrammaticRegionRef.current = false

    const id = nextPeakIdRef.current++
    const newClip: ClipItem = {
      id,
      sourceVideoPath: videoPath,
      start,
      end,
      captions: false,
      audioTrackIndex,
      exportStatus: 'idle',
      exportedPath: null,
      exportError: null,
      captionsAdded: false,
      captionPreview: null,
      captionPreviewStatus: 'idle',
      captionPreviewError: null
    }
    wireClipRegionEvents(id, region)
    setClips((prev) => [...prev, newClip])
    setActiveClipId(id)
  }

  useEffect(() => {
    if (!manualClipMode) return
    window.addEventListener('mouseup', handleManualClipMouseUp)
    return () => window.removeEventListener('mouseup', handleManualClipMouseUp)
  }, [manualClipMode, videoPath])

  function toggleManualClipMode(): void {
    setManualClipMode((prev) => !prev)
  }

  async function handlePreviewAudioTrack(): Promise<void> {
    if (!videoPath) return
    setTrackPreviewLoading(true)
    try {
      const seekSeconds = videoRef.current?.currentTime ?? 0
      const previewPath = await window.api.previewAudioTrack(videoPath, audioTrackIndex, seekSeconds)
      setTrackPreviewPath(previewPath)
    } catch (err) {
      // Lightweight failure handling — a failed preview isn't worth a dedicated error UI,
      // the user can just retry.
      console.error(err)
    } finally {
      setTrackPreviewLoading(false)
    }
  }

  function moveClip(id: number, direction: 'up' | 'down'): void {
    setClips((prev) => {
      const index = prev.findIndex((c) => c.id === id)
      if (index === -1) return prev
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return next
    })
  }

  function autoFitClipsToShortsCap(): void {
    const totalDuration = clips.reduce((sum, c) => sum + (c.end - c.start), 0)
    if (totalDuration <= 0) return
    const ratio = SHORTS_DURATION_CAP_SECONDS / totalDuration
    clips.forEach((c) => {
      const duration = c.end - c.start
      const newDuration = Math.max(MIN_CLIP_DURATION_SECONDS, duration * ratio)
      const shrink = duration - newDuration
      // Shrinks symmetrically around the clip's center so the padded highlight moment
      // stays roughly centered rather than getting trimmed away from one side only.
      updateClip(c.id, { start: c.start + shrink / 2, end: c.end - shrink / 2 })
    })
  }

  // Builds a reel in one click from the loaded video's detected peaks, instead of clicking
  // each one individually: takes the highest-scoring peaks not already added, orders them
  // chronologically (matching the "appended in time order" convention manual peak-clicks
  // already follow), and — if the current export format is a Shorts-style vertical preset —
  // shrinks them inline to fit the 3-minute cap so the result is ready to preview/export
  // without a second manual "Fit to 3:00" click.
  function autoBuildReel(): void {
    if (!videoPath) return
    const duration = wavesurferRef.current?.getDuration() ?? 0

    const rangeFor = (peak: DisplayPeak): { start: number; end: number } => ({
      start: Math.max(0, peak.time - CLIP_PAD_BEFORE),
      end: duration > 0 ? Math.min(duration, peak.time + CLIP_PAD_AFTER) : peak.time + CLIP_PAD_AFTER
    })
    const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
      a.start < b.end && b.start < a.end

    // Existing clips from this same video count as already-claimed footage too — auto-build
    // shouldn't hand you a clip that replays a moment you (or an earlier auto-build click)
    // already added.
    const existingRanges = clips
      .filter((c) => c.sourceVideoPath === videoPath)
      .map((c) => ({ start: c.start, end: c.end }))

    // Greedily walk peaks best-score-first, skipping any whose padded range overlaps an
    // already-chosen one (existing or newly picked), until enough non-overlapping clips are
    // found or peaks run out.
    const chosen: { id: number; time: number; start: number; end: number }[] = []
    for (const peak of [...peaks].filter((p) => !clips.some((c) => c.id === p.id)).sort((a, b) => b.score - a.score)) {
      if (chosen.length >= AUTO_BUILD_CLIP_COUNT) break
      const range = rangeFor(peak)
      if ([...existingRanges, ...chosen].some((r) => overlaps(r, range))) continue
      chosen.push({ id: peak.id, time: peak.time, ...range })
    }
    if (chosen.length === 0) return

    // Appended in chronological order, same convention as manual peak-clicks.
    chosen.sort((a, b) => a.time - b.time)

    const isShorts = exportPreset === 'vertical' || exportPreset === 'vertical-crop'
    const newClipsDuration = chosen.reduce((sum, r) => sum + (r.end - r.start), 0)
    const shouldFit = isShorts && newClipsDuration > SHORTS_DURATION_CAP_SECONDS
    const ratio = shouldFit ? SHORTS_DURATION_CAP_SECONDS / newClipsDuration : 1

    const newClips: ClipItem[] = chosen.map(({ id, start, end }) => {
      const clipDuration = end - start
      const fittedDuration = shouldFit ? Math.max(MIN_CLIP_DURATION_SECONDS, clipDuration * ratio) : clipDuration
      const shrink = clipDuration - fittedDuration
      return {
        id,
        sourceVideoPath: videoPath,
        start: start + shrink / 2,
        end: end - shrink / 2,
        captions: false,
        audioTrackIndex,
        exportStatus: 'idle',
        exportedPath: null,
        exportError: null,
        captionsAdded: false,
        captionPreview: null,
        captionPreviewStatus: 'idle',
        captionPreviewError: null
      }
    })

    setClips((prev) => [...prev, ...newClips])
    newClips.forEach(addClipRegion)
  }

  async function loadVideo(path: string): Promise<void> {
    setVideoPath(path)
    setPreviewPath(null)
    setPeaks([])
    setError(null)
    setStatus('analyzing')
    // Clips deliberately persist across video switches — that's what lets clips picked
    // from different source files accumulate into one combined list to stitch together.
    setActiveClipId(null)
    setVideoError(null)
    setReelStatus('idle')
    setReelPath(null)
    setReelError(null)
    setReelCaptionsAdded(false)
    setKillfeedRegion(null)
    setDraftRegion(null)
    setRegionDrawMode(false)
    setVisualDetectStatus('idle')
    setVisualDetectError(null)
    clipRegionsRef.current.clear()
    visualMarkerRegionsRef.current = []

    // Reset to the single-track default immediately so the selector doesn't briefly show a
    // stale count from the previous video while the probe below is still in flight.
    setAudioTrackCount(1)
    setAudioTrackIndex(0)
    setTrackPreviewPath(null)
    // Fire-and-forget: doesn't gate the rest of loading, and a probe failure just means the
    // track selector stays hidden (falls back to today's single-track behavior).
    window.api
      .probeAudioTrackCount(path)
      .then(setAudioTrackCount)
      .catch(() => setAudioTrackCount(1))

    try {
      const { wav, peaks: detected, previewPath: preview } = await window.api.analyzeVideo(path)
      setPreviewPath(preview)
      const blob = new Blob([wav as unknown as BlobPart], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)

      const ws = wavesurferRef.current
      const regions = regionsRef.current
      if (ws && regions) {
        await ws.load(url)
        regions.clearRegions()
        const sorted: DisplayPeak[] = [...detected]
          .sort((a, b) => a.time - b.time)
          .map((peak) => ({ ...peak, id: nextPeakIdRef.current++, source: 'audio' as const }))
        sorted.forEach(addPeakMarker)
        setPeaks(sorted)
        clipsRef.current.filter((c) => c.sourceVideoPath === path).forEach(addClipRegion)
      }

      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  async function handlePickVideo(): Promise<void> {
    const selected = await window.api.selectVideo()
    if (!selected || selected.length === 0) return

    // Multi-selecting several files at once adds them all to the same "recent clips" list
    // used by the folder watcher, so the rest are one click away after the first loads.
    setRecentClips((prev) => {
      const merged = [...prev]
      for (const entry of selected) {
        if (!merged.some((c) => c.path === entry.path)) merged.push(entry)
      }
      return merged.sort((a, b) => b.createdAtMs - a.createdAtMs)
    })

    await loadVideo(selected[0].path)
  }

  async function handleSelectWatchFolder(): Promise<void> {
    const folder = await window.api.selectFolder()
    if (!folder) return
    setWatchFolder(folder)
    setRecentClips([])
    await window.api.startWatching(folder)
  }

  async function handleStopWatching(): Promise<void> {
    await window.api.stopWatching()
    setWatchFolder(null)
  }

  useEffect(() => {
    return window.api.onNewClip((filePath, createdAtMs) => {
      setRecentClips((prev) => {
        if (prev.some((c) => c.path === filePath)) return prev
        return [...prev, { path: filePath, createdAtMs }].sort((a, b) => b.createdAtMs - a.createdAtMs)
      })
    })
  }, [])

  useEffect(() => {
    return window.api.onUpdateStatus((status) => setUpdateStatus(status))
  }, [])

  async function handleInstallUpdate(): Promise<void> {
    await window.api.installUpdate()
  }

  useEffect(() => {
    window.api.getBrandingSettings().then(setBranding)
  }, [])

  function updateBranding(patch: Partial<BrandingSettings>): void {
    setBranding((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      window.api.saveBrandingSettings(next)
      return next
    })
  }

  // Auto-saves the in-progress working session (video, clips, order, transitions, music,
  // export format, branding) so it can be resumed after the app closes — debounced so
  // rapid edits (dragging a trim handle) don't spam disk writes. currentSessionIdRef keeps
  // this upserting into the same history entry until the clip list is emptied (removeClip
  // resets it to null there), at which point the next clip added starts a fresh entry.
  useEffect(() => {
    if (clips.length === 0 || !videoPath || !branding) return

    const timer = setTimeout(() => {
      if (!currentSessionIdRef.current) currentSessionIdRef.current = crypto.randomUUID()
      const videoPaths = Array.from(new Set(clips.map((c) => c.sourceVideoPath)))
      const snapshot: SessionSnapshot = {
        id: currentSessionIdRef.current,
        savedAt: Date.now(),
        videoPath,
        videoPaths,
        clips: clips.map((c) => ({
          id: c.id,
          sourceVideoPath: c.sourceVideoPath,
          start: c.start,
          end: c.end,
          captions: c.captions,
          audioTrackIndex: c.audioTrackIndex
        })),
        transitionsEnabled,
        transitionStyle,
        transitionDuration,
        musicPath,
        muteOriginal,
        exportPreset,
        branding
      }
      window.api.saveSessionSnapshot(snapshot).then(setSessionHistory)
    }, 1000)

    return () => clearTimeout(timer)
  }, [
    clips,
    transitionsEnabled,
    transitionStyle,
    transitionDuration,
    musicPath,
    muteOriginal,
    exportPreset,
    videoPath,
    branding
  ])

  async function handleRestoreSession(snapshot: SessionSnapshot): Promise<void> {
    setActiveClipId(null)
    setTransitionsEnabled(snapshot.transitionsEnabled)
    setTransitionStyle(snapshot.transitionStyle)
    setTransitionDuration(snapshot.transitionDuration)
    setMusicPath(snapshot.musicPath)
    setMuteOriginal(snapshot.muteOriginal)
    setExportPreset(snapshot.exportPreset)

    await window.api.saveBrandingSettings(snapshot.branding)
    setBranding(snapshot.branding)

    const restoredClips: ClipItem[] = snapshot.clips.map((c) => ({
      ...c,
      exportStatus: 'idle',
      exportedPath: null,
      exportError: null,
      captionsAdded: false,
      captionPreview: null,
      captionPreviewStatus: 'idle',
      captionPreviewError: null
    }))
    nextPeakIdRef.current = Math.max(nextPeakIdRef.current, ...restoredClips.map((c) => c.id + 1), 0)
    setClips(restoredClips)
    // Restoring continues editing this same history entry rather than forking a new one —
    // the auto-save effect above will keep it up to date as edits continue.
    currentSessionIdRef.current = snapshot.id

    await loadVideo(snapshot.videoPath)
  }

  async function handleDeleteSession(id: string): Promise<void> {
    setSessionHistory(await window.api.deleteSessionSnapshot(id))
  }

  async function handlePreviewCaptions(id: number): Promise<void> {
    const clip = clips.find((c) => c.id === id)
    if (!clip) return

    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, captionPreviewStatus: 'loading', captionPreviewError: null } : c))
    )

    try {
      const lines = await window.api.previewCaptions(clip.sourceVideoPath, clip.start, clip.end)
      setClips((prev) =>
        prev.map((c) => (c.id === id ? { ...c, captionPreview: lines, captionPreviewStatus: 'done' } : c))
      )
    } catch (err) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                captionPreviewStatus: 'error',
                captionPreviewError: err instanceof Error ? err.message : String(err)
              }
            : c
        )
      )
    }
  }

  function updateCaptionLine(clipId: number, index: number, text: string): void {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId || !c.captionPreview) return c
        const nextPreview = [...c.captionPreview]
        nextPreview[index] = { ...nextPreview[index], text }
        return { ...c, captionPreview: nextPreview }
      })
    )
  }

  async function handleExportClip(id: number): Promise<void> {
    const clip = clips.find((c) => c.id === id)
    if (!clip) return

    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, exportStatus: 'exporting', exportError: null } : c)))

    try {
      const result = await window.api.exportClip(
        clip.sourceVideoPath,
        clip.start,
        clip.end,
        clip.captions,
        clip.captionPreview ?? undefined,
        exportPreset,
        clip.audioTrackIndex
      )
      setClips((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                exportStatus: result ? 'done' : 'idle',
                exportedPath: result ? result.path : null,
                captionsAdded: result ? result.captionsAdded : false
              }
            : c
        )
      )
    } catch (err) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, exportStatus: 'error', exportError: err instanceof Error ? err.message : String(err) }
            : c
        )
      )
    }
  }

  async function handleSelectMusic(): Promise<void> {
    const path = await window.api.selectAudio()
    if (path) setMusicPath(path)
  }

  function handleRemoveMusic(): void {
    setMusicPath(null)
    setMuteOriginal(false)
  }

  async function handlePreviewReel(): Promise<void> {
    if (clips.length === 0) return
    setReelPreviewStatus('loading')
    setReelPreviewError(null)
    // Clear the old preview immediately rather than leaving it visible until (or unless) a
    // new one arrives — otherwise a failed render looks identical to a stale success.
    setReelPreviewPath(null)

    try {
      const outPath = await window.api.previewReel(
        clips.map((c) => ({
          videoPath: c.sourceVideoPath,
          start: c.start,
          end: c.end,
          captions: c.captions,
          captionLines: c.captionPreview ?? undefined,
          audioTrackIndex: c.audioTrackIndex
        })),
        transitionsEnabled,
        musicPath ?? undefined,
        muteOriginal,
        transitionStyle,
        transitionDuration,
        exportPreset
      )
      setReelPreviewPath(outPath)
      setReelPreviewStatus('idle')
    } catch (err) {
      setReelPreviewError(err instanceof Error ? err.message : String(err))
      setReelPreviewStatus('error')
    }
  }

  async function handleExportReel(): Promise<void> {
    if (clips.length === 0) return
    setReelStatus('exporting')
    setReelError(null)
    // Same reasoning as the preview: don't leave a stale "Saved to X" link up while a new
    // export is in flight or after one fails.
    setReelPath(null)

    try {
      const result = await window.api.exportReel(
        clips.map((c) => ({
          videoPath: c.sourceVideoPath,
          start: c.start,
          end: c.end,
          captions: c.captions,
          captionLines: c.captionPreview ?? undefined,
          audioTrackIndex: c.audioTrackIndex
        })),
        transitionsEnabled,
        musicPath ?? undefined,
        muteOriginal,
        transitionStyle,
        transitionDuration,
        exportPreset
      )
      if (result) {
        setReelPath(result.path)
        setReelCaptionsAdded(result.captionsAdded)
        setReelStatus('done')
      } else {
        setReelStatus('idle')
      }
    } catch (err) {
      setReelError(err instanceof Error ? err.message : String(err))
      setReelStatus('error')
    }
  }

  const activeClip = clips.find((c) => c.id === activeClipId) ?? null
  const isShortsPreset = exportPreset === 'vertical' || exportPreset === 'vertical-crop'
  const totalClipsDuration = clips.reduce((sum, c) => sum + (c.end - c.start), 0)

  return (
    <div
      style={{
        fontFamily: 'sans-serif',
        padding: 24,
        color: '#eee',
        background: '#1a1a1a',
        minHeight: '100vh'
      }}
    >
      {updateStatus?.state === 'downloaded' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
            marginBottom: 12,
            background: '#243b2a',
            border: '1px solid #5bd68d',
            borderRadius: 4
          }}
        >
          <span>
            Update {updateStatus.version ? `v${updateStatus.version}` : ''} downloaded and ready to install.
          </span>
          <button onClick={handleInstallUpdate} style={{ padding: '4px 10px', cursor: 'pointer' }}>
            Restart &amp; install
          </button>
        </div>
      )}
      {updateStatus?.state === 'available' && (
        <div style={{ color: '#999', marginBottom: 12 }}>
          Downloading update {updateStatus.version ? `v${updateStatus.version}` : ''}…
        </div>
      )}
      <h1 style={{ fontSize: 20 }}>Astrofrags</h1>
      <p style={{ color: '#999' }}>
        Pick a gameplay recording. Detected volume spikes are marked in red on the waveform —
        click any number of them to add trimmable clips (green), drag their edges to adjust, then
        export each one. Picking a different video keeps clips you've already selected — build
        up a combined list across as many source files as you want, then stitch them all
        together at once.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={handlePickVideo} style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
          Pick video file
        </button>
        <button
          onClick={watchFolder ? handleStopWatching : handleSelectWatchFolder}
          style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
        >
          {watchFolder ? 'Stop watching folder' : 'Watch folder for new clips'}
        </button>
        {watchFolder && <span style={{ color: '#999', fontSize: 12 }}>Watching {watchFolder}</span>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Export format
          <select
            value={exportPreset}
            onChange={(e) => setExportPreset(e.target.value as ExportPreset)}
            style={{ padding: '4px 6px' }}
          >
            {EXPORT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(sessionHistory.length > 0 || branding || recentClips.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {sessionHistory.length > 0 && (
            <button
              onClick={() => setSessionsExpanded((prev) => !prev)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #444',
                background: '#202020',
                color: '#b7b7b7',
                cursor: 'pointer'
              }}
            >
              {sessionsExpanded ? '▾' : '▸'} Recent sessions ({sessionHistory.length})
            </button>
          )}
          {branding && (
            <button
              onClick={() => setBrandingExpanded((prev) => !prev)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #444',
                background: '#202020',
                color: '#b7b7b7',
                cursor: 'pointer'
              }}
            >
              {brandingExpanded ? '▾' : '▸'} Branding
            </button>
          )}
          {recentClips.length > 0 && (
            <button
              onClick={() => setRecentClipsExpanded((prev) => !prev)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #444',
                background: '#202020',
                color: '#b7b7b7',
                cursor: 'pointer'
              }}
            >
              {recentClipsExpanded ? '▾' : '▸'} Recent clips ({recentClips.length})
            </button>
          )}
        </div>
      )}

      {sessionHistory.length > 0 && sessionsExpanded && (
        <div style={{ marginTop: 16 }}>
          <h3>Recent sessions ({sessionHistory.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: 200, overflowY: 'auto' }}>
            {sessionHistory.map((session) => (
              <li key={session.id} style={{ display: 'flex', gap: 6, marginBottom: 2, alignItems: 'stretch' }}>
                <button
                  onClick={() => handleRestoreSession(session)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    gap: 12,
                    alignItems: 'baseline',
                    textAlign: 'left',
                    padding: '4px 8px',
                    background: currentSessionIdRef.current === session.id ? '#2f5fce' : '#2a2a2a',
                    color: '#eee',
                    border: '1px solid #444',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#999', fontSize: 12, flexShrink: 0 }}>
                    {new Date(session.savedAt).toLocaleString()}
                  </span>
                  <span>{basename(session.videoPath)}</span>
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {session.clips.length} clip{session.clips.length === 1 ? '' : 's'}
                    {session.videoPaths.length > 1 ? ` across ${session.videoPaths.length} videos` : ''}
                  </span>
                </button>
                <button
                  onClick={() => handleDeleteSession(session.id)}
                  title="Remove from history"
                  style={{
                    padding: '4px 10px',
                    background: '#2a2a2a',
                    color: '#999',
                    border: '1px solid #444',
                    cursor: 'pointer'
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {branding && brandingExpanded && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #444', borderRadius: 4 }}>
          <h3 style={{ marginTop: 0 }}>Branding</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <label>
              Display name{' '}
              <input
                type="text"
                value={branding.displayName}
                onChange={(e) => updateBranding({ displayName: e.target.value })}
                style={{ width: 140 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Accent color
              <input
                type="color"
                value={branding.accentColor}
                onChange={(e) => updateBranding({ accentColor: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={branding.introEnabled}
                onChange={(e) => updateBranding({ introEnabled: e.target.checked })}
              />
              Intro card
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={branding.outroEnabled}
                onChange={(e) => updateBranding({ outroEnabled: e.target.checked })}
              />
              Outro card
            </label>
            {(branding.introEnabled || branding.outroEnabled) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Card duration
                <input
                  type="number"
                  step={0.5}
                  min={1}
                  max={10}
                  value={branding.introDurationSeconds}
                  onChange={(e) => updateBranding({ introDurationSeconds: parseFloat(e.target.value) || 1 })}
                  style={{ width: 60 }}
                />
                s
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={branding.lowerThirdEnabled}
                onChange={(e) => updateBranding({ lowerThirdEnabled: e.target.checked })}
              />
              Lower-third
            </label>
            {branding.lowerThirdEnabled && (
              <input
                type="text"
                placeholder={branding.displayName}
                value={branding.lowerThirdText}
                onChange={(e) => updateBranding({ lowerThirdText: e.target.value })}
                style={{ width: 140 }}
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Watermark corner
              <select
                value={branding.watermarkCorner}
                onChange={(e) => updateBranding({ watermarkCorner: e.target.value as WatermarkCorner })}
                style={{ padding: '4px 6px' }}
              >
                {WATERMARK_CORNERS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ color: '#777', fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            The Astrofrags watermark applies to every export automatically and can't be turned off.
            Lower-third applies to every export when enabled above. Intro/outro cards only apply when combining
            clips into a reel.
          </p>
        </div>
      )}

      {recentClips.length > 0 && recentClipsExpanded && (
        <div style={{ marginTop: 16 }}>
          <h3>Recent clips ({recentClips.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: 200, overflowY: 'auto' }}>
            {recentClips.map((clip) => (
              <li key={clip.path}>
                <button
                  onClick={() => loadVideo(clip.path)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    gap: 12,
                    alignItems: 'baseline',
                    textAlign: 'left',
                    padding: '4px 8px',
                    marginBottom: 2,
                    background: videoPath === clip.path ? '#2f5fce' : '#2a2a2a',
                    color: '#eee',
                    border: '1px solid #444',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#999', fontSize: 12, flexShrink: 0 }}>
                    {new Date(clip.createdAtMs).toLocaleString()}
                  </span>
                  <span>{clip.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        @media (max-width: 1000px) {
          .af-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div
        className="af-two-col"
        style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 24, alignItems: 'start', marginTop: 16 }}
      >
        <div style={{ gridColumn: 1, order: 1 }}>
          <h3 style={{ marginTop: 0 }}>Find a moment</h3>
          {videoPath && <p style={{ color: '#777', fontSize: 12 }}>{videoPath}</p>}
      {status === 'analyzing' && <p>Analyzing audio…</p>}
      {status === 'error' && <p style={{ color: '#ff6b6b' }}>Error: {error}</p>}

      {previewPath && (
        <div ref={videoWrapperRef} style={{ position: 'relative', marginTop: 16 }}>
          <video
            ref={videoRef}
            src={toFileUrl(previewPath)}
            controls
            onError={(e) => {
              const el = e.currentTarget
              setVideoError(el.error ? `${el.error.code}: ${el.error.message}` : 'Unknown video error')
            }}
            onTimeUpdate={(e) => {
              wavesurferRef.current?.setTime(e.currentTarget.currentTime)
              if (activeClip && e.currentTarget.currentTime >= activeClip.end) {
                e.currentTarget.pause()
              }
            }}
            onLoadedMetadata={updateVideoBox}
            style={{ width: '100%', maxHeight: 360, background: '#000', display: 'block' }}
          />
          {videoBox && (regionDrawMode || killfeedRegion) && (
            <div
              onMouseDown={handleRegionMouseDown}
              onMouseMove={handleRegionMouseMove}
              onMouseUp={handleRegionMouseUp}
              style={{
                position: 'absolute',
                top: videoBox.top,
                left: videoBox.left,
                width: videoBox.width,
                height: videoBox.height,
                cursor: regionDrawMode ? 'crosshair' : 'default',
                pointerEvents: regionDrawMode ? 'auto' : 'none'
              }}
            >
              {killfeedRegion && !draftRegion && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${killfeedRegion.x * 100}%`,
                    top: `${killfeedRegion.y * 100}%`,
                    width: `${killfeedRegion.w * 100}%`,
                    height: `${killfeedRegion.h * 100}%`,
                    border: '2px solid #9b63ff',
                    background: 'rgba(155, 99, 255, 0.15)'
                  }}
                />
              )}
              {draftRegion && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${draftRegion.x * 100}%`,
                    top: `${draftRegion.y * 100}%`,
                    width: `${draftRegion.w * 100}%`,
                    height: `${draftRegion.h * 100}%`,
                    border: '2px dashed #9b63ff',
                    background: 'rgba(155, 99, 255, 0.15)'
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
      {videoError && <p style={{ color: '#ff6b6b' }}>Video playback error: {videoError}</p>}

      {previewPath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            onClick={() => setRegionDrawMode(true)}
            disabled={regionDrawMode}
            style={{ padding: '4px 10px', cursor: 'pointer' }}
          >
            {killfeedRegion ? 'Redraw kill-feed region' : 'Set kill-feed region'}
          </button>
          {regionDrawMode && (
            <span style={{ color: '#9b63ff', fontSize: 13 }}>Click and drag on the video to mark the area</span>
          )}
          {killfeedRegion && !regionDrawMode && (
            <button
              onClick={() => setKillfeedRegion(null)}
              style={{ padding: '4px 10px', cursor: 'pointer', color: '#ff6b6b' }}
            >
              Clear region
            </button>
          )}
          {killfeedRegion && (
            <button
              onClick={handleDetectVisualEvents}
              disabled={visualDetectStatus === 'loading'}
              style={{ padding: '4px 10px', cursor: 'pointer' }}
            >
              {visualDetectStatus === 'loading' ? 'Scanning for events…' : 'Detect visual events'}
            </button>
          )}
        </div>
      )}
      {visualDetectStatus === 'error' && (
        <p style={{ color: '#ff6b6b' }}>Visual detection failed: {visualDetectError}</p>
      )}

      {videoPath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button
            onClick={toggleManualClipMode}
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              color: manualClipMode ? '#5bd68d' : undefined
            }}
          >
            {manualClipMode ? 'Done adding' : 'Add clip manually'}
          </button>
          {manualClipMode && (
            <span style={{ color: '#5bd68d', fontSize: 13 }}>
              Click and drag on the waveform to select a clip — no detected moment needed.
            </span>
          )}
        </div>
      )}

      {videoPath && audioTrackCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Audio track
            <select
              value={audioTrackIndex}
              onChange={(e) => setAudioTrackIndex(Number(e.target.value))}
              style={{ padding: '4px 6px' }}
            >
              {Array.from({ length: audioTrackCount }, (_, i) => (
                <option key={i} value={i}>
                  Track {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handlePreviewAudioTrack}
            disabled={trackPreviewLoading}
            style={{ padding: '4px 10px', cursor: 'pointer' }}
          >
            {trackPreviewLoading ? 'Loading…' : '▶ Preview'}
          </button>
          <span style={{ color: '#999', fontSize: 12 }}>
            This video has {audioTrackCount} separate audio tracks (e.g. game audio and mic) — pick which one new
            clips use, or preview to tell them apart.
          </span>
          {trackPreviewPath && (
            <audio key={trackPreviewPath} controls autoPlay src={toFileUrl(trackPreviewPath)} style={{ height: 28 }} />
          )}
        </div>
      )}

      <div ref={waveformWrapperRef} style={{ position: 'relative', marginTop: 16, marginBottom: 16 }}>
        <div ref={waveformRef} />
        {manualClipMode && (
          <div
            onMouseDown={handleManualClipMouseDown}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              // A plain z-index-less absolutely-positioned overlay still loses the hit-test
              // to wavesurfer's own internal rendering layer despite being a later sibling —
              // confirmed by reproducing it in isolation. An explicit z-index is what
              // actually puts this overlay on top.
              zIndex: 10,
              cursor: 'crosshair'
            }}
          />
        )}
      </div>
        </div>

      {clips.length > 0 && (
        <div style={{ marginBottom: 16, gridColumn: 2, order: 2 }}>
          <h3 style={{ marginTop: 0 }}>Build the reel</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Selected clips ({clips.length})</h3>
            <span
              style={{
                color: isShortsPreset && totalClipsDuration > SHORTS_DURATION_CAP_SECONDS ? '#ff6b6b' : '#999',
                fontSize: 12
              }}
            >
              Total: {formatTime(totalClipsDuration)}
              {isShortsPreset ? ' / 3:00 for Shorts' : ''}
            </span>
            {isShortsPreset && totalClipsDuration > SHORTS_DURATION_CAP_SECONDS && (
              <button
                onClick={autoFitClipsToShortsCap}
                title="Proportionally shorten every clip so the reel fits under 3 minutes"
                style={{ padding: '4px 10px', cursor: 'pointer' }}
              >
                Fit to 3:00
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={transitionsEnabled}
                disabled={clips.length < 2}
                onChange={(e) => setTransitionsEnabled(e.target.checked)}
              />
              Transitions
            </label>
            {transitionsEnabled && clips.length >= 2 && (
              <>
                <select
                  value={transitionStyle}
                  onChange={(e) => setTransitionStyle(e.target.value as TransitionStyle)}
                  style={{ padding: '4px 6px' }}
                >
                  {TRANSITION_STYLES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="range"
                    min={0.2}
                    max={2}
                    step={0.1}
                    value={transitionDuration}
                    onChange={(e) => setTransitionDuration(Number(e.target.value))}
                  />
                  {transitionDuration.toFixed(1)}s
                </label>
              </>
            )}
            <button onClick={handleSelectMusic} style={{ padding: '4px 10px', cursor: 'pointer' }}>
              {musicPath ? 'Change music' : 'Add background music'}
            </button>
            {musicPath && (
              <>
                <span style={{ color: '#999', fontSize: 12 }}>{musicPath}</span>
                <button
                  onClick={handleRemoveMusic}
                  style={{ padding: '4px 10px', cursor: 'pointer', color: '#ff6b6b' }}
                >
                  Remove music
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={muteOriginal}
                    onChange={(e) => setMuteOriginal(e.target.checked)}
                  />
                  Music only (mute original audio)
                </label>
              </>
            )}
            <button
              onClick={handlePreviewReel}
              disabled={reelPreviewStatus === 'loading' || clips.length < 2}
              style={{ padding: '6px 14px', cursor: 'pointer' }}
            >
              {reelPreviewStatus === 'loading' ? 'Rendering preview…' : 'Preview reel'}
            </button>
            <button
              onClick={handleExportReel}
              disabled={reelStatus === 'exporting' || clips.length < 2}
              style={{ padding: '6px 14px', cursor: 'pointer' }}
            >
              {reelStatus === 'exporting' ? 'Combining…' : 'Combine into one clip'}
            </button>
            {reelStatus === 'done' && reelPath && (
              <span style={{ color: '#7cfc98' }}>
                Saved to{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    window.api.showInFolder(reelPath)
                  }}
                  style={{ color: '#7cfc98' }}
                >
                  {reelPath}
                </a>
                {clips.some((c) => c.captions) && !reelCaptionsAdded && ' (no speech detected — no captions added)'}
              </span>
            )}
            {reelStatus === 'error' && <span style={{ color: '#ff6b6b' }}>Combine failed: {reelError}</span>}
          </div>
          {reelPreviewStatus === 'error' && (
            <p style={{ color: '#ff6b6b' }}>Preview failed: {reelPreviewError}</p>
          )}
          {reelPreviewPath && (
            <video
              key={reelPreviewPath}
              controls
              autoPlay
              src={toFileUrl(reelPreviewPath)}
              style={{ width: '100%', maxHeight: 300, background: '#000', marginBottom: 16 }}
            />
          )}
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          {clips.map((clip, index) => (
            <div
              key={clip.id}
              style={{
                marginBottom: 8,
                padding: 12,
                background: activeClipId === clip.id ? '#243b2a' : '#222',
                border: activeClipId === clip.id ? '1px solid #5bd68d' : '1px solid #444'
              }}
            >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <button
                  onClick={() => moveClip(clip.id, 'up')}
                  disabled={index === 0}
                  title="Move earlier in the sequence"
                  style={{ padding: '0 6px', cursor: 'pointer', lineHeight: 1.2 }}
                >
                  ▲
                </button>
                <button
                  onClick={() => moveClip(clip.id, 'down')}
                  disabled={index === clips.length - 1}
                  title="Move later in the sequence"
                  style={{ padding: '0 6px', cursor: 'pointer', lineHeight: 1.2 }}
                >
                  ▼
                </button>
              </div>
              <span style={{ color: '#777', fontSize: 11 }} title={clip.sourceVideoPath}>
                {basename(clip.sourceVideoPath)}
              </span>
              <button onClick={() => playClip(clip)} style={{ padding: '4px 10px', cursor: 'pointer' }}>
                Play
              </button>
              <label>
                Start{' '}
                <input
                  type="number"
                  step={0.1}
                  value={clip.start.toFixed(1)}
                  onChange={(e) => updateClip(clip.id, { start: parseFloat(e.target.value) || 0, end: clip.end })}
                  style={{ width: 70 }}
                />
              </label>
              <label>
                End{' '}
                <input
                  type="number"
                  step={0.1}
                  value={clip.end.toFixed(1)}
                  onChange={(e) => updateClip(clip.id, { start: clip.start, end: parseFloat(e.target.value) || 0 })}
                  style={{ width: 70 }}
                />
              </label>
              <span style={{ color: '#999' }}>{(clip.end - clip.start).toFixed(1)}s</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={clip.captions}
                  onChange={(e) =>
                    setClips((prev) =>
                      prev.map((c) => (c.id === clip.id ? { ...c, captions: e.target.checked } : c))
                    )
                  }
                />
                Captions
              </label>
              <button
                onClick={() => handlePreviewCaptions(clip.id)}
                disabled={clip.captionPreviewStatus === 'loading'}
                style={{ padding: '4px 10px', cursor: 'pointer' }}
              >
                {clip.captionPreviewStatus === 'loading' ? 'Transcribing…' : 'Preview captions'}
              </button>
              <button
                onClick={() => handleExportClip(clip.id)}
                disabled={clip.exportStatus === 'exporting'}
                style={{ padding: '6px 14px', cursor: 'pointer' }}
              >
                {clip.exportStatus === 'exporting'
                  ? clip.captions
                    ? 'Transcribing + exporting…'
                    : 'Exporting…'
                  : 'Export clip'}
              </button>
              {clip.exportStatus === 'done' && clip.exportedPath && (
                <span style={{ color: '#7cfc98' }}>
                  Saved to{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      window.api.showInFolder(clip.exportedPath as string)
                    }}
                    style={{ color: '#7cfc98' }}
                  >
                    {clip.exportedPath}
                  </a>
                  {clip.captions && !clip.captionsAdded && ' (no speech detected — no captions added)'}
                </span>
              )}
              {clip.exportStatus === 'error' && (
                <span style={{ color: '#ff6b6b' }}>Export failed: {clip.exportError}</span>
              )}
              <button
                onClick={() => removeClip(clip.id)}
                style={{ padding: '4px 10px', cursor: 'pointer', color: '#ff6b6b' }}
              >
                Remove
              </button>
            </div>
            {clip.captionPreviewStatus === 'error' && (
              <p style={{ color: '#ff6b6b', marginTop: 8, marginBottom: 0 }}>
                Preview failed: {clip.captionPreviewError}
              </p>
            )}
            {clip.captionPreviewStatus === 'done' && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #444' }}>
                {clip.captionPreview && clip.captionPreview.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
                    {clip.captionPreview.map((line, i) => (
                      <li
                        key={i}
                        style={{ marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center' }}
                      >
                        <span style={{ color: '#777', flexShrink: 0 }}>
                          [{formatTime(line.start)}–{formatTime(line.end)}]
                        </span>
                        <input
                          type="text"
                          value={line.text}
                          onChange={(e) => updateCaptionLine(clip.id, i, e.target.value)}
                          style={{
                            flex: 1,
                            background: '#1a1a1a',
                            color: '#eee',
                            border: '1px solid #444',
                            padding: '2px 6px',
                            fontSize: 13
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: '#999', margin: 0, fontSize: 13 }}>No speech detected in this clip.</p>
                )}
              </div>
            )}
            </div>
          ))}
          </div>
        </div>
      )}

      {peaks.length > 0 && (
        <div style={{ gridColumn: 1, order: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Detected peaks ({peaks.length})</h3>
            <button
              onClick={autoBuildReel}
              title={`Add up to ${AUTO_BUILD_CLIP_COUNT} highest-scoring, non-overlapping detected peaks as clips in one click`}
              style={{ padding: '4px 10px', cursor: 'pointer' }}
            >
              Auto-build reel (top {AUTO_BUILD_CLIP_COUNT})
            </button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: 300, overflowY: 'auto' }}>
            {peaks.map((peak) => {
              const added = clips.some((c) => c.id === peak.id)
              return (
                <li key={peak.id}>
                  <button
                    onClick={() => addOrFocusClip(peak)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '4px 8px',
                      marginBottom: 2,
                      background: activeClipId === peak.id ? '#2f5fce' : added ? '#1e3a24' : '#2a2a2a',
                      color: '#eee',
                      border: activeClipId === peak.id ? '1px solid #8fb4ff' : '1px solid #444',
                      boxShadow: activeClipId === peak.id ? '0 0 0 1px #8fb4ff' : 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {peak.source === 'visual' ? '👁 ' : ''}
                    {formatTime(peak.time)} — score {peak.score.toFixed(3)}
                    {added ? ' ✓' : ''}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
