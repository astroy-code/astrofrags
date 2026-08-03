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

const EXPORT_PRESETS = [
  { value: 'original', label: 'Original (16:9)' },
  { value: 'vertical', label: 'Vertical — TikTok/Shorts/Reels (9:16)' },
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
  exportStatus: 'idle' | 'exporting' | 'done' | 'error'
  exportedPath: string | null
  exportError: string | null
  captionsAdded: boolean
  captionPreview: CaptionLine[] | null
  captionPreviewStatus: 'idle' | 'loading' | 'done' | 'error'
  captionPreviewError: string | null
}

type RegionsPluginInstance = ReturnType<typeof RegionsPlugin.create>
type RegionInstance = ReturnType<RegionsPluginInstance['addRegion']>

const CLIP_PAD_BEFORE = 5
const CLIP_PAD_AFTER = 3

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

  const [videoPath, setVideoPath] = useState<string | null>(null)
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
      exportStatus: 'idle',
      exportedPath: null,
      exportError: null,
      captionsAdded: false,
      captionPreview: null,
      captionPreviewStatus: 'idle',
      captionPreviewError: null
    }
    setClips((prev) => [...prev, newClip].sort((a, b) => a.start - b.start))
    setActiveClipId(id)
    addClipRegion(newClip)

    if (videoRef.current) {
      videoRef.current.currentTime = start
    }
  }

  function addPeakMarker(peak: DisplayPeak): RegionInstance | undefined {
    const regions = regionsRef.current
    if (!regions) return undefined

    const marker = regions.addRegion({
      start: peak.time,
      end: peak.time + 0.15,
      color: peak.source === 'visual' ? 'rgba(155, 99, 255, 0.6)' : 'rgba(255, 99, 71, 0.6)',
      drag: false,
      resize: false
    })
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

  function addClipRegion(clip: ClipItem): void {
    const regions = regionsRef.current
    if (!regions) return

    const region = regions.addRegion({
      start: clip.start,
      end: clip.end,
      color: 'rgba(91, 214, 141, 0.35)',
      drag: true,
      resize: true
    })
    region.on('update-end', () => {
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, start: region.start, end: region.end } : c)))
    })
    region.on('click', () => setActiveClipId(clip.id))
    clipRegionsRef.current.set(clip.id, region)
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
        clips.filter((c) => c.sourceVideoPath === path).forEach(addClipRegion)
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
        exportPreset
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
          captionLines: c.captionPreview ?? undefined
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
          captionLines: c.captionPreview ?? undefined
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

      {recentClips.length > 0 && (
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

      <div ref={waveformRef} style={{ marginTop: 16, marginBottom: 16 }} />

      {clips.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Selected clips ({clips.length})</h3>
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
          {clips.map((clip) => (
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
      )}

      {peaks.length > 0 && (
        <div>
          <h3>Detected peaks ({peaks.length})</h3>
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
                      border: '1px solid #444',
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
  )
}
