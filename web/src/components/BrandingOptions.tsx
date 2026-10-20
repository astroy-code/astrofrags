import type { BrandingSettings, WatermarkCorner } from '../lib/brandingSettings.ts'

interface BrandingOptionsProps {
  readonly settings: BrandingSettings
  readonly onChange: (patch: Partial<BrandingSettings>) => void
}

const CORNER_LABELS: Record<WatermarkCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right'
}

const CORNERS = Object.keys(CORNER_LABELS) as readonly WatermarkCorner[]
const MAX_NAME_LENGTH = 60
const MAX_LOWER_THIRD_LENGTH = 120

/**
 * Text fields are uncontrolled on purpose: the stored value is trimmed and whitespace-collapsed,
 * which would swallow a space the moment it is typed if the field were bound to it.
 */
export function BrandingOptions({ settings, onChange }: BrandingOptionsProps): JSX.Element {
  return (
    <fieldset className="branding-options">
      <legend>Branding</legend>

      <label>
        Display name
        <input
          type="text"
          data-testid="display-name"
          defaultValue={settings.displayName}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => onChange({ displayName: event.target.value })}
        />
      </label>

      <label>
        Card colour
        <input
          type="color"
          data-testid="accent-color"
          value={settings.accentColor}
          onChange={(event) => onChange({ accentColor: event.target.value })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          data-testid="intro-toggle"
          checked={settings.introEnabled}
          onChange={(event) => onChange({ introEnabled: event.target.checked })}
        />
        Intro card
      </label>

      <label className="check">
        <input
          type="checkbox"
          data-testid="outro-toggle"
          checked={settings.outroEnabled}
          onChange={(event) => onChange({ outroEnabled: event.target.checked })}
        />
        Outro card
      </label>

      <label>
        Card length (seconds)
        <input
          type="number"
          data-testid="card-seconds"
          min={1}
          max={10}
          step={1}
          defaultValue={settings.cardDurationSeconds}
          onChange={(event) => {
            const seconds = event.target.valueAsNumber
            if (Number.isFinite(seconds)) onChange({ cardDurationSeconds: seconds })
          }}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          data-testid="lower-third-toggle"
          checked={settings.lowerThirdEnabled}
          onChange={(event) => onChange({ lowerThirdEnabled: event.target.checked })}
        />
        Lower-third text
      </label>

      <label>
        Lower-third text (blank uses the display name)
        <input
          type="text"
          data-testid="lower-third-text"
          defaultValue={settings.lowerThirdText}
          maxLength={MAX_LOWER_THIRD_LENGTH}
          onChange={(event) => onChange({ lowerThirdText: event.target.value })}
        />
      </label>

      <label>
        Logo corner
        <select
          data-testid="watermark-corner"
          value={settings.watermarkCorner}
          onChange={(event) => onChange({ watermarkCorner: event.target.value as WatermarkCorner })}
        >
          {CORNERS.map((corner) => (
            <option key={corner} value={corner}>
              {CORNER_LABELS[corner]}
            </option>
          ))}
        </select>
      </label>

      <p className="hint" data-testid="watermark-note">
        The Astrofrags logo is always added to the exported video.
      </p>
    </fieldset>
  )
}
