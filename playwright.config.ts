import { defineConfig, devices } from '@playwright/test'

const PORT = 4317
// Served under a repo subpath, the way GitHub Pages serves the site.
const SITE_URL = `http://localhost:${PORT}/astrofrags/`

export default defineConfig({
  testDir: 'web/e2e',
  globalSetup: './web/e2e/global-setup.mjs',
  // ffmpeg.wasm loads a ~30 MB core and re-encodes in a single thread.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: SITE_URL,
    acceptDownloads: true
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run web:build && npx vite preview --config web/vite.config.ts --base /astrofrags/ --port ${PORT} --strictPort`,
    url: SITE_URL,
    reuseExistingServer: false,
    timeout: 180_000
  }
})
