# E2E suite

Three spec types live here:

| File              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `smoke.spec.ts`   | Critical user paths (login, navigation, redirects)         |
| `a11y.spec.ts`    | axe-core scan against rendered pages                       |
| `visual.spec.ts`  | Visual regression snapshots                                |

## Running

```bash
# headed locally
npm run test:e2e

# update visual baselines after intentional UI changes
npx playwright test --update-snapshots

# point at a deployed URL instead of vite preview
BASE_URL=https://staging.example.com PLAYWRIGHT_NO_WEBSERVER=1 npm run test:e2e
```

## CI

The CI job installs Playwright browsers, builds the frontend, runs `vite preview`,
and executes the suite against `http://localhost:4173`. Snapshots are committed
to git so cross-environment drift is caught at PR time.
