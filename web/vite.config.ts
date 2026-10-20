import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  // Relative base so the site works under the GitHub Pages repo subpath (/astrofrags/).
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist-web',
    emptyOutDir: true
  },
  optimizeDeps: {
    // Pre-bundling breaks the package's `new Worker(new URL(...))` resolution.
    exclude: ['@ffmpeg/ffmpeg']
  },
  worker: {
    format: 'es'
  }
})
