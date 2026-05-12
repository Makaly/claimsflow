# Changelog

All notable changes to ClaimsFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **CODEOWNERS** (`.github/CODEOWNERS`) for default-reviewer routing.
- **GitHub Pages docs deploy** workflow (`.github/workflows/docs.yml`) —
  builds MkDocs strictly on every push to `master` that touches `docs/`
  or `mkdocs.yml` and publishes to GitHub Pages.
- **Keep-warm workflow** (`.github/workflows/keepalive.yml`) — pings the
  backend `/api/health` and the frontend root every 10 minutes so the
  Render free tier does not spin down. Matrix runs the two targets in
  parallel, curl handles transient retries, and a bad ping logs a
  workflow warning rather than failing the job.
- **Axios retry interceptor** (`frontend/src/services/retry.ts`) — single
  retry on network errors and 502/503/504 responses, covering the
  Render cold-start window where the edge returns a CORS-headerless
  502 while the container boots. Surfaced as `attachRetryInterceptor`
  and wired into the shared `api` client with seven Vitest cases.

### Changed

- README badges now reflect live CI / CodeQL status and the latest
  release tag instead of hard-coded shields.

### Fixed

- **Global fetch proxy normalises legacy `/api/...` callers** —
  installed a thin wrapper around `window.fetch` (in `main.tsx`, before
  any component mounts) that rewrites relative `/api/*` and
  `/socket.io/*` URLs to the absolute backend origin from
  `VITE_API_URL` and sets `credentials: 'include'` so the HttpOnly
  auth cookie travels with the request. Covers ~20 legacy components
  that still use raw fetch + `localStorage.getItem('token')`, without
  forcing a per-file refactor. Idempotent; no-op for absolute URLs
  and non-api paths. Backed by eight Vitest cases.
- **"Failed to load onboarding packet" + repeated JSON.parse errors** —
  ~20 places in the frontend still used raw `fetch('/api/...')` with
  `Authorization: Bearer ${localStorage.getItem('token')}`. After the
  move to HttpOnly cookie auth, the header became `Bearer null` and the
  relative `/api/...` URL hit the frontend static site instead of the
  backend, returning `index.html` (hence `JSON.parse: unexpected
  character '<'`). Rather than rewrite every caller, added Render
  static-site rewrites for `/api/*` and `/socket.io/*` so the frontend
  proxies straight through to the backend. The browser now sees both as
  same-origin (same as the Vite dev proxy in development), the cookie
  rides every request automatically, and the no-token fetches succeed.
- **Silent boot failure on Render** — deploy logs ended at "🎉 Seed
  complete!" with no subsequent output from the API process, leaving
  Render's edge in a `no-deploy` routing state. Three hardening
  changes turn the next failure into a diagnosable one:
  - Boot chain in `Dockerfile.prod` now echoes a `[boot] step N/4`
    marker before each phase and `exec node dist/main` so signals
    reach the app instead of the wrapper shell.
  - `src/main.ts` logs `[bootstrap]` markers around Nest creation
    and HTTP bind, binds to `0.0.0.0` so Render's health probe can
    reach the listener (Nest defaults to `::1` inside the container,
    which the probe misses), and installs `unhandledRejection` /
    `uncaughtException` handlers that print and exit instead of
    swallowing the error.
- **WebSocket connection refused / namespace mismatch** — the socket.io
  client built its URL by appending `/events` to `VITE_API_URL` (which
  ends in `/api`), producing namespace `/api/events` on a server that
  exposes `/events`. Strip a trailing `/api` from the API base when
  constructing the socket URL. Also reorder transports to
  `['polling', 'websocket']` so a blocked WS upgrade on Render's free
  tier silently degrades to long-polling instead of looping retries,
  drop the dead `localStorage.getItem('token')` gate (auth moved to
  HttpOnly cookies), and add `withCredentials: true` so the cookie is
  attached to the handshake.
- **Events gateway accepts auth via cookie** — `EventsGateway` now
  reads the token from `handshake.auth.token`, then the `Authorization`
  header, then the `access_token` cookie, matching the REST auth
  strategy. CORS for the WS handshake honours `FRONTEND_URL` with
  `credentials: true` instead of the wildcard origin, which browsers
  refuse to use with credentialed sockets.
- **Render build broken by test-file type error** — production build
  runs `tsc -b && vite build`, which type-checked `*.test.ts` files
  alongside src and failed on an implicit-`any` in `retry.test.ts`.
  Split test type-checking into a dedicated `tsconfig.test.json` and
  excluded `*.{test,spec,stories}.{ts,tsx}` plus `src/test/` from the
  production tsconfig so a test-only type error can never block a
  deploy again.
- **Cross-site auth cookie** — production deploy puts the frontend
  (`claimsflow-frontend.onrender.com`) and backend
  (`claimsflow-backend.onrender.com`) on different sites, so
  `SameSite=Strict` prevented the browser from attaching the
  `access_token` cookie to API calls. Switched to
  `SameSite=None; Secure` in production while keeping
  `SameSite=Strict` in dev (where Vite proxies same-origin). Logout
  uses the matching attributes so `clearCookie` actually unsets it.

## [1.4.0] - 2026-05-12

### Added

- **OpenAPI / Swagger** — backend now publishes a live Swagger UI at
  `/api/docs` and emits an OpenAPI spec to disk via `EXPORT_OPENAPI=1`,
  consumed by `scripts/build-redoc.sh` to produce a self-contained
  Redoc static reference (`docs/api/redoc.html`).
- **MkDocs site** — full Material-themed documentation under `docs/`
  with home, getting-started, testing, API, architecture, security,
  and changelog sections. Built in CI with `mkdocs build --strict`.
- **Storybook 8** for the frontend with a11y + interactions addons and
  initial badge/button stories; static bundle uploaded as a CI artifact.
- **Frontend test infrastructure** — Vitest + jest-axe for unit and
  accessibility tests; Playwright for browser-based e2e + a11y + visual
  regression with the HTML report uploaded from CI.
- **Architecture fitness suite** — `backend/test/architecture.e2e-spec.ts`
  enforces module boundaries (no `claims → auth` deep imports, no
  controller-to-controller dependencies, etc.).
- **Module-layering rules** for the frontend via dependency-cruiser
  (`.dependency-cruiser.cjs` + `npm run depcruise`), wired into CI.
- **k6 performance suite** under `perf/` — smoke (`smoke.js`) and auth
  load profile (`load-auth.js`); smoke runs on every PR labelled `perf`.
- **Kubernetes manifests** under `k8s/` for namespace, backend, and
  frontend deployments, validated in CI with kubeconform + kube-linter.
- **Security tooling configs** — gitleaks, hadolint, semgrep, trivy,
  and OWASP ZAP baseline configuration files for repeatable scans.
- **Unit tests** for `AppController` health and root endpoints,
  `computeFraudSignals` (10 signal types, 17 cases), `AuthService`
  (login, lockout, password-reset flow), `AnomalyScoringService`
  (7 statistical factors, score clamping, risk-level boundaries),
  and the OCR vision-router pre-flight + invoice patterns.
- **Lightweight HTTP e2e** for `/`, `/health`, and unknown routes using
  supertest — boots only `AppController`/`AppService` so it runs without
  infrastructure dependencies in CI.
- External `jest.config.js` replaces the inline `package.json` block,
  keeping test configuration out of dependency-PR diffs.

### Changed

- **CI pipeline expanded** — backend job runs the e2e + architecture
  fitness suite alongside unit tests; frontend job runs depcruise +
  Vitest + Storybook build; new dedicated jobs for Playwright e2e,
  MkDocs (strict), hadolint + compose config check, kubeconform +
  kube-linter, and a consolidated security scan (gitleaks, npm audit,
  Trivy with SARIF upload to GitHub Security).
- Enabled `isolatedModules: true` in `tsconfig.json` (recommended by
  ts-jest) — eliminates the deprecation warning and speeds up cold
  starts on the CI runner.
- Repository `.gitignore` updated to exclude `storybook-static/` and
  the generated `openapi.json`.

### Fixed

- **Swagger packages missing in production image** — `@nestjs/swagger`
  and `swagger-ui-express` are imported at boot by `src/main.ts`, but
  they were declared in `devDependencies`, so the runtime Docker stage
  (`npm install --omit=dev`) dropped them and the container crashed
  with `MODULE_NOT_FOUND`. Moved both to `dependencies` and refreshed
  the lockfile.
- **Production deploy failure** — `prisma` CLI was in `devDependencies` and
  the runtime Docker stage runs `npm install --omit=dev`, which dropped it.
  At startup `npx prisma migrate deploy` fell back to downloading the
  latest Prisma from npm (v7.8.0), which rejected the existing schema
  because Prisma 7 dropped `url = env("DATABASE_URL")` syntax in the
  datasource block. Moved `prisma` to `dependencies` and pinned both
  `prisma` and `@prisma/client` to exact `5.22.0` so the CLI is bundled
  into the runtime image and version drift is impossible.

## [1.3.0] - 2026-05-12

### Added

- **ML feedback loop** — `ClaimLabel` model records adjudication outcomes
  (`legitimate`, `suspicious`, `fraud`) against the claim features snapshot
  taken at scoring time, enabling continuous model improvement.
- **Factor-effectiveness endpoint** (`GET /claims/ml/factor-effectiveness`)
  computes per-factor predictive power by correlating anomaly features with
  labelled outcomes; requires minimum 20 labelled samples before returning
  statistics.
- **Claim-labels API** (`ClaimLabelsService` + `ClaimLabelsController`) —
  create, update, and query outcome labels with source attribution and
  confidence scores.
- **Mock integrations module** — stub controllers for EDMS and eOxegen that
  respond with realistic fixtures, allowing full local development without
  live third-party connectivity.
- **Policy module** — groundwork for plan-level policy configuration.
- Migration `20260512300000_add_claim_labels` — creates `claim_labels` table
  with unique claim constraint and indexes on label, source, and created_at.

### Changed

- NestJS upgraded from v10 to v11 across all `@nestjs/*` packages.
- `MockIntegrationsModule` registered in `AppModule` so EDMS/eOxegen stubs
  are available in every environment.
- `AnomalyScoringService` extended with `getFactorEffectiveness()` for
  weight-tuning insights.
- README updated: NestJS version badge, repo layout, and highlights section.

### Fixed

- Docker production build (`Dockerfile.prod`) — both `npm ci` and
  `npm install --omit=dev` now pass `--legacy-peer-deps` to resolve
  the peer-dependency conflict introduced by `socket.io` v4 and
  `@nestjs/platform-socket.io` v11.

### Security

- All `execSync` subprocess calls in OCR services replaced with `spawnSync`
  with explicit argument arrays, eliminating shell-injection vectors.
- File upload endpoints now verify magic bytes (PDF `%PDF`, JPEG `0xFF 0xD8`,
  PNG `0x89 PNG` signatures) before accepting files; mismatched content types
  are rejected and the temp file is deleted.
- JWT delivery changed to HttpOnly, SameSite=Strict cookie; tokens are no
  longer stored in `localStorage`. Frontend uses `withCredentials: true`.
- Global rate limiting enforced via `ThrottlerGuard` as `APP_GUARD` — 120
  req/min baseline, 10 req/min on auth endpoints.
- Helmet middleware applies strict CSP, X-Frame-Options, and
  X-Content-Type-Options on every response.
- `RegisterDto` restricts self-registration to `provider_admin` and
  `provider_user` roles; privileged roles require admin creation.
- Password policy enforced: minimum 10 characters with uppercase, lowercase,
  digit, and special character requirements.
- 2FA backup codes stored as bcrypt hashes; used codes are invalidated
  immediately after a successful recovery login.
- Temporary passwords are emailed to users rather than returned in API
  responses.

## [1.2.0] - 2026-05-12

### Added

- **Appeals module** — file, track, and adjudicate provider appeals against
  rejected or short-paid claims, with full document attachment support.
- **Payment advice module** — bulk-generate payment advices, capture bank
  reference and confirmation, and export to Excel.
- **Pre-authorisation module** — capture and review pre-auth requests with
  validity windows, approved amounts, and linkage to subsequent claims.
- **Eligibility verification** service that checks claims against member
  policy plans, limits, and validity period.
- **SLA tracking** on claims with `slaDeadline`, `slaBreached` flags and an
  aging dashboard page on the frontend.
- **System configuration** module exposing runtime settings via REST.
- **Real-time notifications** — Socket.IO gateway and a `NotificationBell`
  component for in-app delivery of workflow events.
- **Password reset** flow with token + expiry persistence and a dedicated
  `ResetPassword` page.
- **Two-factor authentication** (TOTP) with enrollment, verification, and
  recovery code endpoints.
- **Provider scorecard** page summarising claim volumes, denial rates and
  turnaround time per provider.
- **Bulk actions bar** for batch approve / reject / return on maker and
  checker queues.
- **Reports analytics** — denial reasons, channel breakdowns, claim aging,
  user productivity, and CSV/Excel export.
- Standard open-source documentation: `LICENSE`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates, and PR template.

### Changed

- Hardened backend bootstrap with explicit CORS allow-list, Helmet, cookie
  parser, request-size limits, and global validation pipe.
- `NotificationsModule` and `WorkflowModule` are now globally exported so
  cross-module event publishing works without circular imports.
- Frontend `authStore` and `claimsStore` updated to expose richer user
  profile data and survive cold starts.
- Reports service expanded with claim aging, denial reasons, provider
  scorecard, and channel analytics queries.
- JWT strategy and `RolesGuard` updated for new role taxonomy and stricter
  validation.

### Fixed

- OCR pipeline now demotes expected fallback events from `error` to `warn`
  and produces source maps for clearer stack traces.
- Authentication store no longer crashes on corrupt `localStorage` payloads.
- Sidebar re-fetches the current user when the token is present but the
  profile is missing (cold-start logout regression).

### Security

- Refer to [SECURITY.md](SECURITY.md). External API keys must be rotated
  if any prior `.env` file was ever shared. Password reset tokens are now
  single-use with a short expiry. All new endpoints are role-guarded.

## [1.1.0] - 2026-04-17

### Added

- Docker Compose orchestration for Postgres, Redis, backend, and frontend.
- Render deployment configuration with pinned Node 20 and Alpine + OpenSSL.

### Fixed

- Prisma engine load failure on Alpine by installing `openssl`.
- `npm ci` from the repo root by introducing a thin root `package.json`.

## [1.0.0] - 2025-12-30

### Added

- Initial public release of ClaimsFlow.
- Batch upload with Code128 barcodes and PDF watermarking.
- Maker–Checker dual-control workflow.
- Provider approval workflow.
- Two-factor authentication via TOTP and SMS.
- SMS (Twilio, Africa's Talking) and email notifications.
- Activity logging middleware.
- Five claim assignment strategies.
- Completeness validation.
- 15 frontend pages and 50+ API endpoints.

[Unreleased]: https://github.com/Makaly/claimsflow/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Makaly/claimsflow/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Makaly/claimsflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Makaly/claimsflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Makaly/claimsflow/releases/tag/v1.0.0
