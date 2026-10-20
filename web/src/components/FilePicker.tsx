interface FilePickerProps {
  readonly onPick: (files: readonly File[]) => void
  readonly label: string
  readonly disabled?: boolean
}

export function FilePicker({ onPick, label, disabled = false }: FilePickerProps): JSX.Element {
  return (
    <label className={disabled ? 'file-picker is-disabled' : 'file-picker'}>
      <span className="button">{label}</span>
      <input
        type="file"
        accept="video/*"
        multiple
        disabled={disabled}
        data-testid="file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onPick(files)
          // Allow picking the same file again after "Start over".
          event.target.value = ''
        }}
      />
    </label>
  )
}
