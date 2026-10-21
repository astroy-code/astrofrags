# Web Waveform: loudness view with trim region and moment markers

Brings the desktop app's waveform editor view to the web page (`web/`). Desktop reference:
the wavesurfer waveform, regions and peak markers in `src/renderer/src/App.tsx`.

## Goal

After **Find highlights**, the selected clip shows a loudness waveform of the whole recording
with its trim region, the loud moments marked on it, and a playhead synced to the video. You can
drag the region's handles, tap a marker to add a clip, tap the waveform to seek, and add a clip
at the playhead. It must be usable with a thumb on a phone.

## Non-goals

Drag-to-create regions on the waveform (it fights scrolling on touch; "Add clip here" replaces
it), a waveform before Find highlights has run (decoding is never automatic), dragging whole
regions, editing several clips' regions at once, captions.

## Behaviour

- **Data.** Find highlights already measures 0.1 s loudness windows over the whole recording; it
  now keeps them on the clip (`loudness`, a `Float32Array`, one value per 0.1 s) next to the
  peaks. Clips made from the recording share the same array. No extra decoding.
- **Where.** A strip directly under the video, shown for the selected clip once it has
  `loudness`. Without it nothing changes from today (sliders only). The sliders stay: they are
  the precise control and the keyboard path.
- **Drawing.** One bar per pixel column, height = the loudest window in that column's time span,
  scaled to the loudest window of the recording, with a small minimum so silence is visible as a
  thin line. The selected clip's trim is a shaded region with a handle at each end. Peak markers
  are vertical lines. The playhead is a line at the video's current time (updated while playing).
- **View.** Starts fitted to the whole recording. Zoom in and out with buttons and by pinch;
  **Fit** returns to the whole recording; **Selection** zooms to the trim region with margin.
  Maximum zoom is 100 px per second; the minimum is the fitted view. Drag on empty waveform to pan
  when zoomed. The view never shows time before 0 or after the end.
- **Touch targets.** A handle can be grabbed within 22 px of its line (44 px wide); a marker can
  be tapped within 22 px. Handles win over markers when both are in reach; the nearer one wins
  otherwise. Buttons are at least 44 px.
- **Gestures.** Pointer down near a handle drags that handle (the range is kept at least 0.5 s
  and inside the recording, via `withStart`/`withEnd`; the video seeks to the handle as the
  sliders do). Pointer down elsewhere that moves more than 6 px pans; one that does not move is a
  tap: on a marker it adds that moment as a clip (as tapping it in the list does), elsewhere it
  seeks the video. Two pointers pinch to zoom around their midpoint.
- **Add clip here** adds a clip from 5 s before to 3 s after the playhead (same padding and the
  same already-added check as a moment).
- **Locked** (export running): handles do not move and taps do nothing; panning and zoom still work.
- Accessible: the canvas has a text label saying what it shows; every action also exists as a
  button or slider.

## Review focus

- Recording shorter than the strip is wide, or very long (4 h): view math and drawing stay
  correct; no canvas wider than the strip; no per-frame heavy work.
- Handle drag past the other handle, past 0 or the end: range stays valid.
- Switching clips: the view resets to fitted for the new clip; a clip without `loudness` shows no strip.
- Zoom around an anchor keeps that time under the finger; pan and zoom never leave `[0, duration]`.
- A tap that drifts a few pixels is still a tap; a drag that starts on a handle never also seeks or pans.
