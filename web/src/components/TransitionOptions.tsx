import type { BrandingSettings } from '../lib/brandingSettings.ts'
import {
  MAX_TRANSITION_SECONDS,
  MIN_TRANSITION_SECONDS,
  TRANSITION_LABELS,
  TRANSITION_STYLES,
  parseTransitionStyle
} from '../lib/transitions.ts'

interface TransitionOptionsProps {
  readonly settings: BrandingSettings
  readonly clipCount: number
  readonly disabled: boolean
  readonly onChange: (patch: Partial<BrandingSettings>) => void
}

const SECONDS_STEP = 0.05

/** How the clips are joined. Only meaningful with two or more clips, so it hides itself otherwise. */
export function TransitionOptions({
  settings,
  clipCount,
  disabled,
  onChange
}: TransitionOptionsProps): JSX.Element | null {
  if (clipCount < 2) return null
  const off = disabled || !settings.transitionsEnabled
  return (
    <fieldset className="transition-options" disabled={disabled}>
      <legend>Between clips</legend>

      <label className="check">
        <input
          type="checkbox"
          data-testid="transitions-toggle"
          checked={settings.transitionsEnabled}
          onChange={(event) => onChange({ transitionsEnabled: event.target.checked })}
        />
        Crossfade between clips (otherwise a hard cut)
      </label>

      <label>
        Style
        <select
          data-testid="transition-style"
          value={settings.transitionStyle}
          disabled={off}
          onChange={(event) =>
            onChange({ transitionStyle: parseTransitionStyle(event.target.value, settings.transitionStyle) })
          }
        >
          {TRANSITION_STYLES.map((style) => (
            <option key={style} value={style}>
              {TRANSITION_LABELS[style]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Length (seconds)
        <input
          type="number"
          data-testid="transition-seconds"
          min={MIN_TRANSITION_SECONDS}
          max={MAX_TRANSITION_SECONDS}
          step={SECONDS_STEP}
          defaultValue={settings.transitionSeconds}
          disabled={off}
          onChange={(event) => {
            const seconds = event.target.valueAsNumber
            if (Number.isFinite(seconds)) onChange({ transitionSeconds: seconds })
          }}
        />
      </label>
      <p className="hint">A transition is never longer than half of the shortest clip.</p>
    </fieldset>
  )
}
