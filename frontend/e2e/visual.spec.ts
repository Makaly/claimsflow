import { test, expect } from '@playwright/test'

/**
 * Visual regression — snapshots are stored under
 *   e2e/visual.spec.ts-snapshots/
 * Baselines are generated on first run with `npx playwright test --update-snapshots`.
 *
 * Keep this list intentionally small: every snapshot is a maintenance cost.
 * Only screens that change rarely + have high visual importance belong here.
 */
const PAGES = ['/login', '/register']

for (const path of PAGES) {
  test(`visual: ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    // Mask anything that changes between runs (timestamps, animated icons,
    // counters). Login is mostly static so the mask list is short.
    await expect(page).toHaveScreenshot(`${path.replace(/\//g, '_') || 'root'}.png`, {
      fullPage: true,
      animations: 'disabled',
    })
  })
}
