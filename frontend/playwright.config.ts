import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — covers E2E, accessibility, and visual regression.
 *
 * `BASE_URL` env var lets CI point at a preview deploy.
 * Default 4173 is `vite preview`'s port — the suite spins it up automatically
 * unless PLAYWRIGHT_NO_WEBSERVER=1 is set (useful when running against a
 * dev server you've already started locally).
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Visual regression: allow 0.2% pixel diff to absorb font / antialiasing
    // variance between local and CI renderers.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox + WebKit kept in config but commented out — flip on once
    // the core suite is stable to avoid burning CI minutes early.
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port ' + PORT + ' --strictPort',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
