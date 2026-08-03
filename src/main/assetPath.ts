import { app } from 'electron'
import { join } from 'path'

// Same reasoning as ffmpegBinary.ts: a spawned ffmpeg process opens files directly through
// the OS, bypassing Electron's asar-aware fs shim entirely, so a bundled asset it needs to
// -i has to live somewhere ffmpeg can actually open it. asarUnpack (see package.json) puts a
// real copy at the mirrored .../app.asar.unpacked/... path in a packaged build; this is a
// no-op in dev, where app.getAppPath() never contains "app.asar" to begin with.
export function getBundledLogoPath(): string {
  const raw = join(app.getAppPath(), 'assets', 'astrofrags-logo.png')
  return raw.replace('app.asar', 'app.asar.unpacked')
}
