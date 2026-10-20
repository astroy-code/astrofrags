import { useCallback, useMemo, useRef, useState } from 'react'
import { AudioTrackPicker } from './components/AudioTrackPicker.tsx'
import { BrandingOptions } from './components/BrandingOptions.tsx'
import { CardPreview } from './components/CardPreview.tsx'
import { ClipList } from './components/ClipList.tsx'
import { ClipMetadataProbe } from './components/ClipMetadataProbe.tsx'
import { ExportBar } from './components/ExportBar.tsx'
import { ExportFormatPicker } from './components/ExportFormatPicker.tsx'
import { MusicPicker } from './components/MusicPicker.tsx'
import type { ExportState } from './components/ExportBar.tsx'
import { FilePicker } from './components/FilePicker.tsx'
import { Notice } from './components/Notice.tsx'
import { TransitionOptions } from './components/TransitionOptions.tsx'
import { TrimPlayer } from './components/TrimPlayer.tsx'
import { chooseAudioTrack, isSilent } from './lib/audioLevels.ts'
import { deliverClip } from './lib/deliverClip.ts'
import { shouldAutoDeliver } from './lib/deliveryPolicy.ts'
import { estimateExportSeconds } from './lib/estimate.ts'
import { ExportCancelledError, exportTrimmedClip } from './lib/exportClip.ts'
import type { ExportClip } from './lib/exportClip.ts'
import { formatOutputSize } from './lib/exportFormat.ts'
import { planDurationSeconds } from './lib/exportGraph.ts'
import { UNDECODABLE_MESSAGE } from './lib/previewSupport.ts'
import { selectedClip } from './lib/reel.ts'
import type { ClipItem } from './lib/reel.ts'
import { buildExportPlan } from './lib/reelPlan.ts'
import {
  checkClipCount,
  checkFileSize,
  detectPlatform,
  parseLimitOverride,
  SOFT_LIMIT_BYTES
} from './lib/sizeLimit.ts'
import { validateTrimRange } from './lib/trimRange.ts'
import { useBrandingSettings } from './useBrandingSettings.ts'
import { useReel } from './useReel.ts'

interface ExportedClip {
  readonly blob: Blob
  readonly fileName: string
}

const BYTES_PER_MEGABYTE = 1024 * 1024
const IDLE: ExportState = { phase: 'idle' }
// Only the length of the logo's frame matters for the estimate, so any size will do.
const ESTIMATE_LOGO = { width: 1, height: 1 }

/** The audio stream to export for a clip, or null when its video has none. */
const trackOf = (clip: ClipItem): number | null =>
  chooseAudioTrack({
    trackCount: clip.audioTrackCount,
    levels: clip.audioLevels,
    override: clip.audioTrackOverride
  })

// Export waits for the audio analysis so a quick click can't pick the wrong (silent) track.
const isReady = (clip: ClipItem): boolean =>
  clip.audioProbeDone &&
  !clip.previewBroken &&
  clip.videoSize.width > 0 &&
  validateTrimRange(clip.range, clip.duration).ok

const toExportClip = (clip: ClipItem): ExportClip => ({
  file: clip.file,
  start: clip.range.start,
  end: clip.range.end,
  duration: clip.duration,
  audioTrackIndex: trackOf(clip),
  sourceSize: clip.videoSize
})

const megabytes = (bytes: number): number => Math.round(bytes / BYTES_PER_MEGABYTE)

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), [])
  const limits = useMemo(() => parseLimitOverride(window.location.search) ?? SOFT_LIMIT_BYTES, [])
  const [branding, updateBranding] = useBrandingSettings()
  const [reel, actions] = useReel()
  const [exportState, setExportState] = useState<ExportState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)
  const exportedRef = useRef<ExportedClip | null>(null)

  const running = exportState.phase === 'running'
  const selected = selectedClip(reel)
  const hasClips = reel.clips.length > 0

  const handleExport = useCallback(async () => {
    if (reel.clips.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setExportState({ phase: 'running', progress: 0 })
    try {
      const clip = await exportTrimmedClip({
        clips: reel.clips.map(toExportClip),
        branding,
        musicFile: reel.musicFile,
        onProgress: (progress) =>
          setExportState((current) => (current.phase === 'running' ? { phase: 'running', progress } : current)),
        signal: controller.signal
      })
      exportedRef.current = clip
      const delivery = shouldAutoDeliver(platform) ? await deliverClip(clip.blob, clip.fileName, platform) : 'pending'
      setExportState({ phase: 'done', fileName: clip.fileName, delivery })
    } catch (error) {
      // A superseded export (the user started over) must not overwrite newer state.
      if (abortRef.current !== controller) return
      if (error instanceof ExportCancelledError) {
        setExportState(IDLE)
      } else {
        setExportState({ phase: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [reel.clips, reel.musicFile, platform, branding])

  const handleDeliverAgain = useCallback(async () => {
    const clip = exportedRef.current
    if (!clip) return
    const delivery = await deliverClip(clip.blob, clip.fileName, platform)
    setExportState({ phase: 'done', fileName: clip.fileName, delivery })
  }, [platform])

  const handleStartOver = useCallback(() => {
    // A running export belongs to the old reel; it must not finish into a new one.
    abortRef.current?.abort()
    abortRef.current = null
    exportedRef.current = null
    setExportState(IDLE)
    actions.startOver()
  }, [actions])

  const handlePick = useCallback(
    (files: readonly File[]) => {
      // New clips make a finished export stale.
      exportedRef.current = null
      setExportState((current) => (current.phase === 'running' ? current : IDLE))
      actions.addFiles(files)
    },
    [actions]
  )

  const canExport = hasClips && reel.clips.every(isReady)
  const brokenClips = reel.clips.filter((clip) => clip.previewBroken)
  const allTracksSilent =
    selected !== null && selected.audioProbeDone && selected.audioLevels.length > 0 && selected.audioLevels.every(isSilent)
  const probing = reel.clips.some((clip) => !clip.audioProbeDone)
  const cardsOn = branding.introEnabled || branding.outroEnabled

  const estimateSeconds = useMemo(() => {
    if (!canExport) return null
    const plan = buildExportPlan({
      clips: reel.clips.map(toExportClip),
      branding,
      hasMusic: reel.musicFile !== null,
      logo: ESTIMATE_LOGO
    })
    return estimateExportSeconds({
      durationSeconds: planDurationSeconds(plan),
      output: formatOutputSize(branding.exportFormat, reel.clips[0].videoSize),
      hasCards: cardsOn,
      platform
    })
  }, [canExport, reel.clips, reel.musicFile, branding, cardsOn, platform])

  const totalBytes = reel.clips.reduce((sum, clip) => sum + clip.file.size, 0)
  const sizeWarning = selected !== null && !selected.sizeWarningDismissed && checkFileSize(selected.file.size, platform, limits) === 'warn'
  const totalWarning = reel.clips.length > 1 && checkFileSize(totalBytes, platform, limits) === 'warn'
  const countWarning = checkClipCount(reel.clips.length, platform) === 'warn'

  return (
    <main className="app">
      <h1>Astrofrags Web</h1>
      <p className="tagline">Trim a clip, or join several, right in your browser. Nothing is uploaded.</p>

      <div className="toolbar">
        <FilePicker label={hasClips ? 'Add more clips' : 'Pick a video'} disabled={running} onPick={handlePick} />
        {hasClips && (
          <button type="button" data-testid="start-over" onClick={handleStartOver}>
            Start over
          </button>
        )}
      </div>

      {reel.clips.map((clip) => (
        <ClipMetadataProbe
          key={clip.objectUrl}
          objectUrl={clip.objectUrl}
          onMetadata={(metadata) => actions.reportMetadata(clip.id, metadata)}
        />
      ))}

      {selected && sizeWarning && (
        <Notice
          kind="warn"
          actionLabel={platform === 'mobile' ? 'Try anyway' : undefined}
          onAction={() => actions.patch(selected.id, { sizeWarningDismissed: true })}
        >
          {platform === 'mobile'
            ? `This video is ${megabytes(selected.file.size)} MB, which is large for a phone browser and may crash this tab. For long recordings, use the desktop app.`
            : `This video is ${megabytes(selected.file.size)} MB. The web version may be slow or run out of memory on files this big; for long recordings, the desktop app is more reliable.`}
        </Notice>
      )}

      {totalWarning && (
        <Notice kind="warn">
          Together these clips are {megabytes(totalBytes)} MB. Joining that much video in the browser may be slow or
          run out of memory; for a long reel, the desktop app is more reliable.
        </Notice>
      )}

      {countWarning && (
        <Notice kind="warn">
          {reel.clips.length} clips is a lot for {platform === 'mobile' ? 'a phone browser' : 'one browser tab'}. The
          export may be slow or run out of memory; fewer clips are safer.
        </Notice>
      )}

      {probing && <p data-testid="audio-status">Analyzing audio…</p>}

      {allTracksSilent && (
        <Notice kind="warn">
          No sound was detected in this video&apos;s audio, so the exported clip will probably be silent.
        </Notice>
      )}

      {brokenClips.map((clip) => (
        <Notice key={clip.id} kind="error">
          {reel.clips.length > 1 ? `${clip.file.name}: ${UNDECODABLE_MESSAGE}` : UNDECODABLE_MESSAGE}
        </Notice>
      ))}

      {hasClips && (
        <ClipList
          clips={reel.clips}
          selectedId={reel.selectedId}
          locked={running}
          onSelect={actions.select}
          onMove={actions.move}
          onRemove={actions.remove}
        />
      )}

      {selected && (
        <TrimPlayer
          key={selected.objectUrl}
          objectUrl={selected.objectUrl}
          duration={selected.duration}
          range={selected.range}
          locked={running}
          onMetadata={(metadata) => actions.reportMetadata(selected.id, metadata)}
          onRangeChange={(range) => actions.patch(selected.id, { range })}
        />
      )}

      {selected && selected.audioLevels.length > 1 && (
        <AudioTrackPicker
          levels={selected.audioLevels}
          selected={trackOf(selected) ?? 0}
          onSelect={(audioTrackOverride) => actions.patch(selected.id, { audioTrackOverride })}
        />
      )}

      {hasClips && (
        <fieldset className="plain-group" disabled={running}>
          <TransitionOptions
            settings={branding}
            clipCount={reel.clips.length}
            disabled={running}
            onChange={updateBranding}
          />
          <ExportFormatPicker format={branding.exportFormat} onChange={(exportFormat) => updateBranding({ exportFormat })} />
          <BrandingOptions settings={branding} onChange={updateBranding} />
          {cardsOn && <CardPreview style={branding} format={branding.exportFormat} />}
          <MusicPicker musicFile={reel.musicFile} onChange={actions.setMusicFile} />
        </fieldset>
      )}

      {hasClips && estimateSeconds !== null && !running && (
        <p className="hint" data-testid="export-estimate">
          About {estimateSeconds} s
        </p>
      )}

      {hasClips && (
        <ExportBar
          canExport={canExport}
          state={exportState}
          onExport={() => void handleExport()}
          onCancel={() => abortRef.current?.abort()}
          onDeliver={() => void handleDeliverAgain()}
          onTrimAnother={handleStartOver}
        />
      )}
    </main>
  )
}
