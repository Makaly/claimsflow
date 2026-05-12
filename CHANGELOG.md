# Changelog

All notable changes to ClaimsFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
