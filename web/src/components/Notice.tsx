import type { ReactNode } from 'react'

export type NoticeKind = 'info' | 'warn' | 'error'

interface NoticeProps {
  readonly kind: NoticeKind
  readonly children: ReactNode
  readonly actionLabel?: string
  readonly onAction?: () => void
}

export function Notice({ kind, children, actionLabel, onAction }: NoticeProps): JSX.Element {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid="notice">
      <p>{children}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
