# Astrofrags

A desktop app that finds the highlight moments in your gameplay recordings and lets you turn them into clips or a combined reel — built for solo/small-scale use, no cloud upload required.

## Download

Grab the latest Windows installer from the [Releases page](https://github.com/astroy-code/astrofrags/releases/latest). The app checks for and installs updates automatically after that.

## Features

- **Highlight detection** — audio energy-peak detection on any gameplay recording, plus an optional visual/OCR detector tuned for Rainbow Six Siege's kill-feed counter (draw a box over it once, it does the rest). Clips can also be added manually by dragging on the waveform, for moments detection misses.
- **Auto-build reel** — one click adds the highest-scoring, non-overlapping detected peaks as clips, in order, instead of adding each one by hand.
- **Clip editor** — waveform view with draggable trim regions, live video preview synced to the waveform, reorderable clip list, per-clip export.
- **Reels** — combine multiple clips into one video, including clips pulled from different source recordings. Optional crossfade/wipe/slide/etc. transitions (adjustable style and duration), background music with automatic ducking and fade in/out under game audio, and captions burned in via a local speech-to-text model (no internet, no API key).
- **Audio track selection** — for capture tools that record game audio, mic, and teammates as separate tracks (e.g. Medal.tv's multi-track mode), pick which one clips use, with a quick preview to tell them apart by ear.
- **Export presets** — export as-is (16:9), reframed for TikTok/Shorts/Reels (9:16, blurred bars or hard-cropped), or square (1:1). A "Fit to 3:00" control automatically shortens an over-long clip selection to fit the Shorts duration cap.
- **Branding** — a permanent watermark, optional lower-third, and optional intro/outro cards with your display name and accent color, plus automatic loudness normalization on every export.
- **Session history** — the app automatically remembers your working sessions (video, clips, order, transitions, music, export format, branding) so you can resume one from a list instead of rebuilding it from scratch.
- **Folder watching** — point it at your capture folder and new recordings show up ready to open.
- **Everything runs locally** — audio/video processing (ffmpeg), speech-to-text (Whisper), and OCR (Tesseract) all run on your machine. Nothing is uploaded anywhere.

## Web version

A browser build for quick jobs: pick a video, set a start and end, export the trimmed clip as an H.264 MP4. It runs entirely in your browser (ffmpeg.wasm), so nothing is uploaded, and it works on phones as well as desktops. Use the desktop app for long recordings and everything else (peak detection, reels, captions, branding, audio-track selection).

- **Large files:** above roughly 500 MB on desktop (200 MB on phones) the page warns that the browser may run out of memory. It never blocks you.
- **HEVC/H.265 recordings:** whether the picture plays depends on your browser and device (Safari and recent Android Chrome use the device's hardware decoder). If it can't decode the video, the page says so and points you to the desktop app.
- **Audio:** the clip keeps the video's first audio track.

```bash
npm run web:dev     # local dev server
npm run web:build   # static site in dist-web/
npm run e2e         # Playwright end-to-end tests (Chromium)
```

It deploys to GitHub Pages from `main` through `.github/workflows/pages.yml`. One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Development

Requires [Node.js](https://nodejs.org/).

```bash
npm install
npm run dev
```

Type-check both processes:

```bash
npm run typecheck
```

Build a Windows installer (`dist/Astrofrags-Setup-<version>.exe`):

```bash
npm run dist
```

## Stack

Electron + React + TypeScript (via `electron-vite`), ffmpeg (`ffmpeg-static`) for all audio/video processing, `wavesurfer.js` for the waveform UI, `@xenova/transformers` (Whisper) for local captioning, `tesseract.js` for OCR-based kill detection, and `electron-updater` for auto-updates via GitHub Releases.

Currently built and tested on Windows only.
