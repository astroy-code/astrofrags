# Web Highlights: Find Highlights and Build Reel

Brings the desktop app's audio-peak highlight detection and "Auto-build reel" to the web page
(`web/`, deployed to GitHub Pages). Desktop source of truth: `src/main/audioAnalysis.ts` and
`autoBuildReel` / `addOrFocusClip` in `src/renderer/src/App.tsx`.

## Goal

Pick a long gameplay recording, press **Find highlights**, and get a list of the loudest moments.
Tap a moment to add it as a clip, or press **Build reel from highlights** to turn the recording
into a reel of the best moments in one step. Everything runs in the browser; nothing is uploaded.

## Non-goals

Waveform view and drag-to-create regions (a separate feature), the visual/OCR kill-feed detector,
automatic detection on load, session history, captions, a hard limit on file length.

## Behaviour

- **Algorithm (same as desktop).** Decode the clip's chosen audio track to mono PCM; RMS per
  0.1 s window; a window is a peak when above `mean + 3 x standard deviation`; peaks within 3 s of
  each other merge, keeping the strongest (time and score of the strongest); keep the 12
  strongest, sorted strongest first. *Ruling: decode at 8 kHz instead of desktop's 16 kHz. Loudness
  peaks are the same and memory halves (about 58 MB per hour of recording).*
- **Find highlights** is a button for the selected clip, enabled once its audio probe is done and
  the clip has an audio track. It is never automatic. While it runs: a progress line, and Cancel
  (same mechanism as export cancel). The result is stored on the clip and survives selecting other
  clips. A clip with no audio, or with no peak, says so in words.
- **The list** shows each moment as `m:ss.s` plus a strength bar (score relative to the strongest),
  in time order, as buttons at least 44 px tall.
- **Tap a moment** adds a clip of the same file from `time - 5 s` to `time + 3 s`, clamped to the
  recording, placed right after the recording's clip, selected. The recording clip stays. A moment
  whose padded range overlaps a clip of the same file already in the reel selects that clip
  instead of adding a duplicate.
- **Build reel from highlights** takes the highest-scoring moments whose padded ranges do not
  overlap each other or any *other* clip of the same file in the reel, at most 8, orders them by
  time, and **replaces the recording's clip** with them at its position. (Desktop starts from the
  loaded video as a source, not a clip, so the recording's clip is the equivalent.) If the export
  format is vertical or vertical-crop and the reel is then over 3:00, every clip is fitted
  exactly as the **Fit to 3:00** button would.
- New clips share the recording's `File` (nothing is copied), get their own preview URL, and start
  with the recording's duration, size and audio facts so they are exportable at once. Each keeps
  its own trim and audio-track choice. Highlights are kept only on the recording's clip.
- Pressing **Start over**, removing the clip, or starting an export while detection runs cancels
  the detection; a late result for a removed clip is dropped.

## Constraints

Web version rules still apply: no network, immutable state updates, small files, soft warnings
only. Detection uses the shared ffmpeg instance through `runExclusive`, so it queues behind a
probe or export.

## Review focus (inputs the tests must exercise)

- A recording with no audio track, or one fully silent: clear message, no crash, no clips.
- A recording shorter than one window, or with fewer than a few windows (std dev 0): no peaks,
  not an error.
- Many peaks within a few seconds: merged as desktop does; Build never picks overlapping ranges.
- Peak at the very start or end: padded range clamped to `[0, duration]`.
- Cancel mid-detection, Start over mid-detection, removing the clip mid-detection.
- Build when the reel already holds other clips from the same file.
- A very long recording: decode failure shows an error, not a frozen page.
