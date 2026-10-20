import { FFmpeg } from '@ffmpeg/ffmpeg'

let current: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null
let queue: Promise<unknown> = Promise.resolve()

// The core is self-hosted next to the page (see scripts/copy-ffmpeg-core.mjs), resolved
// against the document base so it works under the GitHub Pages repo subpath.
function coreUrl(fileName: string): string {
  return new URL(`ffmpeg/${fileName}`, document.baseURI).href
}

/** Lazily creates and loads the single shared FFmpeg instance. Concurrent callers share one load. */
export function getFFmpeg(): Promise<FFmpeg> {
  if (loading) return loading

  const ffmpeg = new FFmpeg()
  current = ffmpeg
  const attempt = ffmpeg
    .load({ coreURL: coreUrl('ffmpeg-core.js'), wasmURL: coreUrl('ffmpeg-core.wasm') })
    .then(() => ffmpeg)
    .catch((error: unknown) => {
      if (current === ffmpeg) {
        current = null
        loading = null
      }
      throw error
    })
  loading = attempt
  return attempt
}

/** Terminates the instance (cancelling any running command) so the next getFFmpeg() starts fresh. */
export function resetFFmpeg(): void {
  current?.terminate()
  current = null
  loading = null
  queue = Promise.resolve()
}

/**
 * Runs tasks on the shared instance one at a time: a background probe and an export must not
 * mount files into the same directory concurrently.
 */
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.catch(() => undefined)
  return result
}
