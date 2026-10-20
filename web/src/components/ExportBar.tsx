import type { DeliveryResult } from '../lib/deliverClip.ts'

export type ExportState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly progress: number }
  | { readonly phase: 'done'; readonly fileName: string; readonly delivery: DeliveryResult | 'pending' }
  | { readonly phase: 'error'; readonly message: string }

interface ExportBarProps {
  readonly canExport: boolean
  readonly state: ExportState
  readonly onExport: () => void
  readonly onCancel: () => void
  readonly onDeliver: () => void
  readonly onTrimAnother: () => void
}

const DELIVERY_TEXT: Record<DeliveryResult | 'pending', string> = {
  pending: 'Ready',
  shared: 'Shared',
  downloaded: 'Saved',
  cancelled: 'Not saved yet'
}

export function ExportBar({
  canExport,
  state,
  onExport,
  onCancel,
  onDeliver,
  onTrimAnother
}: ExportBarProps): JSX.Element {
  if (state.phase === 'running') {
    const percent = Math.round(state.progress * 100)
    return (
      <div className="export-bar">
        <progress max={100} value={percent} />
        <p data-testid="export-status">Exporting… {percent}%</p>
        <button type="button" data-testid="cancel-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="export-bar">
      <button type="button" className="primary" data-testid="export-button" disabled={!canExport} onClick={onExport}>
        Export trimmed clip
      </button>
      {state.phase === 'error' && (
        <p className="error-text" data-testid="export-status" role="alert">
          Export failed: {state.message}
        </p>
      )}
      {state.phase === 'done' && (
        <div data-testid="export-status">
          <p>
            {DELIVERY_TEXT[state.delivery]}: {state.fileName}
          </p>
          {state.delivery === 'pending' ? (
            <button type="button" className="primary" data-testid="deliver-button" onClick={onDeliver}>
              Save or share clip
            </button>
          ) : (
            <button type="button" onClick={onDeliver}>
              Save again
            </button>
          )}{' '}
          <button type="button" onClick={onTrimAnother}>
            Trim another
          </button>
        </div>
      )}
    </div>
  )
}
