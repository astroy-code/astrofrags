import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioTrackPicker } from './components/AudioTrackPicker.tsx'
import { BrandingOptions } from './components/BrandingOptions.tsx'
import { CardPreview } from './components/CardPreview.tsx'
import { ExportBar } from './components/ExportBar.tsx'
import { ExportFormatPicker } from './components/ExportFormatPicker.tsx'
import { MusicPicker } from './components/MusicPicker.tsx'
import type { ExportState } from './components/ExportBar.tsx'
import { FilePicker } from './components/FilePicker.tsx'
import { Notice } from './components/Notice.tsx'
import { TrimPlayer } from './components/TrimPlayer.tsx'
import type { VideoMetadata } from './components/TrimPlayer.tsx'
import { chooseAudioTrack, isSilent } from './lib/audioLevels.ts'
import type { TrackLevel } from './lib/audioLevels.ts'
import { deliverClip } from './lib/deliverClip.ts'
import { estimateExportSeconds } from './lib/estimate.ts'
import { shouldAutoDeliver } from './lib/deliveryPolicy.ts'
import { ExportCancelledError, exportTrimmedClip, probeAudioTracks } from './lib/exportClip.ts'
import { isPreviewUndecodable, UNDECODABLE_MESSAGE } from './lib/previewSupport.ts'
import { checkFileSize, detectPlatform, parseLimitOverride, SOFT_LIMIT_BYTES } from './lib/sizeLimit.ts'
import { formatOutputSize } from './lib/exportFormat.ts'
import type { Size } from './lib/outputGeometry.ts'
import { validateTrimRange } from './lib/trimRange.ts'
import type { TrimRange } from './lib/trimRange.ts'
import { useBrandingSettings } from './useBrandingSettings.ts'

interface Session {
  readonly file: File
  readonly objectUrl: string
  readonly duration: number
  readonly range: TrimRange
  /** Loudness per audio track; empty until the probe finishes (or for a file with no audio). */
  readonly audioLevels: readonly TrackLevel[]
  /** Audio streams in the file; null until known, or when the probe could not read the file. */
  readonly audioTrackCount: number | null
  readonly audioProbeDone: boolean
  /** The user's explicit track choice; null means "use the loudest". */
  readonly audioTrackOverride: number | null
  readonly previewBroken: boolean
  readonly sizeWarningDismissed: boolean
  /** The video's displayed size; 0x0 until the preview reports it. */
  readonly videoSize: Size
  /** Background music for this export only; never persisted. */
  readonly musicFile: File | null
}

interface ExportedClip {
  readonly blob: Blob
  readonly fileName: string
}

const BYTES_PER_MEGABYTE = 1024 * 1024
const IDLE: ExportState = { phase: 'idle' }

function newSession(file: File): Session {
  return {
    file,
    objectUrl: URL.createObjectURL(file),
    duration: 0,
    range: { start: 0, end: 0 },
    audioLevels: [],
    audioTrackCount: null,
    audioProbeDone: false,
    audioTrackOverride: null,
    previewBroken: false,
    sizeWarningDismissed: false,
    videoSize: { width: 0, height: 0 },
    musicFile: null
  }
}

/** The audio stream to export, or null when the video has none. */
function selectedTrack(session: Session): number | null {
  return chooseAudioTrack({
    trackCount: session.audioTrackCount,
    levels: session.audioLevels,
    override: session.audioTrackOverride
  })
}

function applyMetadata(session: Session, metadata: VideoMetadata): Session {
  const durationKnown = Number.isFinite(metadata.duration) && metadata.duration > 0
  const durationChanged = durationKnown && metadata.duration !== session.duration
  return {
    ...session,
    duration: durationChanged ? metadata.duration : session.duration,
    // A new duration (including Infinity -> finite on some phone files) resets the range to the whole clip.
    range: durationChanged ? { start: 0, end: metadata.duration } : session.range,
    previewBroken: metadata.kind === 'duration' ? session.previewBroken : isPreviewUndecodable(metadata),
    videoSize:
      metadata.videoWidth > 0 && metadata.videoHeight > 0
        ? { width: metadata.videoWidth, height: metadata.videoHeight }
        : session.videoSize
  }
}

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), [])
  const limits = useMemo(() => parseLimitOverride(window.location.search) ?? SOFT_LIMIT_BYTES, [])
  const [branding, updateBranding] = useBrandingSettings()
  const [session, setSession] = useState<Session | null>(null)
  const [exportState, setExportState] = useState<ExportState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)
  const exportedRef = useRef<ExportedClip | null>(null)

  const objectUrl = session?.objectUrl
  useEffect(() => {
    if (!objectUrl) return undefined
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  const handlePick = useCallback((file: File) => {
    // A running export belongs to the previous video; it must not finish into the new one.
    // A running export belongs to the previous video; it must not finish into the new one.
    abortRef.current?.abort()
    exportedRef.current = null
    setExportState(IDLE)
    setSession(newSession(file))
    void probeAudioTracks(file).then(({ trackCount, levels }) =>
      setSession((current) =>
        current && current.file === file
          ? { ...current, audioLevels: levels, audioTrackCount: trackCount, audioProbeDone: true }
          : current
      )
    )
  }, [])

  const handleMetadata = useCallback((metadata: VideoMetadata) => {
    setSession((current) => (current ? applyMetadata(current, metadata) : current))
  }, [])

  const handleExport = useCallback(async () => {
    if (!session) return
    const controller = new AbortController()
    abortRef.current = controller
    setExportState({ phase: 'running', progress: 0 })
    try {
      const clip = await exportTrimmedClip({
        file: session.file,
        start: session.range.start,
        end: session.range.end,
        duration: session.duration,
        audioTrackIndex: selectedTrack(session),
        branding,
        musicFile: session.musicFile,
        sourceSize: session.videoSize,
        onProgress: (progress) =>
          setExportState((current) => (current.phase === 'running' ? { phase: 'running', progress } : current)),
        signal: controller.signal
      })
      exportedRef.current = clip
      const delivery = shouldAutoDeliver(platform) ? await deliverClip(clip.blob, clip.fileName, platform) : 'pending'
      setExportState({ phase: 'done', fileName: clip.fileName, delivery })
    } catch (error) {
      // A superseded export (the user picked another video) must not overwrite newer state.
      if (abortRef.current !== controller) return
      if (error instanceof ExportCancelledError) {
        setExportState(IDLE)
      } else {
        setExportState({ phase: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [session, platform, branding])

  const handleDeliverAgain = useCallback(async () => {
    const clip = exportedRef.current
    if (!clip) return
    const delivery = await deliverClip(clip.blob, clip.fileName, platform)
    setExportState({ phase: 'done', fileName: clip.fileName, delivery })
  }, [platform])

  const handleTrimAnother = useCallback(() => {
    abortRef.current?.abort()
    exportedRef.current = null
    setExportState(IDLE)
    setSession(null)
  }, [])

  // Export waits for the audio analysis so a quick click can't pick the wrong (silent) track.
  const canExport =
    session !== null &&
    session.audioProbeDone &&
    !session.previewBroken &&
    session.videoSize.width > 0 &&
    validateTrimRange(session.range, session.duration).ok
  const allTracksSilent =
    session !== null &&
    session.audioProbeDone &&
    session.audioLevels.length > 0 &&
    session.audioLevels.every(isSilent)
  const estimateSeconds =
    session !== null && canExport
      ? estimateExportSeconds({
          durationSeconds:
            session.range.end -
            session.range.start +
            (branding.introEnabled ? branding.cardDurationSeconds : 0) +
            (branding.outroEnabled ? branding.cardDurationSeconds : 0),
          output: formatOutputSize(branding.exportFormat, session.videoSize),
          hasCards: branding.introEnabled || branding.outroEnabled,
          platform
        })
      : null
  const sizeWarning =
    session !== null && !session.sizeWarningDismissed && checkFileSize(session.file.size, platform, limits) === 'warn'

  return (
    <main className="app">
      <h1>Astrofrags Web</h1>
      <p className="tagline">Trim a clip right in your browser. Nothing is uploaded.</p>

      <FilePicker label={session ? 'Pick a different video' : 'Pick a video'} onPick={handlePick} />

      {session && sizeWarning && (
        <Notice
          kind="warn"
          actionLabel={platform === 'mobile' ? 'Try anyway' : undefined}
          onAction={() => setSession({ ...session, sizeWarningDismissed: true })}
        >
          {platform === 'mobile'
            ? `This video is ${Math.round(session.file.size / BYTES_PER_MEGABYTE)} MB, which is large for a phone browser and may crash this tab. For long recordings, use the desktop app.`
            : `This video is ${Math.round(session.file.size / BYTES_PER_MEGABYTE)} MB. The web version may be slow or run out of memory on files this big; for long recordings, the desktop app is more reliable.`}
        </Notice>
      )}

      {session && !session.audioProbeDone && <p data-testid="audio-status">Analyzing audio…</p>}

      {allTracksSilent && (
        <Notice kind="warn">
          No sound was detected in this video&apos;s audio, so the exported clip will probably be silent.
        </Notice>
      )}

      {session && session.previewBroken && <Notice kind="error">{UNDECODABLE_MESSAGE}</Notice>}

      {session && (
        <TrimPlayer
          key={session.objectUrl}
          objectUrl={session.objectUrl}
          duration={session.duration}
          range={session.range}
          onMetadata={handleMetadata}
          onRangeChange={(range) => setSession({ ...session, range })}
        />
      )}

      {session && session.audioLevels.length > 1 && (
        <AudioTrackPicker
          levels={session.audioLevels}
          selected={selectedTrack(session) ?? 0}
          onSelect={(audioTrackOverride) =>
            setSession((current) => (current ? { ...current, audioTrackOverride } : current))
          }
        />
      )}

      {session && (
        <>
          <ExportFormatPicker format={branding.exportFormat} onChange={(exportFormat) => updateBranding({ exportFormat })} />
          <BrandingOptions settings={branding} onChange={updateBranding} />
          {(branding.introEnabled || branding.outroEnabled) && (
            <CardPreview style={branding} format={branding.exportFormat} />
          )}
          <MusicPicker
            musicFile={session.musicFile}
            onChange={(musicFile) =>
              setSession((current) => (current && current.file === session.file ? { ...current, musicFile } : current))
            }
          />
        </>
      )}

      {session && estimateSeconds !== null && exportState.phase !== 'running' && (
        <p className="hint" data-testid="export-estimate">
          About {estimateSeconds} s
        </p>
      )}

      {session && (
        <ExportBar
          canExport={canExport}
          state={exportState}
          onExport={() => void handleExport()}
          onCancel={() => abortRef.current?.abort()}
          onDeliver={() => void handleDeliverAgain()}
          onTrimAnother={handleTrimAnother}
        />
      )}
    </main>
  )
}
