# Web reel (stitching multiple clips) — design

Date: 2026-10-20. Builds on `2026-10-20-web-version-design.md` and `2026-10-20-web-branding-design.md`.

## Intent

The web version trims one clip. The owner's use is joining several Medal game clips (separate
files) into one highlight, as the desktop app's reel does, including its transitions. This adds
that to the web page, working on phones, with nothing uploaded.

## Goals

- Pick several video files and get one exported MP4: the clips in order, each trimmed on its own.
- The same transitions as desktop (`src/main/exportReel.ts`): a hard cut, or a crossfade with the
  same ten styles plus random per cut, one setting for the whole reel.
- Everything already on the web page applies to the whole reel, once: intro/outro cards, music,
  lower-third, watermark, export format, loudness normalisation.
- One clip stays exactly as it is today. A reel of one is the current single-clip flow.

## Non-goals

Captions, peak detection, session history, "mute original audio", choosing a transition per
join, drag-and-drop reordering, several ranges from one file inside one list item (add the file
again instead), a hard limit on clip count.

## Anti-goals

- Making the one-clip flow slower, noisier or different.
- A tab that dies on a phone without warning.
- Silent audio or a wrong picture on one clip because its file differs from the others
  (no audio, other size, other frame rate, other audio-track layout).

## The reel

- A list of items, each `{ file, start, end, audio track }` with its own preview, trim sliders,
  audio-track choice and loudest-track detection (the existing per-file logic, per item).
- The file picker accepts several files at once and also "Add another clip" later. Picking the
  same file twice makes two items. Order is shown top to bottom.
- Up and down buttons reorder; a remove button deletes an item. One item is selected for trimming.
  Editing the list and the trim controls is disabled while an export runs.
- "Pick a different video" is replaced by "Add clips"/"Start over". Starting over clears the reel
  and the music, as "Trim another" does today.

## Transitions (desktop rules)

- Setting: off (hard cut) or on. Style: fade, dissolve, wipeleft, wiperight, slideleft,
  slideright, circleopen, circleclose, pixelize, zoomin, or random. Duration default 0.75 s,
  range 0.1–2 s. Defaults: off, fade, 0.75 s. Stored with the other settings in localStorage.
- Only shown with two or more clips. The effective duration is `min(duration, shortestClip / 2)`.
- Each join is `xfade` (picture) plus `acrossfade` (sound, the same for every style). The running
  length drops by the duration at every join. Random is rolled per join, once, when the export
  starts, so the plan holds explicit styles and the graph is deterministic for a given plan.
- Cards sit outside the transitions: a hard join to the reel, as on desktop.

## Output

- Original format: the size of the first clip, fitted within 1920×1080 with even sides; later
  clips are fitted inside it (scaled to fit, padded). Presets reframe each clip with the desktop
  filter as today. (Desktop letterboxes everything to 1920×1080; same deliberate deviation as before.)
- Every clip is normalised to the frame size, sar 1, yuv420p, 30 fps and timestamps from zero when
  the reel has two or more clips (concat/xfade need identical streams); a single plain clip keeps
  its own frame rate.
- A clip with no audio contributes silence of its own length; a clip whose chosen track index
  does not exist falls back to the first track.
- Music loops and ducks over the whole reel, and its fades and length follow the reel's total
  length. Cards stay silent. The lower-third and watermark are drawn over everything.
- File name: `<first file name>-reel-<N>-clips.mp4`.
- Progress and the time estimate use the reel's total output length.

## Constraints

- One ffmpeg command with all clips as inputs, mounted read-only (no copying into memory), as
  the single clip is today. No intermediate files unless measurement shows the single graph
  cannot hold the clip counts below.
- Soft warnings, never blocks: the existing per-file size warning, plus a combined-size warning
  and a clip-count warning (my guess to tune on devices: phones above 6 clips, desktops above 12).
- Cancel, abort on starting over, stale-result guards and cleanup of every temporary file keep
  working as now.

## Left to the builder

Component structure, the list's exact look, the warning wording, the estimate formula's constants.

## Calls I made (owner to check)

1. Same transition settings as desktop, one for the whole reel (owner confirmed).
2. Original format uses the first clip's size.
3. Clip-count warning thresholds (6 phone / 12 desktop) are guesses.
4. Up/down buttons instead of dragging.
5. Same file twice = two items.

## Success

Three phone clips of different sizes (one with no audio) join with a fade, an intro and outro,
music and a lower-third, in each export format, and play correctly; on the live page a
five-clip reel on the owner's phone finishes without the tab dying.
