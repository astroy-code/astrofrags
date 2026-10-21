import { isSilent, levelToPercent, pickLoudestTrack } from '../lib/audioLevels.ts'
import type { TrackLevel } from '../lib/audioLevels.ts'

interface AudioTrackPickerProps {
  readonly levels: readonly TrackLevel[]
  readonly selected: number
  readonly locked: boolean
  readonly onSelect: (trackIndex: number) => void
}

function optionLabel(level: TrackLevel, index: number, loudest: number): string {
  const detail = isSilent(level) ? 'silent' : `level ${levelToPercent(level)}%`
  return `Track ${index + 1} · ${detail}${index === loudest ? ' · loudest' : ''}`
}

export function AudioTrackPicker({ levels, selected, locked, onSelect }: AudioTrackPickerProps): JSX.Element {
  const loudest = pickLoudestTrack(levels)
  return (
    <div className="audio-track">
      <label>
        Audio track
        <select
          data-testid="audio-track"
          value={selected}
          disabled={locked}
          onChange={(event) => onSelect(Number(event.target.value))}
        >
          {levels.map((level, index) => (
            <option key={index} value={index}>
              {optionLabel(level, index, loudest)}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        The clip is exported with the selected track. The preview above plays the video&apos;s default track, so it
        may sound different.
      </p>
    </div>
  )
}
