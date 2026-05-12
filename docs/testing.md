# Testing strategy

ClaimsFlow tests are organised into five layers. Each runs in CI on every PR.

| Layer                  | Tool                                  | Where                                    |
| ---------------------- | ------------------------------------- | ---------------------------------------- |
| Backend unit           | Jest + ts-jest                        | `backend/src/**/*.spec.ts`               |
| Backend e2e (HTTP)     | Jest + Supertest                      | `backend/test/*.e2e-spec.ts`             |
| Frontend unit          | Vitest + React Testing Library        | `frontend/src/**/*.test.ts(x)`           |
| Frontend a11y          | jest-axe (component) + axe-playwright | `*.a11y.test.tsx` / `frontend/e2e/a11y` |
| Frontend e2e + visual  | Playwright                            | `frontend/e2e/*.spec.ts`                 |

## Running the full suite

```bash
# from repo root — run sequentially
( cd backend  && npm test && npm run test:e2e )
( cd frontend && npm test && npm run test:e2e )
```

## What each layer guards

### Backend unit (`backend/src/**/*.spec.ts`)

- `auth.service.spec.ts` — login lockout, password hashing, registration flow
- `claims/fraud-signals.spec.ts` — every fraud rule (round-amount, identity, duplicate invoice, OCR confidence, date sanity, batch siblings)
- `claims/anomaly-scoring.service.spec.ts` — z-score outliers, submission velocity, factor cap
- `ocr/invoice-patterns.spec.ts` — every invoice / date / amount / membership regex against representative provider strings
- `ocr/claude-vision.service.spec.ts` — API-key gating for the Anthropic vision call

### Backend e2e (`backend/test/`)

`app.e2e-spec.ts` boots a minimal Nest app and verifies `/health`, `/`, and
the 404 path through `Supertest`.

### Frontend unit / component / a11y

- `src/lib/utils.test.ts` — formatters and class-name merging
- `src/components/ui/badge.test.tsx` — variant classnames
- `src/components/ClaimLabelBadge.test.tsx` — label-mapping + fallback
- `src/components/ClaimLabelBadge.a11y.test.tsx` — axe scan via `jest-axe`

### Frontend Playwright (`frontend/e2e/`)

- `smoke.spec.ts` — unauthenticated redirect, email validation
- `a11y.spec.ts` — axe-core scan against `/login`, `/register`, `/forgot-password`
- `visual.spec.ts` — pixel-baseline snapshots for static pages

## Coverage targets

- Backend: 70% line coverage on critical services (`auth`, `claims`, `ocr`)
- Frontend: 70% line coverage on `lib/`, `services/`, and shared `components/ui/`

Run with coverage:

```bash
cd backend  && npm run test:cov
cd frontend && npm run test:cov
```

## Performance smoke (k6)

```bash
k6 run perf/smoke.js
```

See `perf/README.md` for thresholds.
