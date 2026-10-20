# Astrofrags Web Branding & Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the desktop app's intro/outro cards, lower-third, permanent watermark, optional music and loudness normalization to the browser trim-and-export page.

**Architecture:** One pure function, `buildExportArgs`, turns an `ExportPlan` into a single ffmpeg `filter_complex` command (clip → optional music → optional cards via concat → watermark → lower-third, with loudnorm on the final audio). Cards and the lower-third are drawn with canvas in the browser and handed to ffmpeg as PNGs. The graph is tested by running the real pinned `@ffmpeg/core` inside Node (fast), and the page flows by Playwright.

**Tech Stack:** TypeScript, React 18, Vite 5, `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/core@0.12.10`, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-web-branding-design.md` (extends `2026-10-20-web-version-design.md`). Desktop source of truth for numbers: `src/main/branding.ts`, `src/main/brandingSettings.ts`, `src/main/exportReel.ts`.

## Global Constraints

- Do not edit `src/**` or `electron.vite.config.ts` (desktop app untouched).
- Only the pinned single-threaded core, self-hosted; no third-party runtime loads; no uploads. The existing E2E test asserting zero off-origin requests must keep passing.
- Reference numbers are at 1920x1080 and scale by `layoutScale(size) = min(width, height) / 1080`: card logo 300 px tall, nudged up 80 px; card name 64 px, white, centered, centre 120 px below the card centre; card fade in and out 0.5 s; watermark logo 160 px wide, 24 px margin; lower-third text 28 px white on `rgba(0,0,0,0.5)`, 12 px padding, 40 px left/bottom margin.
- Defaults equal desktop's: display name `Astroy`, accent `#1a1a2e`, intro and outro off, card duration 3 s, lower-third off with empty text, watermark corner `bottom-right`. Watermark is always on. Empty lower-third text falls back to the display name.
- Music (desktop `buildMusicStage`): `aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=2e9,atrim=0:<clipDuration>,asetpts=PTS-STARTPTS,volume=0.35,afade in/out`, fade = `min(2, clipDuration/2)`, ducked by `sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300`, mixed with `amix=inputs=2:duration=first`. Music covers the clip only; cards are silent and have no music.
- Loudness: `loudnorm=I=-16:TP=-1.5:LRA=11` on the final mix, always.
- Output size: the clip's aspect ratio, scaled down to fit within 1920x1080, never up, dimensions rounded down to even. Frame rate stays the source's, except forced to 30 fps when an intro or outro is on.
- Watermark and lower-third are drawn over the whole output including cards; the lower-third is drawn on top of the watermark.
- Export encoding stays libx264 ultrafast, crf 23, yuv420p, AAC, `+faststart`.
- Audio track choice (loudest by default, picker override) is unchanged; music ducks under the chosen track. A clip with no audio gets generated silent audio so the graph stays uniform.
- Existing behaviors must not regress: cancel at every stage, picking a new file aborts a running export, phone tap-to-save, undecodable-video message, subpath hosting.
- Repo conventions: TypeScript, immutable updates, small files (<800 lines), no `console.log`, pure logic unit-tested with `node --test` and imports using explicit `.ts` extensions, `import type` for types, no enums or parameter properties in files the tests import. Commits `<type>: <description>` ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Non-goals: transitions between cards and clip, multi-clip reels, captions, format presets, custom logo/font, music editor or "replace clip audio" mode, persisting the music file, changing the desktop app.

## Review Focus

Failure modes the spec implies but no explicit requirement tests; each is pinned by a test in the task named.

1. **A clip with no audio** combined with music, cards and watermark must export (Tasks 4, 6).
2. **Odd, huge or portrait source sizes** (321x181, 3840x2160, 1080x1920) must produce even dimensions that fit within 1920x1080 with no upscale, and still export (Tasks 3, 4).
3. **A clip shorter than the music fade or the card fade** (0.5 s clip): fade clamps, no negative times, output length is still clip (+ cards) (Task 6).
4. **Corrupt or stale `localStorage` and hostile strings** (invalid JSON, wrong types, newlines, 10,000-character names): fall back per field, clamp length, no crash (Task 2).
5. **A music file that is not audio** (an image renamed `.mp3`) must give a clear message when picked, not a hung or failed export (Task 9).

---

## File Structure

```
web/src/
  lib/
    brandingSettings.ts    types, defaults, parse/serialize, storage key
    outputGeometry.ts      fitWithin, layoutScale
    overlayLayout.ts       watermarkRect, lowerThirdLayout, cardLayout, CARD_FADE_SECONDS
    musicFade.ts           musicFadeSeconds
    exportGraph.ts         ExportPlan, buildExportArgs, planDurationSeconds
    progress.ts            progressRatio
    estimate.ts            estimateExportSeconds
    cardImages.ts          canvas drawing -> PNG bytes; logo loader   (browser only)
    exportClip.ts          (modify) use buildExportArgs, mount music, write PNGs
    ffmpegArgs.ts          (modify) remove buildTrimArgs, keep buildLevelProbeArgs
  useBrandingSettings.ts   hook over localStorage
  components/
    BrandingOptions.tsx    name, colour, intro/outro, duration, lower-third, corner
    MusicPicker.tsx        audio file input with validation
    CardPreview.tsx        live canvas preview of the intro card
  lib/__tests__/
    support/ffmpegCore.ts  Node harness around the real core   (not matched by npm test)
    *.test.ts
web/public/astrofrags-logo.png   copy of assets/astrofrags-logo.png (512x512 RGBA)
web/e2e/                 (modify) fixtures + new tests
```

---

### Task 1: Node test harness for the real ffmpeg core

**Files:**
- Create: `web/src/lib/__tests__/support/ffmpegCore.ts`, `web/src/lib/__tests__/ffmpegCore.test.ts`

**Interfaces:**
- Produces (all in `support/ffmpegCore.ts`):
  - `interface MediaInfo { durationSeconds: number; width: number; height: number; fps: number; hasVideo: boolean; audioStreams: number }`
  - `interface CoreRun { exitCode: number; log: string; read(path: string): Uint8Array }`
  - `runCore(args: string[], files?: Readonly<Record<string, Uint8Array>>): Promise<CoreRun>`: a fresh core instance per call (isolated MEMFS), files written first, `args` passed to `exec` after the default `-y`.
  - `parseMediaInfo(ffmpegLog: string): MediaInfo`
  - `probeBytes(bytes: Uint8Array, name?: string): Promise<MediaInfo>`
  - `meanVolumeDb(bytes: Uint8Array, name?: string, window?: { start: number; duration: number }): Promise<number>` (`-Infinity` for digital silence)
  - `pixelAt(bytes: Uint8Array, name: string, x: number, y: number, atSeconds: number): Promise<{ r: number; g: number; b: number }>`
  - `makeFixture(kind: 'video' | 'videoNoAudio' | 'twoTrack' | 'tone' | 'png', opts?: ...): Promise<Uint8Array>`: tiny synthetic inputs generated with the core itself (320x180, 30 fps, 2 s unless stated; `twoTrack` = silent first audio track, 440 Hz second; `tone` = 330 Hz audio-only; `png` = solid colour image of a given size).
  - The shim before importing the core: `globalThis.self = globalThis` and `globalThis.location = { href: <file URL of the core dir> }`; load `node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm}`; use `core.setLogger`, `core.exec`, `core.FS`.

- [ ] **Step 1: Write the failing test** `ffmpegCore.test.ts`: `harness encodes and probes a synthetic clip` (`makeFixture('video')` probes as 320x180, 2 s ±0.15, `hasVideo`, 1 audio stream); `harness reports digital silence as -Infinity` (`makeFixture('videoNoAudio')` plus generated silence); `pixelAt reads the colour of a solid image` (`makeFixture('png', { color: '#ff0000', width: 8, height: 8 })` → r>240, g<20, b<20); `parseMediaInfo reads duration, size, fps and audio stream count from a log` (a literal ffmpeg `-i` listing in the test).
- [ ] **Step 2: Run** `npm test`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the harness. Reuse the approach proven in `/private/tmp/.../scratchpad/core-check/smoke.mjs` (shim, `createCore({ wasmBinary })`, `setLogger`, `exec`, `FS`).
- [ ] **Step 4: Run** `npm test`; expect all pass, and the whole suite stays under ~15 s.
- [ ] **Step 5: Commit** `test: add Node harness for the real ffmpeg core`.

### Task 2: Branding settings

**Files:**
- Create: `web/src/lib/brandingSettings.ts`, `web/src/useBrandingSettings.ts`
- Test: `web/src/lib/__tests__/brandingSettings.test.ts`

**Interfaces:**
- Produces:
  - `type WatermarkCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`
  - `interface BrandingSettings { readonly displayName: string; readonly accentColor: string; readonly introEnabled: boolean; readonly outroEnabled: boolean; readonly cardDurationSeconds: number; readonly lowerThirdEnabled: boolean; readonly lowerThirdText: string; readonly watermarkCorner: WatermarkCorner }`
  - `DEFAULT_BRANDING_SETTINGS: BrandingSettings` (values in Global Constraints); `BRANDING_STORAGE_KEY = 'astrofrags.branding.v1'`
  - `parseBrandingSettings(raw: string | null): BrandingSettings` (never throws; validates each field separately and falls back to that field's default)
  - `serializeBrandingSettings(settings: BrandingSettings): string`
  - `lowerThirdLabel(settings: BrandingSettings): string` (text, falling back to display name)
  - `useBrandingSettings(): readonly [BrandingSettings, (patch: Partial<BrandingSettings>) => void]`: reads storage once, writes on change, every storage access inside try/catch so a blocked storage still works in memory.

- [ ] **Step 1: Write failing tests:** `null and empty strings give defaults`; `valid stored settings round-trip through serialize and parse`; `corrupt JSON gives defaults` (Review Focus 4: `'{not json'`, `'null'`, `'[]'`, `'42'`); `each invalid field falls back alone` (wrong types for every field one at a time, other fields keep their stored values); `accent colour must be #rrggbb` (rejects `red`, `#fff`, `#gggggg`); `card duration is clamped to 1..10 and non-numbers fall back`; `corner must be one of the four`; `strings are trimmed, newlines collapse to spaces, and length is capped (name 60, lower-third 120)` (10,000-character input); `unknown keys are dropped`; `lowerThirdLabel falls back to the display name when text is empty`.
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** `brandingSettings.ts` (pure) and the hook.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add branding settings with safe parsing`.

### Task 3: Output geometry and overlay layout numbers

**Files:**
- Create: `web/src/lib/outputGeometry.ts`, `web/src/lib/overlayLayout.ts`, `web/src/lib/musicFade.ts`
- Test: `web/src/lib/__tests__/outputGeometry.test.ts`, `overlayLayout.test.ts`, `musicFade.test.ts`

**Interfaces:**
- Produces:
  - `interface Size { readonly width: number; readonly height: number }`, `interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }`
  - `MAX_OUTPUT: Size = { width: 1920, height: 1080 }`
  - `fitWithin(source: Size, max?: Size): Size` (preserve aspect, never upscale, each dimension rounded down to even, minimum 2)
  - `layoutScale(size: Size): number` = `min(width, height) / 1080`
  - `CARD_FADE_SECONDS = 0.5`
  - `watermarkRect(corner: WatermarkCorner, canvas: Size, logo: Size): Rect`
  - `lowerThirdLayout(canvas: Size): { fontSize: number; marginLeft: number; marginBottom: number; padding: number; boxColor: string; fontColor: string }`
  - `cardLayout(canvas: Size, logo: Size): { logo: Rect; nameFontSize: number; nameCenterX: number; nameCenterY: number }`
  - `musicFadeSeconds(clipDurationSeconds: number): number` = `min(2, duration / 2)`, never negative.
  - All layout values rounded to integers.

- [ ] **Step 1: Write failing tests.** `fitWithin`: `3840x2160 -> 1920x1080`, `1280x720 stays` (never up), `321x181 -> 320x180` (even), `1080x1920 -> 606x1080` (Review Focus 2), `1x1 -> 2x2`. `layoutScale`: `1920x1080 -> 1`, `1280x720 -> 0.667`, `606x1080 -> 0.561`. `watermarkRect` at 1920x1080 with a 512x512 logo: bottom-right `{x:1736,y:896,width:160,height:160}`, top-left `{x:24,y:24,...}`, top-right `x:1736,y:24`, bottom-left `x:24,y:896`; at 1280x720 the width is 107 and margin 16. `cardLayout` at 1920x1080 with a 512x512 logo: logo `{x:810,y:310,width:300,height:300}`, `nameFontSize 64`, `nameCenterX 960`, `nameCenterY 660`. `lowerThirdLayout` at 1080p: `fontSize 28, marginLeft 40, marginBottom 40, padding 12`. `musicFadeSeconds`: `60 -> 2`, `3 -> 1.5`, `0.5 -> 0.25`, `0 -> 0`, `-5 -> 0`.
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add output geometry and overlay layout`.

### Task 4: Export graph — clip, watermark, loudness (phase 1a)

**Files:**
- Create: `web/src/lib/exportGraph.ts`
- Test: `web/src/lib/__tests__/exportGraph.test.ts` (string-level) and `exportGraph.core.test.ts` (runs the real core)

**Interfaces:**
- Consumes: `Size`, `Rect`, `watermarkRect`, `CARD_FADE_SECONDS`, `musicFadeSeconds` (Task 3); `WatermarkCorner` (Task 2); harness (Task 1).
- Produces:
  - `interface ExportPlan { readonly clip: { start: number; end: number; audioTrackIndex: number | null }; readonly output: Size; readonly logo: Size; readonly watermarkCorner: WatermarkCorner; readonly intro: boolean; readonly outro: boolean; readonly cardSeconds: number; readonly music: boolean; readonly lowerThird: boolean }` (`audioTrackIndex: null` means the clip has no audio)
  - `interface ExportInputs { readonly video: string; readonly logo: string; readonly introCard?: string; readonly outroCard?: string; readonly lowerThird?: string; readonly music?: string }` (file paths in the ffmpeg filesystem)
  - `buildExportArgs(plan: ExportPlan, inputs: ExportInputs, outputPath: string): string[]`
  - `planDurationSeconds(plan: ExportPlan): number` = clip length + (intro ? cardSeconds : 0) + (outro ? cardSeconds : 0)
- Behavior fixed by the plan: input 0 is `-ss <start> -t <length> -i <video>`; video chain `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,setsar=1` (plus `fps=30` only when a card is on); audio chain `[0:a:N]aformat=sample_rates=48000:channel_layouts=stereo`, or `anullsrc=r=48000:cl=stereo` trimmed to the clip length when `audioTrackIndex` is null; the logo is `-loop 1 -t <planDuration> -i <logo>`, scaled to the `watermarkRect` width and overlaid at its x/y with `shortest=1`; `loudnorm` is the last audio filter; final `-map` the video and audio labels with the Global Constraints encode settings. This task only needs to make the cards, music and lower-third flags inert (they are added in Tasks 5-7 against the same signature).

- [ ] **Step 1: Write failing tests.** String-level: `uses a filter_complex and maps its labels`; `places the clip with input-side -ss and -t`; `output encode settings are libx264 ultrafast crf 23 yuv420p aac faststart`; `loudnorm is the final audio filter`; `planDurationSeconds adds two card durations only when both cards are on`; `does not mutate the plan`. Real-core (`exportGraph.core.test.ts`, each using `runCore`): `exports a 1 s trim of a 2 s clip` (output 1 s ±0.15, one video and one audio stream); `exports a clip with no audio as silent audio` (Review Focus 1: `audioTrackIndex: null` on a `videoNoAudio` fixture → output has 1 audio stream); `uses the requested audio track` (`twoTrack` fixture: index 1 → mean volume > -40 dB, index 0 → < -80 dB); `fits an odd-sized source to even dimensions` (Review Focus 2: a 321x181 source with `output: fitWithin(...)` exports at 320x180); `draws the watermark in the chosen corner` (a solid-red 64x64 logo PNG: pixel at the `watermarkRect` centre is red; the pixel at the opposite corner is not).
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** `exportGraph.ts` per the behavior above.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add export graph with watermark and loudness`.

### Task 5: Export graph — intro and outro cards (phase 1b)

**Files:**
- Modify: `web/src/lib/exportGraph.ts`
- Test: `web/src/lib/__tests__/exportGraph.core.test.ts`

**Interfaces:**
- Consumes: `ExportPlan.intro/outro/cardSeconds`, `ExportInputs.introCard/outroCard` (Task 4), `CARD_FADE_SECONDS`.
- Produces: `buildExportArgs` honouring the card flags. Fixed behavior: a card input is `-loop 1 -framerate 30 -t <cardSeconds> -i <card.png>`; its video is faded in over `CARD_FADE_SECONDS` and out ending at the card end, scaled/padded to the output size, `setsar=1`, `fps=30`; its audio is `anullsrc=r=48000:cl=stereo` trimmed to `cardSeconds`; segments are joined with `concat=n=<2|3>:v=1:a=1` (intro, main, outro) after the main segment is normalised to `fps=30` and stereo 48 kHz; the watermark overlay runs on the concat result so it covers the cards.

- [ ] **Step 1: Write failing real-core tests:** `intro and outro add exactly two card durations` (3 s cards, 1 s clip → 7 s ±0.2); `intro only adds one card` ; `the card shows its accent colour once faded in` (solid `#1a1a2e` card PNG; pixel near the corner at `cardSeconds / 2` is that colour ±3); `the clip follows the intro` (pixel at `cardSeconds + 0.2` is not the card colour); `forces 30 fps when a card is on and keeps source fps otherwise` (parse fps from the output); `watermark covers the cards too` (red logo pixel visible at `cardSeconds / 2`).
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** card segments and concat in `buildExportArgs`.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add intro and outro cards to the export graph`.

### Task 6: Export graph — music (phase 2)

**Files:**
- Modify: `web/src/lib/exportGraph.ts`
- Test: `web/src/lib/__tests__/exportGraph.core.test.ts`

**Interfaces:**
- Consumes: `ExportPlan.music`, `ExportInputs.music`, `musicFadeSeconds` (Task 3).
- Produces: `buildExportArgs` honouring `music`. Fixed behavior: the music input is a plain `-i <music>`; the music stage uses the exact desktop filters from Global Constraints with `clipDuration = clip.end - clip.start` and sits on the clip audio before the cards are concatenated, so cards stay silent.

- [ ] **Step 1: Write failing real-core tests:** `music is audible over a clip with no audio` (Review Focus 1: `videoNoAudio` clip + `tone` music → mean volume > -40 dB); `music never lengthens the output` (output stays clip length ±0.15 for a 1 s clip and a 3 s music file; also a 0.5 s clip with 2 s fades: Review Focus 3, exit code 0, output ≈ 0.5 s); `music loops when shorter than the clip` (2 s clip, 0.5 s music → mean volume still > -40 dB in the last second); `cards stay silent` (intro on: mean volume of the first card window < -60 dB, of the clip window > -40 dB); `music ducks under loud clip audio` (loud clip + music: mean volume with music is within 3 dB of without, i.e. the bed does not add much).
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** the music stage.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add background music to the export graph`.

### Task 7: Export graph — lower-third (phase 3)

**Files:**
- Modify: `web/src/lib/exportGraph.ts`
- Test: `web/src/lib/__tests__/exportGraph.core.test.ts`

**Interfaces:**
- Consumes: `ExportPlan.lowerThird`, `ExportInputs.lowerThird` (a full-canvas transparent PNG at the output size, drawn by Task 8).
- Produces: `buildExportArgs` honouring `lowerThird`. Fixed behavior: input `-loop 1 -t <planDuration> -i <png>`, overlaid at `0:0` with `shortest=1` as the last video stage, after the watermark.

- [ ] **Step 1: Write failing real-core tests:** `lower-third shows over the clip` (a transparent PNG with an opaque blue box at the bottom-left: pixel in the box is blue at a time inside the clip); `lower-third also shows over the cards`; `lower-third sits on top of the watermark` (watermark bottom-left, box overlapping it: the overlap pixel is the box colour, not the logo colour).
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** the overlay stage.
- [ ] **Step 4: Run** `npm test`; expect pass.
- [ ] **Step 5: Commit** `feat: add lower-third to the export graph`.

### Task 8: Canvas images, logo asset and runtime wiring

**Files:**
- Create: `web/src/lib/cardImages.ts`, `web/src/lib/progress.ts`, `web/public/astrofrags-logo.png` (copy of `assets/astrofrags-logo.png`)
- Modify: `web/src/lib/exportClip.ts`, `web/src/lib/ffmpegArgs.ts` (remove `buildTrimArgs`), `web/src/lib/__tests__/ffmpegArgs.test.ts` (drop the `buildTrimArgs` tests, keep `buildLevelProbeArgs`), `web/src/App.tsx` (pass the new request fields)
- Test: `web/src/lib/__tests__/progress.test.ts`

**Interfaces:**
- Consumes: `buildExportArgs`, `ExportPlan`, `ExportInputs`, `planDurationSeconds` (Tasks 4-7); `cardLayout`, `lowerThirdLayout`, `layoutScale`, `fitWithin` (Task 3); `BrandingSettings`, `lowerThirdLabel` (Task 2).
- Produces:
  - `progressRatio(outputTimeMicroseconds: number, planSeconds: number): number` (clamped 0..1, 0 for non-positive plan)
  - `interface Logo { readonly bytes: Uint8Array; readonly image: ImageBitmap; readonly size: Size }`; `loadLogo(): Promise<Logo>` (fetches `new URL('astrofrags-logo.png', document.baseURI)`, caches the promise)
  - `drawCard(ctx: CanvasRenderingContext2D, settings: BrandingSettings, canvas: Size, logo: Logo): void` (shared by export and the preview)
  - `renderCardPng(settings: BrandingSettings, canvas: Size, logo: Logo): Promise<Uint8Array>`
  - `renderLowerThirdPng(text: string, canvas: Size): Promise<Uint8Array>` (transparent background, box and text per `lowerThirdLayout`, text truncated with an ellipsis to fit the width)
  - `ExportRequest` gains `readonly branding: BrandingSettings`, `readonly musicFile: File | null`, `readonly sourceSize: Size`; `exportTrimmedClip` builds the plan, writes the PNGs and logo to the ffmpeg filesystem, mounts the music file read-only like the clip, calls `buildExportArgs`, reports progress with `progressRatio(event.time, planDurationSeconds(plan))`, and removes every temporary file in `finally`.

- [ ] **Step 1: Write failing test** `progress.test.ts`: `converts output time in microseconds to a ratio` (`progressRatio(1_500_000, 3) === 0.5`); `clamps to 0..1` (negative, above plan); `a non-positive plan gives 0`; `NaN gives 0`.
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** `progress.ts`. In `cardImages.ts` use `system-ui, sans-serif` bold for text (no font bundling: author's call), await `document.fonts.ready` before drawing, and draw only what `cardLayout`/`lowerThirdLayout` specify. Verify once, using the Task 1 harness with `core.setProgress`, that the progress event's `time` is output time in microseconds and note the finding in the commit message. Rewire `exportClip.ts`; delete `buildTrimArgs` and its tests.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`; expect pass. Run `npm run e2e`; existing tests still pass (the export now carries a watermark and loudnorm).
- [ ] **Step 5: Commit** `feat: render cards and overlays in the browser and wire the new export`.

### Task 9: Options panel, music picker, preview and estimate

**Files:**
- Create: `web/src/components/BrandingOptions.tsx`, `MusicPicker.tsx`, `CardPreview.tsx`, `web/src/lib/estimate.ts`
- Modify: `web/src/App.tsx`, `web/src/styles.css`, `web/src/lib/exportClip.ts` (export `countAudioStreamsOfFile(file: File): Promise<number>` using the existing probe helpers)
- Test: `web/src/lib/__tests__/estimate.test.ts`

**Interfaces:**
- Consumes: `useBrandingSettings`, `BrandingSettings` (Task 2); `drawCard`, `loadLogo` (Task 8); `planDurationSeconds`, `fitWithin` (Tasks 3-4); `Platform` (`sizeLimit.ts`).
- Produces:
  - `estimateExportSeconds(input: { durationSeconds: number; output: Size; hasCards: boolean; platform: Platform }): number`: rule of thumb, monotonic in duration and pixel count, with a phone multiplier and a card surcharge; rounded up to whole seconds, minimum 1.
  - Test ids: `display-name`, `accent-color`, `intro-toggle`, `outro-toggle`, `card-seconds`, `lower-third-toggle`, `lower-third-text`, `watermark-corner`, `music-input`, `music-clear`, `music-error`, `card-preview`, `export-estimate`.
  - `App` holds `musicFile: File | null` in the session (replaced immutably, cleared by "Trim another"), shows an info line near the options that the watermark is always on, passes `branding`, `musicFile` and the video's `videoWidth/videoHeight` as `sourceSize` into the export request, and shows `export-estimate` text such as "About 40 s" before the export button.
  - `MusicPicker` rejects a file with no audio stream (via `countAudioStreamsOfFile`) with a `music-error` message and does not set it.

- [ ] **Step 1: Write failing tests** `estimate.test.ts`: `longer clips take longer`; `bigger output takes longer`; `cards add time`; `phones take longer than desktops`; `never below 1 second and always a whole number`.
- [ ] **Step 2: Run** `npm test`; expect FAIL.
- [ ] **Step 3: Implement** `estimate.ts`, then the three components and the App wiring. The card preview redraws on every settings change with `drawCard` at a fixed small canvas size.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`; expect pass.
- [ ] **Step 5: Commit** `feat: add branding options, music picker, preview and estimate`.

### Task 10: End-to-end tests, fixtures and docs

**Files:**
- Modify: `web/e2e/fixtures/make-fixtures.mjs`, `web/e2e/fixtures/names.json`, `web/e2e/trim-export.spec.ts`, `README.md`, `docs/superpowers/specs/2026-10-20-web-version-design.md` (note the superseded non-goals in one line)

**Interfaces:**
- Consumes: every test id from Task 9; fixtures `music.wav` (330 Hz sine, 3 s), `not-audio.mp3` (a PNG renamed), plus the existing clips.

- [ ] **Step 1: Write failing E2E tests** (probing downloaded files with the existing `ffmpeg-static` helpers, plus pixel/duration checks): `intro and outro add two card durations` (cards on, 2 s cards, 2 s trim → total ≈ 6 s ±0.4); `the first frame is the accent colour` (set a distinct colour, pixel near the corner at 1 s); `music is audible over a clip with no audio` (`silent.webm` + `music.wav`, mean volume > -40 dB); `a long name and an emoji name still export` (Review Focus 4: 200-character name, then `🎯 Ünïcode`, export succeeds); `the watermark is on every plain export` (pixel at the bottom-right of the plain export region matches the logo's opaque area, not the test pattern); `lower-third text appears` (box pixel dark near bottom-left); `settings persist across a reload` (set name, colour, toggles, reload, same values); `a non-audio music file is rejected` (Review Focus 5: `music-error` visible, export still works without music); `the estimate is shown`.
- [ ] **Step 2: Run** `npm run e2e`; expect the new tests FAIL where the UI or fixtures are missing and pass where already implemented; investigate each unexpected result.
- [ ] **Step 3: Implement** the fixtures and any gaps the tests expose. Update README "Web version" with the new features and the always-on watermark, and the spec note.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run e2e`; expect all pass, including the zero-off-origin-requests test and the subpath run.
- [ ] **Step 5: Commit** `test: add branding and music E2E tests and docs`.

### After merge (owner steps, not code)

- Push to `main`; the Pages workflow deploys. On the live URL, run the device matrix for each phase: a phone clip with intro and outro, with music, with a lower-third; compare the cards and watermark side by side with a desktop export of the same clip. Record export times against the on-page estimate and tune `estimateExportSeconds`.
