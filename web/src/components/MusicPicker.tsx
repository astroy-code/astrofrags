import { useState } from 'react'
import { countAudioStreamsOfFile } from '../lib/exportClip.ts'

interface MusicPickerProps {
  readonly musicFile: File | null
  readonly onChange: (file: File | null) => void
}

const NOT_AUDIO_MESSAGE = 'That file has no audio in it, so it can’t be used as music. Pick an audio file.'
const UNREADABLE_MESSAGE = 'That file could not be read as music. Try a different file.'

export function MusicPicker({ musicFile, onChange }: MusicPickerProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const handlePick = async (file: File): Promise<void> => {
    setError(null)
    setChecking(true)
    try {
      if ((await countAudioStreamsOfFile(file)) === 0) {
        setError(NOT_AUDIO_MESSAGE)
        return
      }
      onChange(file)
    } catch {
      setError(UNREADABLE_MESSAGE)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="music-picker">
      <label>
        Background music (optional)
        <input
          type="file"
          accept="audio/*"
          data-testid="music-input"
          disabled={checking}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handlePick(file)
            // Allow picking the same file again after clearing it.
            event.target.value = ''
          }}
        />
      </label>
      {checking && <p className="hint">Checking the file…</p>}
      {musicFile && (
        <p data-testid="music-name">
          {musicFile.name}{' '}
          <button
            type="button"
            data-testid="music-clear"
            onClick={() => {
              setError(null)
              onChange(null)
            }}
          >
            Remove
          </button>
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="music-error">
          {error}
        </p>
      )}
    </div>
  )
}
