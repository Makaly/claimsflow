import { test, expect } from '@playwright/test'

test.describe('app smoke', () => {
  test('redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('login form validates email format', async ({ page }) => {
    await page.goto('/login')

    const email = page.getByLabel(/email/i).first()
    const password = page.getByLabel(/^password$/i).first()
    await email.fill('not-an-email')
    await password.fill('whatever')

    const submit = page.getByRole('button', { name: /sign in|log in/i }).first()
    await submit.click()

    await expect(page.getByText(/invalid email/i)).toBeVisible()
  })

  test('login renders the demo role chooser', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText(/admin/i).first()).toBeVisible()
  })
})
