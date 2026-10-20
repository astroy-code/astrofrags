import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The pinned @ffmpeg/ffmpeg worker is a module worker, so it loads the core via dynamic
// import() and needs the ESM build (the UMD build only works in classic workers).
const CORE_FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm']
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const targetDir = join(root, 'web', 'public', 'ffmpeg')

const missing = CORE_FILES.filter((name) => !existsSync(join(sourceDir, name)))
if (missing.length > 0) {
  console.error(`Cannot copy ffmpeg core: missing ${missing.join(', ')} in ${sourceDir}. Run npm install first.`)
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
for (const name of CORE_FILES) {
  copyFileSync(join(sourceDir, name), join(targetDir, name))
}
