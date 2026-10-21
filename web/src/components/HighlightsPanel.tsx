import { formatTime } from '../lib/formatTime.ts'
import type { Peak } from '../lib/highlights.ts'
import type { ClipItem } from '../lib/reel.ts'

interface HighlightsPanelProps {
  readonly clip: ClipItem
  /** True while the search for this clip is running, with its progress (0..1). */
  readonly searching: boolean
  readonly progress: number
  readonly error: string | null
  /** True while something else (an export, another search) makes the controls unavailable. */
  readonly busy: boolean
  readonly onFind: () => void
  readonly onCancel: () => void
  readonly onAddMoment: (peak: Peak) => void
  readonly onBuild: () => void
}

const PERCENT = 100

/** The loud moments of the selected clip: find them, tap one for a clip, or build a reel from them. */
export function HighlightsPanel({
  clip,
  searching,
  progress,
  error,
  busy,
  onFind,
  onCancel,
  onAddMoment,
  onBuild
}: HighlightsPanelProps): JSX.Element | null {
  if (!clip.audioProbeDone || clip.duration <= 0) return null
  const hasSound = clip.audioTrackCount !== null && clip.audioTrackCount > 0
  const peaks = clip.highlights
  const strongest = peaks ? Math.max(...peaks.map((peak) => peak.score)) : 1

  return (
    <section className="highlights" aria-label="Highlights">
      <h2>Highlights</h2>
      {!hasSound && (
        <p className="hint" data-testid="highlights-status">
          No sound to analyze in this video, so there are no highlights to find.
        </p>
      )}
      {hasSound && !searching && (
        <button type="button" data-testid="find-highlights" disabled={busy} onClick={onFind}>
          {peaks ? 'Find highlights again' : 'Find highlights'}
        </button>
      )}
      {searching && (
        <div>
          <p data-testid="highlights-status">Finding highlights… {Math.round(progress * PERCENT)}%</p>
          <button type="button" data-testid="highlights-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="highlights-error">
          {error}
        </p>
      )}
      {hasSound && !searching && peaks && peaks.length === 0 && (
        <p className="hint" data-testid="highlights-status">
          No standout moments found. Nothing in the sound is much louder than the rest.
        </p>
      )}
      {!searching && peaks && peaks.length > 0 && (
        <>
          <ul className="moments" aria-label="Loud moments">
            {[...peaks]
              .sort((a, b) => a.time - b.time)
              .map((peak) => (
                <li key={peak.time}>
                  <button
                    type="button"
                    className="moment"
                    data-testid="highlight-moment"
                    disabled={busy}
                    onClick={() => onAddMoment(peak)}
                  >
                    <span className="moment-time">{formatTime(peak.time)}</span>
                    <span className="moment-strength" aria-hidden="true">
                      <span style={{ width: `${Math.round((peak.score / strongest) * PERCENT)}%` }} />
                    </span>
                    <span className="moment-add">Add clip</span>
                  </button>
                </li>
              ))}
          </ul>
          <button type="button" className="primary" data-testid="build-from-highlights" disabled={busy} onClick={onBuild}>
            Build reel from highlights
          </button>
        </>
      )}
    </section>
  )
}
