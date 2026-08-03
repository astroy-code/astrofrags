# Astrofrags

A desktop app that finds the highlight moments in your gameplay recordings and lets you turn them into clips or a combined reel — built for solo/small-scale use, no cloud upload required.

## Download

Grab the latest Windows installer from the [Releases page](https://github.com/astroy-code/astrofrags/releases/latest). The app checks for and installs updates automatically after that.

## Features

- **Highlight detection** — audio energy-peak detection on any gameplay recording, plus an optional visual/OCR detector tuned for Rainbow Six Siege's kill-feed counter (draw a box over it once, it does the rest).
- **Clip editor** — waveform view with draggable trim regions, live video preview synced to the waveform, per-clip export.
- **Reels** — combine multiple clips into one video, including clips pulled from different source recordings. Optional crossfade/wipe/slide/etc. transitions (adjustable style and duration), background music with automatic ducking under game audio, and captions burned in via a local speech-to-text model (no internet, no API key).
- **Export presets** — export as-is (16:9), or reframed for TikTok/Shorts/Reels (9:16) or square (1:1) without cropping any of the footage.
- **Folder watching** — point it at your capture folder and new recordings show up ready to open.
- **Everything runs locally** — audio/video processing (ffmpeg), speech-to-text (Whisper), and OCR (Tesseract) all run on your machine. Nothing is uploaded anywhere.

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
