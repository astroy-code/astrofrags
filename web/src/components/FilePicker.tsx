interface FilePickerProps {
  readonly onPick: (file: File) => void
  readonly label: string
}

export function FilePicker({ onPick, label }: FilePickerProps): JSX.Element {
  return (
    <label className="file-picker">
      <span className="button">{label}</span>
      <input
        type="file"
        accept="video/*"
        data-testid="file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onPick(file)
          // Allow picking the same file again after "Trim another".
          event.target.value = ''
        }}
      />
    </label>
  )
}
