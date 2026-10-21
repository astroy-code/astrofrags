# Web Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find the loudest moments of a recording and turn them into clips or a reel, on the web page, like the desktop app.

**Architecture:** Pure peak maths and range selection in `lib/highlights.ts`; an ffmpeg decode wrapper in `lib/detectHighlights.ts` using the shared instance and `runExclusive`; immutable reel operations in `reel.ts`; a `HighlightsPanel` component wired in `App.tsx` through two new `useReel` actions.

**Tech Stack:** React 18, TypeScript, ffmpeg.wasm 0.12 (`@ffmpeg/core@0.12.10`), Node test runner (`npm test`, from `web/`), Playwright (`npm run e2e`, from the repo root), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-10-21-web-highlights-design.md`

## Global Constraints

- Immutable updates only; no new dependencies; files under 400 lines; no `console.log`.
- Same algorithm constants as desktop: window 0.1 s, merge gap 3 s, threshold `mean + 3 x stddev`, at most 12 peaks, pad 5 s before and 3 s after, at most 8 clips per build.
- Decode at 8 kHz mono `s16le` (ruling in the spec).
- Soft behaviour only: no blocking limits. Controls at least 44 px tall.
- Run unit tests from `web/`; run `npm run e2e` from the repo root.

## Review Focus

- No audio track, fully silent audio, or fewer than a few windows (stddev 0): a message, no crash, no peaks. Tests in Tasks 1 and 3.
- Peaks within a few seconds merge; Build never returns overlapping ranges, and honours other clips of the same file. Task 1.
- Peak at the very start or end clamps to `[0, duration]`. Task 1.
- Cancel, Start over, or Remove mid-detection: no stale result lands. Task 4 (e2e for cancel; reel test for dropped result).
- Build with other clips from the same file already in the reel. Tasks 1 and 2.

---

### Task 1: Peak maths and range selection

**Files:**
- Create: `web/src/lib/highlights.ts`
- Test: `web/src/lib/__tests__/highlights.test.ts`

**Interfaces:**
- Produces:
  - `interface Peak { readonly time: number; readonly score: number }`
  - `const HIGHLIGHT_PAD_BEFORE = 5`, `HIGHLIGHT_PAD_AFTER = 3`, `MAX_BUILD_CLIPS = 8`
  - `rmsPerWindow(samples: Int16Array, sampleRate: number): number[]` (0.1 s windows, last one partial)
  - `findPeaks(windows: readonly number[]): Peak[]` (desktop rules; strongest first)
  - `peakRange(peak: Peak, duration: number): TrimRange` (`time - 5` .. `time + 3`, clamped to `[0, duration]`; no upper clamp when `duration <= 0`)
  - `chooseHighlights(input: { peaks: readonly Peak[]; duration: number; taken: readonly TrimRange[]; maxClips?: number }): readonly { peak: Peak; range: TrimRange }[]` (best score first, skip any whose range overlaps a taken or already chosen range, at most `maxClips` (default 8), returned in time order)

- [ ] **Step 1: Write the failing tests** in `highlights.test.ts` covering: `rmsPerWindow` of a constant-amplitude signal gives equal windows and a partial last window; `findPeaks` of `[1,1,1,9,1,1,1,1,1,1,1,1]`-style input returns the spike at `index*0.1` with its score; two spikes 2 s apart merge to the stronger (time and score of the stronger), two spikes 4 s apart stay separate; more than 12 peaks keep the 12 strongest, strongest first; a flat signal (stddev 0), an empty array and a single window return `[]`; `peakRange` at time 2 gives `{0, 5}`, at `duration - 1` clamps the end to `duration`, and with `duration` 0 leaves the end at `time + 3`; `chooseHighlights` skips a peak overlapping a `taken` range, never returns two overlapping ranges, stops at `maxClips`, returns time order, and returns `[]` for no peaks.
- [ ] **Step 2: Run** `cd web && npm test` — Expected: FAIL, module `../highlights.ts` not found.
- [ ] **Step 3: Implement** the functions above in `highlights.ts` (merge walks raw peaks in time order exactly like desktop `findPeaks`; overlap is `a.start < b.end && b.start < a.end`).
- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: add highlight peak detection maths`

### Task 2: Reel operations for highlights

**Files:**
- Modify: `web/src/lib/reel.ts` (add `highlights` to `ClipItem` and `createClip`; add operations)
- Test: `web/src/lib/__tests__/reel.test.ts`

**Interfaces:**
- Consumes: `Peak` from Task 1.
- Produces:
  - `ClipItem.highlights: readonly Peak[] | null` (null until found; `createClip` sets null)
  - `clipFromRange(source: ClipItem, objectUrl: string, range: TrimRange): NewClip` — same `file`, `duration`, `videoSize`, audio facts (`audioLevels`, `audioTrackCount`, `audioProbeDone`, `audioTrackOverride`), `highlights: null`, `previewBroken: false`, `sizeWarningDismissed: true`
  - `insertClipsAfter(reel: Reel, afterId: number, items: readonly NewClip[]): Reel` — unknown id leaves the reel unchanged; selects the first inserted clip
  - `replaceClip(reel: Reel, id: number, items: readonly NewClip[]): Reel` — removes the clip and puts `items` at its position, selects the first; unknown id unchanged; empty `items` unchanged
  - `clipsOfFile(reel: Reel, file: File, exceptId?: number): readonly ClipItem[]`

- [ ] **Step 1: Write the failing tests** in `reel.test.ts`: `clipFromRange` keeps the file and audio facts and takes the new range; `insertClipsAfter` places items directly after the target, gives new ids from `nextId`, selects the first, ignores an unknown id; `replaceClip` puts items at the clip's index, drops the clip, selects the first new one, keeps other clips in order, ignores unknown id and empty items; `clipsOfFile` returns only clips sharing that `File` and honours `exceptId`; `updateClip` for a removed id still returns the same reel (late detection result dropped).
- [ ] **Step 2: Run** `cd web && npm test` — Expected: FAIL (missing exports). Existing tests that build a `ClipItem` literal need `highlights: null`; add it.
- [ ] **Step 3: Implement** the operations in `reel.ts`; keep the file under 400 lines.
- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: add reel operations for highlight clips`

### Task 3: Decode a clip's audio and find its highlights

**Files:**
- Create: `web/src/lib/detectHighlights.ts`
- Modify: `web/src/lib/ffmpegArgs.ts` (add `buildHighlightDecodeArgs`)
- Modify: `web/src/lib/__tests__/support/ffmpegCore.ts` (add `makeBurstClip`)
- Test: `web/src/lib/__tests__/ffmpegArgs.test.ts`, `web/src/lib/__tests__/highlights.core.test.ts`

**Interfaces:**
- Consumes: `rmsPerWindow`, `findPeaks`, `Peak` (Task 1); `getFFmpeg`, `resetFFmpeg`, `runExclusive` (`ffmpegInstance.ts`); the mount helper pattern in `exportClip.ts` (export `withMountedFile` from there).
- Produces:
  - `buildHighlightDecodeArgs({ inputPath, trackIndex, outputPath }): string[]` — like `buildLevelProbeArgs` but 8 kHz mono `s16le`, no `-t` cap
  - `detectHighlights(req: { file: File; trackIndex: number; durationSeconds: number; onProgress: (ratio: number) => void; signal?: AbortSignal }): Promise<readonly Peak[]>` — throws `ExportCancelledError`-style `HighlightsCancelledError` when aborted; deletes its temp file; progress is `progressRatio(time, durationSeconds)`
  - `pcmPeaks(pcm: Uint8Array): Peak[]` — copies to an aligned `Int16Array`, then `findPeaks(rmsPerWindow(..., 8000))` (exported so the core test can run it on real decoded bytes)
  - Test helper `makeBurstClip(opts: { seconds: number; bursts: readonly number[] }): Promise<Uint8Array>` — a quiet low sine bed with 0.4 s loud bursts starting at each time in `bursts`, with a tiny black video

- [ ] **Step 1: Write the failing tests.** `ffmpegArgs.test.ts`: decode args map `0:a:N`, are 8000 Hz mono `s16le`, carry no `-t`. `highlights.core.test.ts` (real core via `runCore`): decode a `makeBurstClip({ seconds: 30, bursts: [8, 21] })` with `buildHighlightDecodeArgs`, run `pcmPeaks`, and expect two peaks near 8 s and 21 s (each within 0.6 s), strongest first or time order as the algorithm gives; a clip with no bursts gives no peaks; a clip with no audio stream makes ffmpeg exit non-zero (documented: the page never calls it then).
- [ ] **Step 2: Run** `cd web && npm test` — Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** `buildHighlightDecodeArgs`, `pcmPeaks`, `makeBurstClip`, and `detectHighlights` (mount the file, register the abort listener to `resetFFmpeg()` before waiting like `exportTrimmedClip`, exec with the `progress` listener, `readFile`, `pcmPeaks`, always delete the temp file).
- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: detect highlights from a clip's audio`

### Task 4: Highlights on the page

**Files:**
- Create: `web/src/components/HighlightsPanel.tsx`
- Modify: `web/src/useReel.ts` (actions `setHighlights`, `addMoment`, `buildFromHighlights`), `web/src/App.tsx`, `web/src/styles.css`, `README.md`
- Modify: `web/e2e/fixtures/make-fixtures.mjs`, `web/e2e/fixtures/names.json`, `web/e2e/support.ts` (fixture `bursts.webm`: 40 s, quiet bed, bursts at 10 s and 30 s, with audio)
- Test: `web/e2e/highlights.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `HighlightsPanel` props `{ clip: ClipItem; running: boolean; progress: number; error: string | null; busy: boolean; onFind(): void; onCancel(): void; onAddMoment(peak: Peak): void; onBuild(): void }` with test ids `find-highlights`, `highlights-cancel`, `highlights-status`, `highlight-moment` (one per peak), `build-from-highlights`. `useReel` actions: `setHighlights(id: number, peaks: readonly Peak[] | null)`, `addMoment(sourceId: number, peak: Peak): void` (selects the existing same-file clip if the padded range overlaps one), `buildFromHighlights(sourceId: number): void`, which replaces the clip using `chooseHighlights` and `replaceClip`.
- App behaviour: Find runs `detectHighlights` with the clip's `trackOf` track and an `AbortController` kept in a ref; Start over, Remove of that clip, and starting an export abort it; a result is applied with `setHighlights` (dropped by `updateClip` if the clip is gone). The panel shows: "No sound to analyze" for a clip with no track, "No standout moments found" for an empty result, the error text on failure. After Build, if the format is vertical/vertical-crop, call the same fit logic as `handleFitToCap` on the new ranges (extract `fitCurrentReel` so both use it).

- [ ] **Step 1: Write the failing E2E tests** in `highlights.spec.ts`: pick `bursts.webm`; **Find highlights** is enabled after the audio check; running it lists two moments near 0:10 and 0:30 (`highlight-moment` count 2, text contains `0:10` and `0:30`); tapping the first adds a clip (clip count 2, the new one selected, range text 5 s before to 3 s after, i.e. length 0:08); tapping it again selects instead of duplicating; **Build reel from highlights** replaces the recording clip with two clips in time order and the export button reads "Export reel", each 0:08 long (the Shorts fit path is covered by the existing `fitToCap` tests); a clip with no audio (`silent.webm`) shows "No sound to analyze" and Find is absent or disabled; Cancel during a run returns to the idle state with no result (use the 200 s `long.webm` fixture if the run is too short to catch, polling for the cancel button); Start over during a run leaves an empty page and later actions work.
- [ ] **Step 2: Run** `npm run e2e -- web/e2e/highlights.spec.ts` from the repo root — Expected: FAIL (controls missing).
- [ ] **Step 3: Implement** the component, actions, App wiring, CSS, fixture and README bullet ("Find highlights" and "Build reel from highlights" with the 8 kHz note).
- [ ] **Step 4: Run** `cd web && npm test && npm run typecheck`, then `npm run e2e` from the repo root — Expected: everything passes (unit count rises; e2e 48 plus the new tests).
- [ ] **Step 5: Commit** `feat: find highlights and build a reel from them`
