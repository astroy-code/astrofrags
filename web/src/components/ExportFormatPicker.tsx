import { EXPORT_FORMATS, EXPORT_FORMAT_LABELS, parseExportFormat } from '../lib/exportFormat.ts'
import type { ExportFormat } from '../lib/exportFormat.ts'

interface ExportFormatPickerProps {
  readonly format: ExportFormat
  readonly onChange: (format: ExportFormat) => void
}

export function ExportFormatPicker({ format, onChange }: ExportFormatPickerProps): JSX.Element {
  return (
    <div className="format-picker">
      <label>
        Export format
        <select
          data-testid="export-format"
          value={format}
          onChange={(event) => onChange(parseExportFormat(event.target.value, format))}
        >
          {EXPORT_FORMATS.map((option) => (
            <option key={option} value={option}>
              {EXPORT_FORMAT_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Vertical and square are sized for Shorts, Reels and TikTok.</p>
    </div>
  )
}
