# Web Waveform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a zoomable loudness waveform with the trim region, moment markers and playhead under the video, after Find highlights.

**Architecture:** Highlights scans keep their 0.1 s loudness windows on the clip; a pure `waveformView.ts` holds all view maths (columns, time/x mapping, zoom, pan, hit-testing); a thin `Waveform` canvas component handles drawing and pointer gestures; `TrimPlayer` renders it below the video with the video's time and seek.

**Tech Stack:** React 18, TypeScript, canvas 2D, pointer events, Node test runner (`npm test`), Playwright (`npm run e2e`, from the repo root), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-10-21-web-waveform-design.md`

## Global Constraints

- Immutable state; no new dependencies; files under 400 lines; no `console.log`.
- Max zoom 100 px/s; hit radius 22 px; tap-vs-pan threshold 6 px; minimum trim 0.5 s (`withStart`/`withEnd`).
- Canvas is only as wide as the strip (never as wide as the recording).
- Run unit tests from the repo root (`npm test`); e2e from the repo root.

## Review Focus

- Very short and very long recordings: view maths clamps; columns correct. Task 2.
- Zoom anchor stays under the finger; pan/zoom never leave `[0, duration]`. Task 2.
- Handle drag past the other handle / 0 / end stays valid. Task 3 (e2e) with `withStart`/`withEnd`.
- Switching clips resets the view; no `loudness` means no strip. Task 3.
- Tap vs drag vs pan classification. Task 2 (`classifyPointerDown`, `isTap`).

---

### Task 1: Keep the loudness windows

**Files:**
- Modify: `web/src/lib/highlights.ts` (`peaksFromChunks` also returns the windows), `web/src/lib/detectHighlights.ts`, `web/src/lib/reel.ts`, `web/src/useReel.ts`, `web/src/App.tsx`
- Test: `web/src/lib/__tests__/highlights.test.ts`, `highlights.core.test.ts`, `reel.test.ts`

**Interfaces:**
- Produces:
  - `interface HighlightScan { readonly peaks: Peak[]; readonly loudness: Float32Array }`
  - `peaksFromChunks(...)` renamed `scanChunks(...)`: `Promise<HighlightScan>` (same request type)
  - `detectHighlights(req): Promise<HighlightScan>`
  - `ClipItem.loudness: Float32Array | null` (null until scanned; `createClip` null; `clipFromRange` shares the source's array)
  - `ReelActions.setHighlights(id: number, scan: HighlightScan | null): void` (sets `highlights` and `loudness`; null clears both)

- [ ] **Step 1: Update/write the failing tests**: rename uses of `peaksFromChunks` to `scanChunks` and read `.peaks`; add: the scan's `loudness` has one value per 0.1 s window over the whole recording (25 s in 10 s chunks gives 250 values, burst windows louder than the rest, silence windows near 0); `reel.test.ts`: `createClip` has `loudness` null, `clipFromRange` keeps the same array, `updateClip` with `{ loudness }` for a removed clip is dropped.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (missing export `scanChunks`).
- [ ] **Step 3: Implement** the renames and fields; `setHighlights` writes both; App passes the scan through.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run e2e` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: keep a clip's loudness from the highlight scan`

### Task 2: Waveform view maths

**Files:**
- Create: `web/src/lib/waveformView.ts`
- Test: `web/src/lib/__tests__/waveformView.test.ts`

**Interfaces:**
- Produces (all pure):
  - `interface View { readonly start: number; readonly pxPerSecond: number }` (`start` = time at the left edge)
  - `const MAX_PX_PER_SECOND = 100`, `HIT_RADIUS_PX = 22`, `TAP_SLOP_PX = 6`
  - `fitView(duration: number, widthPx: number): View`
  - `clampView(view: View, duration: number, widthPx: number): View` — pxPerSecond within `[widthPx/duration, MAX]`, start within `[0, max(0, duration - widthPx/pxPerSecond)]`; duration or width <= 0 gives `{ start: 0, pxPerSecond: 1 }`
  - `timeAtX(x: number, view: View): number`, `xAtTime(time: number, view: View): number`
  - `zoomAround(view: View, factor: number, anchorTime: number, duration: number, widthPx: number): View` — the anchor keeps its x
  - `panBy(view: View, dxPx: number, duration: number, widthPx: number): View` (dragging right moves earlier time into view)
  - `zoomToRange(range: TrimRange, duration: number, widthPx: number): View` (range plus 10% margin each side, clamped)
  - `columnLevels(loudness: Float32Array, view: View, widthPx: number): number[]` — per pixel column the max window in its time span (each column covers at least one window), 0 outside the recording; values are raw (callers scale)
  - `normalizeLevels(levels: readonly number[], loudest: number, minimum?: number): number[]` — 0..1 of `loudest`, at least `minimum` (default 0.02); all-zero `loudest` gives all `minimum`
  - `type Hit = { kind: 'start' } | { kind: 'end' } | { kind: 'peak'; peak: Peak } | { kind: 'none' }`
  - `hitTest(x: number, view: View, targets: { range: TrimRange; peaks: readonly Peak[] }, radiusPx?: number): Hit` — handles win over peaks within reach; otherwise the nearest candidate within the radius; nothing in reach is `none`
  - `isTap(downX: number, downY: number, upX: number, upY: number): boolean` (moved at most `TAP_SLOP_PX` in both axes)

- [ ] **Step 1: Write the failing tests** covering: `fitView` shows the whole recording (`timeAtX(width)` equals duration); `clampView` refuses to zoom out past fit, past 100 px/s, or scroll before 0 / after the end, and survives zero duration/width; `xAtTime`/`timeAtX` are inverses; `zoomAround` keeps the anchor time at the same x and is clamped at both zoom limits; `panBy` direction and clamping; `zoomToRange` includes the range with margin and clamps near the edges; `columnLevels` of a known loudness array at fit and zoomed views (a single loud window is the max of exactly its column; zoomed so one window spans many columns repeats it; columns past the end are 0; a 4-hour array at fit width does not throw and gives `width` values); `normalizeLevels` scaling and minimum; `hitTest` priority (handle beats a peak at the same x, nearest handle wins, peak outside radius is `none`); `isTap` boundaries (6 px inside, 7 px out, diagonal).
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `waveformView.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: add waveform view maths`

### Task 3: The waveform strip

**Files:**
- Create: `web/src/components/Waveform.tsx`
- Modify: `web/src/components/TrimPlayer.tsx` (tracks `currentTime`, renders a `waveform` render-prop under the video), `web/src/App.tsx`, `web/src/styles.css`, `README.md`
- Test: `web/e2e/waveform.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-2; `withStart`, `withEnd` (`trimRange.ts`); `peakRange` (`highlights.ts`).
- Produces: `Waveform` props `{ loudness: Float32Array; duration: number; range: TrimRange; peaks: readonly Peak[]; currentTime: number; locked: boolean; onSeek(time: number): void; onRangeChange(range: TrimRange): void; onAddMoment(peak: Peak): void }`. Test ids: `waveform` (the canvas, with `data-zoom` = current px/s and `data-markers` = peak count), `waveform-zoom-in`, `waveform-zoom-out`, `waveform-fit`, `waveform-selection`, `add-clip-here`. `TrimPlayer` gains `children?: (video: { currentTime: number; seek: (seconds: number) => void }) => ReactNode` rendered after the video.
- Behaviour per the spec: pointer events with `touch-action: none` on the canvas; one pointer = handle drag / pan / tap per `hitTest` and `isTap`; two pointers = pinch zoom around the midpoint; a `ResizeObserver` sets the strip width; the canvas is redrawn from `columnLevels` only for the visible columns; the view is reset (fit) when the clip changes (App keys the strip by the clip's object URL); **Add clip here** calls `onAddMoment({ time: currentTime, score: 0 })`.

- [ ] **Step 1: Write the failing E2E tests** in `waveform.spec.ts` using `bursts.webm` (40 s, bursts at 10 s and 30 s): no `waveform` before Find highlights; after it the canvas is visible with `data-markers` 2 and `data-zoom` equal to its fitted value; zoom in raises `data-zoom`, zoom out and Fit return to the fitted value, Selection zooms to the trim; clicking the canvas at the x of the first marker adds a clip (clip count 2, new clip 0:08.0) — x computed from the canvas bounding box and the fitted view; clicking elsewhere seeks the video (`player.currentTime` near the clicked time); dragging the start handle (at x of range start) to the x of 20 s sets the start slider near 20 and dragging the end handle left past the start stops at 0.5 s after the start; **Add clip here** after seeking to 20 s adds a clip around 20 s; selecting another clip that has no loudness shows no strip; while an export runs a handle drag changes nothing (use the slow `lengthy` path or assert via the locked attribute: set `data-locked` on the canvas).
- [ ] **Step 2: Run** `npm run e2e -- web/e2e/waveform.spec.ts` — Expected: FAIL (no `waveform`).
- [ ] **Step 3: Implement** the component, TrimPlayer render-prop, App wiring, CSS (strip 96 px tall, 44 px buttons) and a README bullet.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run e2e` — Expected: everything passes.
- [ ] **Step 5: Commit** `feat: show a waveform with trim handles and moment markers`
