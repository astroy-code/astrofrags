# Astrofrags Web — Branding & Music — Design

Extends `2026-10-20-web-version-design.md` (the trim & export web version, live on GitHub
Pages). That document's non-goals "branding/watermark/intro-outro", "background music" are
reversed here, by the owner's request.

## Intent and why

The web version exports a trimmed clip but none of the polish the desktop app adds. The
owner wants the same finishing touches in the browser — intro and outro cards, a
lower-third, a permanent watermark, and optional background music — so a clip made on a
phone looks like one made on the desktop, with no install.

Everything still runs client-side (ffmpeg.wasm). Nothing is uploaded.

## Goals

Match the desktop app's output look and behavior (source of truth: `src/main/branding.ts`,
`src/main/brandingSettings.ts`, `src/main/exportReel.ts` music stages):

- **Intro and outro cards** (each independently on/off): solid accent-color background,
  the bundled Astrofrags logo centered (about 300 px tall at 1080p, nudged up ~80 px) with
  the display name in white (~64 px at 1080p) below it, a 0.5 s fade in and fade out, silent
  audio. One shared duration setting for both cards (default 3 s).
- **Lower-third** (on/off, with text; empty text falls back to the display name, as on
  desktop): white text (~28 px at 1080p) on a 50% black box, bottom-left with ~40 px margins.
  Drawn over the whole output including the cards, and drawn on top of the watermark, exactly
  as on desktop.
- **Permanent watermark:** the bundled Astrofrags logo (~160 px wide at 1080p, ~24 px margin)
  in a corner of every frame of every export, cards included. Not toggleable, same as
  desktop. The corner is selectable (default bottom-right), same as desktop.
- **Optional background music:** the user picks an audio file from their device. It loops to
  cover the clip, is attenuated as a bed, fades in and out at the ends of the clip, and ducks
  under the clip's own audio (sidechain compression), using the desktop's filter settings
  (`src/main/exportReel.ts`, `buildMusicStage`). As on desktop, music is built on the clip
  only: the intro and outro cards stay silent, with no music over them.
- **Loudness normalization** on the final mix, as on desktop (`loudnorm=I=-16:TP=-1.5:LRA=11`).
- **Settings** (display name, accent color, intro/outro on/off, card duration, lower-third
  on/off and text, watermark corner) are remembered in the browser. Defaults match
  `DEFAULT_BRANDING_SETTINGS` on desktop.
- Works on desktop and phone browsers, single stacked column, like the rest of the page.
- Because every export now carries more work, show a rough time estimate and keep the
  existing guidance to use the desktop app for long recordings.

## Non-goals

- Transitions/crossfades between cards and the clip (cards hard-cut in, as on desktop with
  its fade only inside the card), multi-clip reels, captions, export format presets
  (9:16, 1:1), custom logo upload or font choice, a music editor (trim, volume sliders,
  "music replaces clip audio" mode), waveform, peak detection, OCR, folder watching.
- Persisting the music file between visits (the user re-picks it).
- Any server, account, analytics, or network call carrying user content.
- Changing the desktop app.

## Anti-goals (failure even if it technically works)

- Breaking trim-and-export for the plain case, or regressing the behaviors already tested
  (cancel at every stage, pick-new-file aborts, loudest-audio-track selection and picker,
  phone tap-to-save, undecodable-video message, no off-origin requests, subpath hosting).
- A tab that freezes or crashes on a long clip with the added work and no warning.
- Cards or text that look different from desktop in a way the owner would notice (colors,
  placement, fade), or that break on emoji, long names, or non-Latin text.
- Music that overpowers the clip's own audio, or that makes the output longer than the
  clip plus cards.
- The watermark missing from any frame of any export, or hiding the lower-third (the
  lower-third is drawn on top of it; with the watermark in the bottom-left corner they
  overlap exactly as they do on desktop, which is accepted).

## Constraints

- Only the pinned single-threaded ffmpeg.wasm core (`@ffmpeg/core@0.12.10`), self-hosted.
  The filters this needs (overlay, concat or equivalent, color/anullsrc or image inputs,
  scale, fps, fade, format, aloop, afade, sidechaincompress, amix, loudnorm) must be verified
  present in that build before relying on them. If one is missing, report it rather than
  silently dropping the feature.
- Audio track selection stays as built: the export uses the chosen (default loudest) track;
  music ducks under that track.
- Memory on phones: pick music and clip through the same read-only mount used for the clip;
  card and watermark images are small PNGs written to the in-memory filesystem.
- Repo conventions: TypeScript, immutable updates, small files, pure logic unit-tested with
  `npm test`, E2E with Playwright (`npm run e2e`) under the `/astrofrags/` subpath.
- Desktop-parity numbers above are at a 1920x1080 reference; scale them proportionally to
  the actual output resolution.

## Decisions made (by the owner)

- Bring over intro, outro, optional music, and the rest of the desktop branding features.
- Include the permanent watermark.
- Mobile stays in scope; text only, no mockups wanted.

## Calls made by the author (not yet confirmed by the owner)

- **Cards, lower-third and watermark are drawn in the browser with canvas and handed to
  ffmpeg as PNG images**, instead of ffmpeg's text filter. This avoids shipping a font file
  to ffmpeg and supports emoji and any language. For a consistent look across devices, load
  one bundled open-license web font for the canvas (builder's call which; fall back to
  `system-ui`).
- **Output size and frame rate (a deliberate difference from desktop):** keep the clip's own
  aspect ratio and resolution, scaled down to fit within 1920x1080 and never up, with even
  dimensions, and draw the cards at that same size. Desktop instead forces a 1920x1080
  canvas and letterboxes the clip whenever cards are on; that would pillarbox a portrait
  phone clip inside a landscape frame and costs more encode time on a phone. Frame rate
  stays the source's, except when an intro or outro is on, where it is forced to 30 fps for
  splicing (as on desktop).
- **Music is a ducked bed only** (no "replace clip audio" mode).
- **Loudness normalization is always on** (desktop parity), applied to the final mix.
- **Settings live in `localStorage`**, with the usual try/catch fallback to defaults.
- **A small live preview of the intro card** in the options panel, drawn with the same canvas
  code used for export, so the owner sees the card before exporting.
- **Phases, each shippable on its own:** (1) export pipeline refactor, settings panel,
  permanent watermark, intro/outro cards; (2) music; (3) lower-third.
- **Time estimate:** a simple rule of thumb from clip length and resolution, shown before
  export, tuned by measuring on a phone; wording is advisory, never blocking.

## Left to the builder

Filter-graph structure and labels, card/lower-third canvas drawing details beyond the
numbers above, font choice, options-panel layout, estimate formula, how to split the work
into tasks, and which test fixtures to generate.

## Testing expectations

- **The pinned ffmpeg core runs inside Node** (shim `self` and `location`, then call
  `createFFmpegCore({ wasmBinary })`, `setLogger`, `exec`, and the exposed `FS`). Verified:
  every filter this design needs is present, and a tiny encode takes ~70 ms. Use this as a
  test harness so filter graphs are integration-tested against the real core in well under a
  second, instead of through a browser. Playwright stays for the end-to-end page flows.

- Unit tests (Node test runner) for pure logic: filter-graph/argument builders (watermark
  position for each corner, card duration arithmetic, music duck/fade chain, loudnorm
  placement, output-size fitting), settings parse/merge with defaults and corrupt storage,
  estimate function.
- E2E (Playwright, VP9/WebM fixtures): intro+outro output duration equals clip plus two card
  durations; first frame of the intro matches the accent color; music is audible over a clip
  whose audio is silent; a long display name and an emoji name do not break export; watermark
  does not break the plain export; settings persist across reload.
- Manual device matrix on the live URL after each phase (iPhone Safari, Android Chrome),
  recorded rather than gating.
