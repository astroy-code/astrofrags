import { defineConfig, devices } from '@playwright/test'

const PORT = 4317

export default defineConfig({
  testDir: 'web/e2e',
  globalSetup: './web/e2e/global-setup.mjs',
  // ffmpeg.wasm loads a ~30 MB core and re-encodes in a single thread.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    acceptDownloads: true
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run web:build && npx vite preview --config web/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000
  }
})
