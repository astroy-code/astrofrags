# Astrofrags Web (Trim & Export) — Design

## Intent and why

Astrofrags is an Electron desktop app. The owner wants a browser version, hosted on
GitHub Pages, so a short clip can be trimmed and exported from any device — including a
phone — without installing anything. The desktop app remains the tool for long recordings;
the web version is the default for quick jobs, and the user switches to desktop when a
video is too big for the browser.

Everything runs client-side. Nothing is uploaded anywhere (same promise as desktop).

## Goals

- A static site deployed to GitHub Pages from this repo that does exactly one job:
  **pick a video file, choose a start and end, export the trimmed clip.**
- Works in current desktop browsers and on phones (Safari on iOS, Chrome on Android).
  Phone layout is a single stacked column.
- File input is a plain file picker. The usual source is a clip the user saved from the
  Medal app to their phone gallery, or downloaded from medal.tv.
- Export is an H.264/AAC MP4 downloaded to the device (share sheet on mobile where the
  browser supports sharing files).
- Clear, early guidance when a file is too large for the browser to handle reliably:
  tell the user to use the desktop app, rather than hanging or crashing the tab.
- The existing desktop app keeps building, running and releasing exactly as before.

## Non-goals (first version)

> Superseded in part: background music, branding/watermark and intro/outro were added to the web
> version afterwards; see `2026-10-20-web-branding-design.md`.

- Highlight/peak detection, auto-build reel, kill-feed OCR, captions, reels, transitions,
  background music, branding/watermark/intro-outro, export format presets (9:16, 1:1),
  session history, folder watching. (Audio-track selection was a non-goal here until a real
  clip showed the first track can be silent; see the amended audio call below.)
- Any integration with Medal. Medal has no supported public API for reading a user's clips
  (the old clip API's docs site was retired and its repo archived Aug 2026), so the
  pick-a-file flow is the deliberate design, not a stopgap.
- Accounts, backend services, analytics, or any network call carrying user video.
- Offline/PWA install.

## Anti-goals (failure even if it technically works)

- Breaking or changing behavior of the Electron app, its build, or its auto-update path.
- Shipping something that silently uploads video or loads code from a third-party CDN at
  runtime (ffmpeg core files are self-hosted with the site).
- A tab that freezes or crashes on a big file with no explanation.
- Black video preview with no explanation (the desktop app shipped this bug for HEVC
  recordings until v0.1.8; the web version must not repeat it silently).

## Constraints

- GitHub Pages serves static files only and cannot set response headers, so
  cross-origin isolation (SharedArrayBuffer) is unavailable by default. Use the
  single-threaded ffmpeg.wasm core, or add the coi-serviceworker workaround only if
  measurement justifies it.
- Mobile browsers cap per-tab memory (iOS tightest). Export must avoid copying the whole
  input into WASM memory where it can (e.g. mount the picked `File` read-only via the
  worker filesystem and seek with `-ss`).
- The site is served under a repo subpath (`/astrofrags/`), so asset paths must be
  base-relative.
- Repo conventions: TypeScript, React, Vite (via electron-vite today). Immutable
  update patterns, small files, tests for pure logic with Node's built-in test runner
  (`npm test`, see `src/main/__tests__`). No test framework is installed beyond that.
- HEVC: the owner's Medal recordings are HEVC. Desktop Chromium-in-Electron cannot decode
  it; Safari and Chrome with platform decoders often can. Behavior varies by browser.

## Decisions made (by the owner)

- Web version is the default; desktop app is the fallback for long videos.
- Mobile is in scope.
- Pick-a-file flow only; no Medal integration.
- Scope is trim and export only.
- No visual mockups wanted.
- **HEVC the browser can't play gets a clear message, not a workaround.** If the native
  preview can't decode the file (zero video dimensions or a media error after metadata
  loads), show a plain explanation and point to the desktop app. No HEVC decoder in
  ffmpeg.wasm and no preview transcode in the first version; add them later only if the
  owner hits this in practice. Expected to be fine on iPhone Safari and recent Android
  Chrome, which use the device's hardware decoder (not fully confirmed from primary
  sources; the first real Medal clip on a phone is the test).

## Calls made by the author (not yet confirmed by the owner)

- **Separate small web entry, not a port of `App.tsx`.** `App.tsx` is ~1,850 lines and
  calls the Electron bridge (`window.api`) throughout. A new, small web app lives in its
  own directory with its own Vite config, and shares only pure helpers if any.
- **Re-encode on export** (libx264, ultrafast, crf ~23, AAC, yuv420p, `+faststart`) for
  frame-accurate cuts and universally playable output. A "fast, no re-encode" option is
  not in the first version.
- **Preview uses the native `<video>` element** on an object URL, with the undecodable-codec
  message described under the owner's decisions.
- **Size guidance:** warn at a soft limit (starting guess: ~500 MB, to be tuned by testing
  on a real phone) and recommend the desktop app. Do not hard-block desktop browsers.
- **Deploy via GitHub Actions** (`upload-pages-artifact` + `deploy-pages`) on pushes to
  `main` that touch the web app. The owner must set Pages source to "GitHub Actions" in
  repo settings (a manual, one-time step).
- **Audio track (amended 2026-10-20 after a real Medal clip exported silent):** the first
  track can be silent or mic-only, so the export uses the *loudest* audio track, found by
  decoding each track in ffmpeg.wasm and measuring its level (RMS; silent below about -54
  dBFS). Files with several tracks show a dropdown (level meter per track) to override the
  automatic choice; no mixing. Export waits for the analysis so a fast click can't export
  the wrong track. If every track is silent, a warning says the clip will probably be
  silent. The `<video>` preview plays the browser's default track, so a hint notes that it
  may sound different from the export. Replaces the original "first track only, no picker"
  call.
- **Over-limit files are a warning on every device, never a hard block.** On phones the
  wording is stronger and offers "Try anyway", because a wrong block is worse than a
  failed attempt the user can retry on desktop. The size-decision function returns
  `ok | warn`, with the platform passed in so mobile can use a lower threshold.
- **Verification matrix is a record, not a release gate.** Partial results are
  acceptable; whatever was tested (and what failed) is written into the commit/PR
  description. The owner supplies the phones and sample HEVC clips. No export-time pass
  threshold in the first version; measured times are reported instead.
- **Waveform** is optional polish (wavesurfer.js is already a dependency); trimming with
  two time handles over the video is the minimum.

## Left to the builder

Directory layout, UI component structure, exact limits and ffmpeg flags after testing,
ffmpeg.wasm version/core selection (pin an exact version), styling, test cases beyond the
pure-logic ones, and the workflow file details.

## Testing expectations

- Unit tests (Node test runner) for pure logic: trim-range validation, size-limit
  decision, ffmpeg argument construction.
- Manual verification matrix recorded in the PR/commit: desktop Chrome, desktop
  Safari or Firefox, iPhone Safari, Android Chrome — each with one short H.264 clip and one
  HEVC clip.
