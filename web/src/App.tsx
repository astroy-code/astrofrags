import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioTrackPicker } from './components/AudioTrackPicker.tsx'
import { ExportBar } from './components/ExportBar.tsx'
import type { ExportState } from './components/ExportBar.tsx'
import { FilePicker } from './components/FilePicker.tsx'
import { Notice } from './components/Notice.tsx'
import { TrimPlayer } from './components/TrimPlayer.tsx'
import type { VideoMetadata } from './components/TrimPlayer.tsx'
import { isSilent, pickLoudestTrack } from './lib/audioLevels.ts'
import type { TrackLevel } from './lib/audioLevels.ts'
import { deliverClip } from './lib/deliverClip.ts'
import { shouldAutoDeliver } from './lib/deliveryPolicy.ts'
import { ExportCancelledError, exportTrimmedClip, probeAudioTracks } from './lib/exportClip.ts'
import { isPreviewUndecodable, UNDECODABLE_MESSAGE } from './lib/previewSupport.ts'
import { checkFileSize, detectPlatform, parseLimitOverride, SOFT_LIMIT_BYTES } from './lib/sizeLimit.ts'
import { validateTrimRange } from './lib/trimRange.ts'
import type { TrimRange } from './lib/trimRange.ts'

interface Session {
  readonly file: File
  readonly objectUrl: string
  readonly duration: number
  readonly range: TrimRange
  /** Loudness per audio track; empty until the probe finishes (or for a file with no audio). */
  readonly audioLevels: readonly TrackLevel[]
  readonly audioProbeDone: boolean
  /** The user's explicit track choice; null means "use the loudest". */
  readonly audioTrackOverride: number | null
  readonly previewBroken: boolean
  readonly sizeWarningDismissed: boolean
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
    audioProbeDone: false,
    audioTrackOverride: null,
    previewBroken: false,
    sizeWarningDismissed: false
  }
}

function selectedTrack(session: Session): number {
  return session.audioTrackOverride ?? pickLoudestTrack(session.audioLevels)
}

function applyMetadata(session: Session, metadata: VideoMetadata): Session {
  const durationKnown = Number.isFinite(metadata.duration) && metadata.duration > 0
  const durationChanged = durationKnown && metadata.duration !== session.duration
  return {
    ...session,
    duration: durationChanged ? metadata.duration : session.duration,
    // A new duration (including Infinity -> finite on some phone files) resets the range to the whole clip.
    range: durationChanged ? { start: 0, end: metadata.duration } : session.range,
    previewBroken: metadata.kind === 'duration' ? session.previewBroken : isPreviewUndecodable(metadata)
  }
}

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), [])
  const limits = useMemo(() => parseLimitOverride(window.location.search) ?? SOFT_LIMIT_BYTES, [])
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
    void probeAudioTracks(file).then((audioLevels) =>
      setSession((current) =>
        current && current.file === file ? { ...current, audioLevels, audioProbeDone: true } : current
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
  }, [session, platform])

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
    validateTrimRange(session.range, session.duration).ok
  const allTracksSilent =
    session !== null &&
    session.audioProbeDone &&
    session.audioLevels.length > 0 &&
    session.audioLevels.every(isSilent)
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
          selected={selectedTrack(session)}
          onSelect={(audioTrackOverride) =>
            setSession((current) => (current ? { ...current, audioTrackOverride } : current))
          }
        />
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
