import { test, expect } from '@playwright/test'

test.describe('app smoke', () => {
  test('renders the public landing page at the root route', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('redirects protected routes to /login when unauthenticated', async ({ page }) => {
    await page.goto('/claims')
    await expect(page).toHaveURL(/\/login/)
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

  test('production login hides the demo role chooser', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
    await expect(page.getByText(/demo accounts/i)).toHaveCount(0)
  })

  test('test login renders the demo role chooser', async ({ page }) => {
    await page.goto('/testlogin')
    await expect(page.getByText(/demo accounts/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /admin/i }).first()).toBeVisible()
  })
})
