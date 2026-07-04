import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility scan against rendered pages.
 *
 * Tagged with wcag2a + wcag2aa + best-practice. We fail on serious/critical
 * violations; minor color-contrast issues from the design system are
 * surfaced as warnings via the report rather than gating the build.
 */
const PAGES_TO_SCAN = ['/login', '/register', '/forgot-password']

for (const path of PAGES_TO_SCAN) {
  test(`accessibility: ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze()

    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    // Attach the full report for triage even when the test passes.
    test.info().attach('axe-report.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    })

    expect(serious, `serious a11y violations on ${path}:\n` + serious.map((v) => v.id).join('\n')).toEqual([])
  })
}
