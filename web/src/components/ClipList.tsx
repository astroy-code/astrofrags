import { formatTime } from '../lib/formatTime.ts'
import type { ClipItem } from '../lib/reel.ts'

interface ClipListProps {
  readonly clips: readonly ClipItem[]
  readonly selectedId: number | null
  /** True while an export runs: the list can't be changed then. */
  readonly locked: boolean
  readonly onSelect: (id: number) => void
  readonly onMove: (id: number, direction: 'up' | 'down') => void
  readonly onRemove: (id: number) => void
}

function lengthText(clip: ClipItem): string {
  const seconds = clip.range.end - clip.range.start
  return seconds > 0 ? formatTime(seconds) : '…'
}

/** The reel, top to bottom: pick a clip to trim it, move it, or take it out. */
export function ClipList({ clips, selectedId, locked, onSelect, onMove, onRemove }: ClipListProps): JSX.Element {
  return (
    <ol className="clip-list" aria-label="Clips in the reel">
      {clips.map((clip, index) => (
        <li
          key={clip.id}
          className={clip.id === selectedId ? 'clip-item is-selected' : 'clip-item'}
          data-testid="clip-item"
        >
          <button
            type="button"
            className="clip-select"
            aria-pressed={clip.id === selectedId}
            disabled={locked}
            onClick={() => onSelect(clip.id)}
          >
            <span className="clip-position">{index + 1}.</span>
            <span className="clip-name">{clip.file.name}</span>
            <span className="clip-length">{lengthText(clip)}</span>
          </button>
          <div className="clip-actions">
            <button
              type="button"
              data-testid="clip-up"
              aria-label={`Move ${clip.file.name} up`}
              disabled={locked || index === 0}
              onClick={() => onMove(clip.id, 'up')}
            >
              ↑
            </button>
            <button
              type="button"
              data-testid="clip-down"
              aria-label={`Move ${clip.file.name} down`}
              disabled={locked || index === clips.length - 1}
              onClick={() => onMove(clip.id, 'down')}
            >
              ↓
            </button>
            <button
              type="button"
              data-testid="clip-remove"
              aria-label={`Remove ${clip.file.name}`}
              disabled={locked}
              onClick={() => onRemove(clip.id)}
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ol>
  )
}
