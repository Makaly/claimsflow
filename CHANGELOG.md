# Changelog

All notable changes to ClaimsFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **One-step Linux & macOS installer for the scan agent** — new
  `scan-agent/install.sh` downloads a prebuilt single-file binary (no Node.js
  runtime required), optionally installs SANE backends via the host's package
  manager (`apt` / `dnf` / `pacman` / `zypper` / Homebrew), and registers the
  agent as a **systemd user service** (Linux) or **launchd agent** (macOS) so it
  auto-starts on login and survives reboots. Supports both interactive and
  piped (`curl … | bash`) modes, with `CLAIMSFLOW_AUTOSTART` /
  `CLAIMSFLOW_INSTALL_SANE` / `CLAIMSFLOW_VERSION` / `CLAIMSFLOW_PREFIX`
  environment-variable overrides for non-interactive installs. Companion
  `scan-agent/uninstall.sh` removes the binary and unregisters the service.

- **Linux / macOS build script** — new `scan-agent/build-unix.sh` cross-compiles
  standalone `claimsflow-scan-agent-linux-x64` / `claimsflow-scan-agent-mac-x64`
  binaries via `@yao-pkg/pkg`, builds for the host platform by default, accepts
  a `TARGETS="linux mac"` override, and prints a ready-to-paste `gh release
  upload` command for publishing artifacts to the `scan-agent-latest` release.

- **Per-OS installer commands in the Batch Upload UI** — the "Install scan
  agent" panel now renders separate cards for Linux and macOS, each with a
  copy-to-clipboard one-liner that points to the new `install.sh` asset. A new
  `InstallSnippet` component handles the clipboard interaction with a
  short-lived "copied" confirmation.

- **`rememberMe` on login** — `POST /auth/login` now accepts an optional
  `rememberMe` boolean. When `true`, the `access_token` HttpOnly cookie is
  issued with a 30-day `maxAge` instead of the default 24-hour window. The
  `LoginDto` carries a new `@IsBoolean() @IsOptional()` field; the flag is
  validated when present and silently ignored when absent.

- **OCR knowledge base `GET /classifier/zone-hits/best-values`** — returns the
  highest-quality known value per field for a given document type
  (confirmed-correct hits first, then high-confidence recent extractions).
  Designed to pre-populate fields on re-uploads of the same template without a
  second round-trip.

- **`templateId` surfaced in OCR extraction result** — the matched classifier
  template ID is now included in the OCR response payload so the frontend can
  immediately query the knowledge-base endpoint without an extra lookup.

### Changed

- **Scan-agent installer UX overhaul** — `scan-agent/install.sh` has been
  rewritten for a polished first-run experience: a bordered banner, numbered
  step headers (`[1/5]` → `[5/5]`), a Braille spinner for long-running package
  installs, a `curl --progress-bar` download with a size sanity-check, and a
  post-install health probe that polls `http://127.0.0.1:7420/health` for up to
  five seconds and prints the agent's reported version. The script ends with a
  green success banner showing total elapsed time. Behaviour is unchanged in
  piped (`curl … | bash`) mode — colours and spinners auto-disable when stdout
  isn't a TTY. `claimsflow-install.sh` is now gitignored so the downloaded copy
  produced by the README one-liner doesn't get accidentally committed.

- **Cross-platform hardware scanner support** — `ScannerService` now detects the
  server OS at startup and branches to the appropriate scanning back-end:
  - **Linux**: unchanged `scanimage` / SANE path; requires `sane-utils` package.
  - **Windows**: new Windows Image Acquisition (WIA) path — scanner enumeration
    and document capture are performed via the built-in `WIA.DeviceManager` COM
    object invoked through PowerShell scripts written to temp files (never
    interpolated into `-Command` to prevent injection). Supports all WIA 1.0
    compatible devices (Epson, HP, Canon, Fujitsu, Kodak Alaris, etc.).
  - `GET /scanner/devices` response shape updated: `saneAvailable: boolean` →
    `driverAvailable: boolean` + `platform: "linux" | "windows" | "other"` +
    optional `cloudHosted: boolean`. The frontend reads `driverAvailable` with
    a fallback to `saneAvailable` for backward compatibility with cached responses.
  - Batch Upload UI is now cloud-aware: when the backend reports `cloudHosted: true`
    (set automatically on Render via `RENDER=true`, or any host with
    `CLOUD_HOSTED=true`), a blue info panel explains that direct scanner access
    is unavailable and links the user to the Upload Files tab. The amber
    driver-not-installed error is reserved for on-premises deployments where a
    scanner is expected but the driver is genuinely missing.
  - Batch Upload UI driver-error message is now OS-aware: Windows shows WIA /
    Device Manager guidance; Linux shows the `apt install sane-utils` command.

- **`POST /auth/logout` no longer requires authentication** — the `JwtAuthGuard`
  was removed from the logout endpoint. Attempting to clear an already-expired
  cookie with a guarded route returned a 401 and left the cookie in place;
  removing the guard ensures the browser-side cookie is always cleared, even
  after token expiry.

- **Frontend session management centralised through `authStore` and Axios** —
  `useAuthStore.logout()` is now asynchronous: it calls `POST /auth/logout` to
  clear the server-side HttpOnly cookie before wiping local state. All `fetch()`
  call sites across the frontend have been migrated to the shared Axios `api`
  instance (configured with `withCredentials: true`), eliminating the manual
  `Authorization: Bearer …` header pattern and direct `localStorage` token
  reads. The 401 interceptor uses a lazy import to avoid a circular dependency
  between `api.ts` and `authStore.ts`, and skips logout logic on the
  `/auth/logout` and `/auth/login` endpoints to prevent redirect loops on
  expired-session requests.

- **Session validated on every app boot** — `AppRoutes` calls `fetchProfile()`
  unconditionally on mount (previously only when `user` was absent). This detects
  stale `localStorage` user objects whose HttpOnly cookie has since expired on
  the first render, rather than waiting for an authenticated API call to fail.

### Fixed

- **Account inactive check moved before bcrypt** — `AuthService.login()` now
  short-circuits with `401 Account is inactive` before calling `bcrypt.compare`,
  avoiding a wasted hash comparison and spurious failed-attempt counter increment
  for inactive or suspended accounts.

- **`validateUser` hardened against soft-deleted and locked accounts** —
  `deletedAt`, `isActive`, and `lockedUntil` are now checked before the password
  hash comparison. Failed attempts increment `failedLoginAttempts` and lock the
  account for 15 minutes after 5 consecutive failures.

- **Batch upload did not trigger OCR or fraud detection** — `BatchSubmissionService`
  stored documents but never enqueued an OCR job, so the `OcrProcessor` (which
  runs `computeFraudSignals` and anomaly scoring) was never invoked. `OcrService`
  is now injected into `BatchSubmissionService` and `processDocument()` is called
  immediately after each document is persisted. The Fraud column now populates
  for all batch-uploaded claims.

- **`dateOfService` blank for admission invoices** — `dateOfService` /
  `admissionDate` zone-mapped values were not forwarded to the `serviceDate`
  claim field. The merge step now includes both aliases, ensuring service dates
  on admission forms are written to the claim record.

- **`sane` missing from production Docker image** — the `sane` package was
  installed in the builder stage but omitted from the runtime stage of
  `Dockerfile.prod`, causing `scanimage` to be absent in deployed containers.
  The scanner service returned `saneAvailable: false` and the UI showed a
  driver-not-installed warning even on hosts with a scanner attached.

---

## [1.9.2] - 2026-05-17

### Added

- **Multi-format dataset export** (`GET /api/claim-labels/export/csv`,
  `GET /api/claim-labels/export/excel`) — ML Labelling page now exposes a
  dropdown with three export formats:
  - **Excel (.xlsx)** — two-sheet workbook: full colour-coded dataset with
    auto-filter + Analysis Summary sheet (label averages, source breakdown,
    top-10 fraud signals). Recommended for analysts.
  - **CSV** — RFC 4180-compliant with UTF-8 BOM for correct Excel rendering.
    Universal compatibility with R, Python, and BI tools.
  - **JSON** — existing training-dataset format; unchanged, accessible at
    `/export` for ML pipeline ingestion.

- **Deep analysis tab on ML Labelling page** — pulls from
  `GET /api/claim-labels/analysis/deep` and renders six panels:
  1. Feature averages by label class — legitimate vs suspicious vs fraud across
     avg invoice amount, anomaly score, OCR confidence, and signal counts.
  2. Monthly label trend — stacked proportional bars per `YYYY-MM` bucket.
  3. Fraud rate by invoice amount — five tiers from 0–50k to 500k+.
  4. Fraud rate by OCR confidence — five tiers from <50% to ≥95%.
  5. Most frequent fraud signals — ranked by occurrence with per-signal fraud
     rate bar, identifying which rules fire most reliably.
  6. Label source breakdown — card grid showing counts by source
     (`fraud_confirmed`, `manual_review`, `auto_approve`, etc.).

- **Animated OCR processing panel** — replaces the plain spinner + file list
  shown during `ai_extracting` and `manual_processing` batch steps with a
  fully animated `ProcessingInsightCard` component:
  - Shimmer gradient progress bar tracks real percentage with smooth transition.
  - Scan-beam animation sweeps top-to-bottom on the active file card.
  - Pulse rings radiate from the Brain/Scan icon during processing.
  - Stage pipeline chips (`Reading → Extracting → Fraud Checks → Verifying`)
    shift from grey to active (spinner) to done (green checkmark) as progress
    crosses each threshold.
  - Rotating insight panel cycles through 10 educational facts every 5 seconds
    (fraud patterns, OCR quality tips, cross-provider analysis, ML model
    explanation) with a fade-slide transition and dot-position indicator.
  - Live stat pills show `X/N done` and average confidence in the header.

- **Expanded `/api/claims/statistics` response** — six new server-computed
  fields so the Dashboard never depends on a potentially-empty Zustand store:
  `avgAmount`, `providerCount`, `batchCount`, `aiExtracted`, `fraudHold`,
  `fraudConfirmed`. Dashboard stat cards (Avg Claim, Providers, Total Batches,
  AI Extracted, Approval Rate) now read from `serverStats` with the store as
  a fallback only.

### Fixed

- **Fraud detection inactive for batch-submitted claims** — batch claims are
  created as bare records and populated by OCR later. `ClaimsService.create()`
  — which runs `computeFraudSignals()` — was never called for batch claims, so
  the Fraud column showed `—` permanently. Fix: `OcrProcessor` now runs the
  full fraud detection pipeline (all four parallel queries + anomaly scoring)
  after each claim update, exactly as single-claim uploads do. KES 500,000
  round-amount claims, batch member velocity, and cross-provider duplicates
  are now flagged correctly.

- **`dateOfService` blank after OCR extraction** — when OCR found no service
  date in a document, `safeServiceDate` was `null` and the `|| undefined`
  shortcut in the Prisma update silently skipped writing the field.
  Fix: `safeServiceDate` now falls back to `new Date()` (upload date). The
  fraud-signal checker's existing 2-day guard prevents false positives.

- **Dashboard Avg Claim, Providers, Batches, AI Extracted showing 0** — these
  four stat cards derived from the Zustand claims store, which is empty when
  landing directly on the Dashboard without first visiting the Claims page.
  Fix: values are now server-computed and returned by the statistics endpoint.
  The Pending count was also corrected to include `submitted + under_review +
  incomplete` (previously only `submitted` was counted).

- **HTTP 500 on claim publish when `DATA_ENCRYPTION_KEY` is absent** —
  `encryptField()` threw an uncaught error when `DATA_ENCRYPTION_KEY` was not
  set. The Prisma middleware did not catch it, causing every claim creation or
  update touching `diagnosis` or `treatment` to return 500. Fix: `encryptField`
  now wraps the encryption block in try/catch — if the key is missing, it logs
  a warning and stores the value as plaintext so the application remains
  functional in development. The startup warning in `PrismaService` already
  alerts operators to set the key before production use.

- **Role guard 403 on ML Labelling page** — `GET /claim-labels/ml/factor-
  effectiveness` and `GET /claim-labels/ml/sidecar-weights` were restricted to
  `admin` and `fraud_officer` only. The ML Labelling page is accessible to
  `claims_officer` and `maker_checker`, causing `Promise.all` to reject and
  blank the entire page. Fix: both endpoints now include `claims_officer` and
  `maker_checker`; `Promise.allSettled` is used so a single 403 never blanks
  the page.

- **`npm run start:dev` crashing on Node 22** — NestJS CLI 11's watch runner
  spawns child processes as `node dist/main` (no `.js` extension) which fails
  consistently on Node 22.22.1. Fix: all npm start scripts now bypass the CLI
  runner — `start:dev` uses `ts-node --transpile-only` (already a project
  devDependency), `start:prod` uses `node dist/main.js` with explicit
  extension, and `start` builds first then runs.

### Changed

- **ML Labelling dataset table** — added OCR Confidence and Fraud Signals
  columns; anomaly scores are colour-coded (red ≥60%, amber ≥30%, green <30%);
  label distribution cards show percentage of total dataset alongside count;
  header shows progress note ("X more needed to calibrate") when below 50
  labelled claims.

- **`featuresSnapshot` now captures `fraudSignalTitles`** — `ClaimLabelsService.
  upsertLabel()` includes the list of fraud signal titles in the snapshot so the
  analysis panels can show which specific signals appeared on each labelled claim.

- **BatchUpload dropzone UI polished** — extraction mode selector, file list,
  and progress panel refined for cleaner layout and consistent spacing.

### Database

- No schema changes in this release.

---

## [1.9.1] - 2026-05-17

### Added

- **Hardware scanner support** — claims officers can now scan physical
  documents directly into the batch workflow via an attached TWAIN/SANE
  scanner without leaving the BatchUpload page.

  *Backend* — `ScannerModule` (`backend/src/scanner/`) exposes two
  authenticated endpoints:
  - `GET /api/scanner/devices` — enumerates connected devices via
    `scanimage -L`; returns vendor, model, SANE device ID, and a
    `saneAvailable` flag for actionable install guidance when the
    driver is absent.
  - `POST /api/scanner/scan` — drives `scanimage` at the requested
    resolution (75 / 150 / 300 / 600 DPI) and colour mode (Color /
    Gray / Lineart); wraps the raw PNG output in a single-page A4 PDF
    via pdfkit and streams it back as `application/pdf`. Both
    `resolution` and `mode` are validated against allowlists before
    reaching the shell; `deviceId` is re-validated against live device
    enumeration on every call to prevent injection.

  *Frontend* — `BatchUpload` gains a two-tab input source selector:
  **Upload Files** (existing dropzone, unchanged) and **Scan Document**
  (new scanner panel). The scanner panel detects devices on tab
  activation, shows a SANE install hint when the driver is missing, and
  surfaces inline errors (paper jam, scanner busy, etc.). A successful
  scan appends the PDF to the upload queue, switches back to the Upload
  tab, and feeds into the same AI OCR pipeline as any uploaded file.

- **Real-time Claims Aging dashboard** — `/workflow/aging` is now fully
  live:
  - WebSocket subscription to `sla:breach` and `claim:status` events
    triggers an immediate silent refresh when the backend marks a claim.
  - Per-row SLA progress bar (green → amber at 75 % → red at 100 %)
    and elapsed-time display tick forward every 60 s via a client-side
    delta accumulator, with no extra server round-trips.
  - Rows that transition from OK → Breached between fetches flash with
    a red ring for 2.5 s.
  - Pulsing green "Live" connection badge in the header; falls back to
    "Offline" when the WebSocket is disconnected.
  - Auto-poll every 60 s as a background fallback.
  - "Updated Xs ago" subtitle ticker.
  - Breaches-by-Stage chart now computed client-side (backend omits
    `stageBreakdown`); stage filter applied instantly without a
    round-trip.

### Fixed

- **Auto-assignment no longer fails claim saves on DB hiccup** —
  `autoAssignToMaker` is now wrapped in try/catch; failure is logged and
  the claim remains at `initial_review` for manual triage rather than
  returning a 500 to the frontend after the row is already committed.

- **`DATA_ENCRYPTION_KEY` validated at startup** — `PrismaService` logs
  a clear error at module init when the key is absent or not a valid
  64-character hex string. Run `openssl rand -hex 32` and set the value
  manually in the Render dashboard.

---

## [1.9.0] - 2026-05-17

### Added

- **Python ML scoring sidecar** (`ml-sidecar/`) — standalone FastAPI
  microservice that trains a `GradientBoostingClassifier` (scikit-learn) on
  the labelled claims dataset and exposes real-time fraud probability scores.
  Endpoints: `POST /train`, `POST /score`, `GET /weights`, `GET /health`.
  The NestJS backend calls the sidecar fire-and-forget at claim creation;
  if the sidecar is unreachable a built-in heuristic fallback activates
  automatically. Controlled by the `ML_SIDECAR_URL` environment variable.

- **`MlScoringService`** (`backend/src/claims/ml-scoring.service.ts`) —
  typed NestJS HTTP client wrapping the sidecar with a 5-second timeout and
  automatic heuristic fallback. Injected into `ClaimsService` so every new
  claim receives a gradient-boosting fraud probability score alongside the
  statistical anomaly score.

- **Cross-provider duplicate detection** (fraud signal #11, `critical`) —
  at claim creation, the backend queries for any existing approved/submitted
  claim for the same member number at a *different* provider on the same
  service date. A confirmed match is stored as a critical fraud signal and the
  claim is auto-routed to fraud review.

- **Procedure code unbundling detection** (fraud signal #12, `warning`) —
  detects overlapping procedure codes on claims for the same member within a
  rolling 7-day window, flagging the known unbundling pattern of splitting a
  single episode of care across multiple invoices to exceed benefit limits.

- **`ProviderAlias` model** — normalisation table mapping OCR-extracted
  provider name variants (lowercase, stripped punctuation) to their canonical
  `Provider` record. Eliminates false-positive provider-mismatch fraud signals
  caused by letterhead abbreviations and spelling differences. Aliases are
  registered automatically on first resolution and retrieved in O(1) via a
  unique index.

- **`FraudModelWeights` model** — audit-friendly persistence of calibrated
  per-factor anomaly weights. Each calibration run deactivates the previous
  active row and inserts a new one; older rows are retained for rollback and
  audit trail.

- **Anomaly factor #8 — Provider behavioral drift** — compares the
  provider's 30-day rolling average invoice amount against the prior 30-day
  window. A shift greater than 20% contributes to the anomaly score using the
  same parallel query batch as existing factors.

- **DB-backed weight calibration** (`AnomalyScoringService.calibrateWeights`) —
  reads all `ClaimLabel` rows with feature snapshots, computes a separation
  score per feature, normalises weights to a 0.05–0.45 range, and persists
  the result as an active `FraudModelWeights` row. The in-memory cache is
  invalidated immediately; weights reload from the database every hour.

- **Fraud verdict → label feedback loop** — `confirmFraud()` now writes a
  `fraud` label and `clearFraud()` writes a `legitimate` label to `ClaimLabel`
  with source `fraud_confirmed`. Every fraud-officer decision feeds the
  training dataset used by both the statistical scorer and the ML sidecar.

- **New ML admin API endpoints** (roles: `admin`, `fraud_officer`):

  | Method | Path | Description |
  |--------|------|-------------|
  | `GET`  | `/api/claim-labels/ml/factor-effectiveness` | Per-feature separation stats from labelled data |
  | `POST` | `/api/claim-labels/ml/calibrate-weights`    | Re-calibrate statistical scorer weights |
  | `POST` | `/api/claim-labels/ml/train-sidecar`        | Push labelled dataset to sidecar for GBM training |
  | `GET`  | `/api/claim-labels/ml/sidecar-weights`      | Feature importances from the fitted model |

### Fixed

- **Auto-assignment no longer fails claim saves** — `autoAssignToMaker` is
  now wrapped in a try/catch inside `ClaimsService.create`. A transient
  database error during post-commit assignment (common under batch-upload
  concurrency on Render free-tier) previously returned a 500 to the frontend
  even though the claim row was already committed, causing the frontend to
  treat a successful save as a failure. Auto-assignment is now best-effort;
  unassigned claims remain visible for manual triage at `initial_review`.

- **`DATA_ENCRYPTION_KEY` format validated at startup** — `PrismaService`
  now logs a clear error at module initialisation if the key is absent or
  not a valid 64-character hex string. Previously, misconfigured deployments
  only surfaced this as a 500 on the first claim containing a non-null
  `diagnosis` or `treatment` field. Note: Render's `generateValue: true`
  does not guarantee the required 64-hex-char format — set this key manually
  in the Render dashboard using `openssl rand -hex 32`.

### Changed

- **`resolveProviderByName`** replaces the inline provider lookup in
  `ClaimsService.create`. The three-step alias → fuzzy-match → auto-create
  chain is idempotent and race-safe via `upsert`.

- **`AnomalyScoringService` factor weights are data-driven** — all eight factor
  contribution caps are read from the active `FraudModelWeights` row at runtime
  (1-hour TTL cache) instead of hardcoded constants. `DEFAULT_WEIGHTS` serves
  as the fallback when no calibrated model exists.

- **`docker-compose.yml`** — `ml-sidecar` service added with a persistent
  `/data` volume for the trained model file. `ML_SIDECAR_URL` is pre-wired to
  the backend service environment.

### Database

- New table: `provider_aliases` — `alias UNIQUE`, `provider_id FK → providers`.
- New table: `fraud_model_weights` — `weights JSONB`, `is_active BOOL`,
  `fraud_count INT`, `legitimate_count INT`, `trained_at TIMESTAMPTZ`.

---

## [1.8.0] - 2026-05-16

### Added

- **ClaimsOfficerQueue page** — dedicated final-approval queue for Claims
  Officers showing all claims that have cleared maker-checker verification and
  are awaiting final sign-off. Supports inline document preview, approve /
  reject / return-to-maker-checker / return-to-provider / escalate-to-fraud
  actions, and notes capture per decision.
- **Three-party appeal message thread UI** — real-time conversation panel on
  every appeal record. Providers, Claims Officers, and Fraud Officers can
  exchange threaded messages directly in the appeal drawer, with per-role
  colour coding, sender badges, and timestamp display.
- **`GET /api/appeals/:id/messages` and `POST /api/appeals/:id/messages`
  endpoints** — backend API for the appeal message thread. Returns a
  chronological list of messages on an appeal and persists new messages from
  the authenticated user with their role stamped at write-time.
- **Fraud-confirmed appeal path** — providers can now open an appeal on a
  `fraud_confirmed` claim; the appeal is auto-routed to the fraud officer in
  addition to the claims officer for joint adjudication.

### Changed

- **Workflow stage names aligned across the full stack:**
  Completes the v1.7.0 model rename across every remaining backend service and
  all frontend UI strings.
  - `maker_review` → `maker_checker_review`
  - `checker_review` → `claims_officer_review` (the claims-officer final gate)
  - `final_approval` → `fraud_review` (reserved for active fraud investigations)
  - SLA default budget: `initial_review`=4 h, `maker_checker_review`=24 h,
    `claims_officer_review`=8 h, `fraud_review`=48 h.
  - `system-config` default keys renamed to `sla_hours_maker_checker_review`,
    `sla_hours_claims_officer_review`, and `sla_hours_fraud_review`.
  - `AssignmentService.getReviewerWorkload` stage filter updated to the new
    three-stage set.
  - `ClaimsService` inline auto-assignment writes `maker_checker_review`
    instead of `maker_review`.

- **Frontend RBAC and navigation refactor:**
  - `User.role`, `Claim.workflowStage`, and `ClaimApproval.level` TypeScript
    unions updated — `supervisor` and `checker` removed; `maker_checker` and
    `finance` added.
  - Sidebar navigation items and `App.tsx` route guards updated throughout:
    `supervisor` → `claims_officer`, `checker` → `maker_checker`, new `finance`
    role wired to Payment and Finance nav sections.
  - `ADMIN_ONLY` tightened to `['admin']` (was `['admin', 'supervisor']`).
  - Workflow dashboard stage cards and quick-action buttons updated to
    `maker_checker_review`, `claims_officer_review`, and `fraud_review`;
    linked to the new `/workflow/claims-officer` route.
  - `BulkActionsBar` `queueType` prop changed from `'maker' | 'checker'` to
    `'maker_checker' | 'claims_officer'`.
  - `useUnknownDocCount` badge guard corrected from `supervisor` to
    `maker_checker`.
  - Login quick-login panel and Register role dropdown updated: `supervisor` /
    `checker` replaced with `claims_officer` / `maker_checker` / `finance`.
  - `UserManagement`, `Profile`, `Reports` role colour maps and filter dropdowns
    updated; demo seed row for Sarah Wambui corrected to `claims_officer`.
  - Fraud-report recommendation text updated from "supervisor approval" /
    "supervisor queue" to "claims officer approval" / "claims officer queue".

### Fixed

- **Production login failure (Render static-site proxy):**
  Render's CDN does not proxy HTTP requests to external URLs — all `/api/*`
  calls from the browser fell through to the SPA catch-all and returned
  `index.html`. Users could not log in because the login response (and its
  `Set-Cookie` header) was never received by the frontend JavaScript.
  - `VITE_API_URL` in `render.yaml` changed from `/api` to the absolute backend
    origin `https://claimsflow-backend.onrender.com/api` so `installFetchProxy`
    and the axios client route calls directly to the backend.
  - Auth cookie changed from `SameSite=Lax` to `SameSite=None; Secure` in
    production so browsers honour the HttpOnly cookie on credentialed
    cross-origin requests (`withCredentials: true` / `credentials: 'include'`).
    Development retains `SameSite=Lax` through the Vite dev proxy.
  - Defunct `/api/*` and `/socket.io/*` CDN rewrite rules removed from
    `render.yaml`; the SPA catch-all is now the only frontend route rule.
- **ClaimsOfficer approve/return actions writing wrong `approvalStage`**
  (`claims_officer_review` was written as `checker`; corrected to
  `claims_officer`).
- **Dashboard stage card links** pointed at the removed `/workflow/maker` route;
  re-wired to `/workflow/checker` (maker-checker queue) and the new
  `/workflow/claims-officer` route.

### Migration

No new database schema changes in this release. Workflow stage renames are
code-only; the data migration shipped in the v1.7.0 migration
(`20260514000000_maker_checker_workflow_refactor`) already updated all
existing rows.

## [1.7.0] - 2026-05-14

### Added

- **`AppealMessage` model** — new table (`appeal_messages`) enabling three-party
  appeal conversations between providers, claims officers, and fraud officers.
  Each message records the sender's role at write-time so a later role change
  does not rewrite conversation history. Includes cascade-delete on the parent
  appeal and indexed on `appealId`, `senderId`, and `createdAt`.
- **Fraud-verdict fields on `Claim`** — `fraudVerdict`, `fraudVerdictAt`,
  `fraudVerdictBy`, and `fraudVerdictNotes` capture the fraud officer's
  explicit cleared/confirmed decision so the downstream claims-officer approval
  step can reference it. `claimsOfficerApprovedAt` and `claimsOfficerApprovedBy`
  record the final sign-off separately from the maker-checker check.
- **`finance` role** — new `Finance Officer` role with read access to claims,
  documents, providers, and full reports including export. Finance officers can
  view pending payments and payment advices but cannot modify workflow state.
- **`findClaimsOfficers` helper** in `MakerCheckerService` — enables direct
  fan-out of assignments and notifications to claims officers independently of
  the maker-checker pool.
- **Demo seed user `finance@cic.co.ke`** (Grace Njeri) added alongside the
  updated `sarah@cic.co.ke` (claims officer) and `checker@cic.co.ke`
  (maker-checker) entries.

### Changed

- **Role refactor — `supervisor` removed, replaced by `claims_officer`:**
  - All RBAC guards, controller decorators, and service queries that referenced
    `supervisor` now reference `claims_officer`.
  - `claims_officer` is now the **final invoice approver**, the appeals
    adjudicator, the policy plan and member manager, and the SLA escalation
    target.
  - `supervisor`-only user-management endpoints now require `admin` only.
  - Document annotation edit/delete guard updated from `supervisor` to
    `maker_checker` (the new document-QA owner).

- **Role refactor — `checker` removed, replaced by `maker_checker`:**
  - All controller decorators, service queries, and `claimApproval.level` values
    that used `checker` now use `maker_checker`.
  - `maker_checker` inherits all document annotation permissions the old
    `supervisor` role held (stamp, redaction, whiteout, all annotation types).
  - `findMakers()` and `findCheckers()` in `MakerCheckerService` now both
    resolve from the single `maker_checker` role pool.
  - `findOriginalMaker` renamed `findOriginalMakerChecker` and queries both
    `maker` and `maker_checker` level values to remain compatible with
    pre-migration approval rows.

- **Appeals notifications** — SLA breach and new-appeal WebSocket events are
  now routed to `claims_officer` sockets (previously `supervisor`). New-appeal
  events also fan out to `fraud_officer` sockets so fraud reviewers are notified
  when a fraud-verdict appeal arrives.
- **High-value claim fraud signal** — alert text updated from "supervisor
  approval" to "claims officer approval" to reflect the new role name.
- **`bulkReject` stage values** — internal `stage: 'checker'` string replaced
  with `stage: 'claims_officer'` so the bulk-rejection endpoint correctly
  records the approving role in the audit trail.
- **Demo simulate script** — `sarah@cic.co.ke` set to `claims_officer` and
  `checker@cic.co.ke` set to `maker_checker`.
- **Fraud backfill script** — exempt-roles list updated from
  `admin, claims_officer, supervisor, checker` to
  `admin, claims_officer, maker_checker, fraud_officer, finance`.

### Migration

Upgrade path from v1.6.x is handled by
`backend/prisma/migrations/20260514000000_maker_checker_workflow_refactor/migration.sql`:

1. `UPDATE users SET role = 'claims_officer' WHERE role = 'supervisor'`
2. `UPDATE users SET role = 'maker_checker'  WHERE role = 'checker'`
3. Removes `supervisor` and `checker` rows from `roles` and `role_permissions`.
4. Adds the six new columns on `claims` and creates the `appeal_messages` table.
5. Re-routes claims in the `final_approval` stage to `claims_officer_review`.
6. Renames `checker_review` and `maker_review` workflow stages to
   `maker_checker_review`.

The `claim_status_history` audit trail is intentionally left unchanged — it
preserves the original stage and role names for compliance immutability.

## [1.6.0] - 2026-05-13

### Added

- **GDPR / KDPA data-subject rights API** (`/api/gdpr/*`) — five new endpoints
  covering the full set of data-subject rights under GDPR Art. 15-22 and the
  Kenya Data Protection Act 2019 ss. 26-38:
  - `GET /gdpr/consents` — full consent history + current state per purpose.
  - `POST /gdpr/consents/grant` and `/withdraw` — granular consent management.
  - `GET /gdpr/export` — structured JSON export of every record linked to the
    requesting user (Art. 15 right of access + Art. 20 portability).
  - `DELETE /gdpr/account` — account erasure with anonymisation of identifying
    fields while preserving referential integrity of claim records required
    under Insurance Act 2017 s.83 (7-year retention).
  - `POST /gdpr/decision-review` — challenge an automated fraud/anomaly
    decision under Art. 22; creates a pending human-review request.
- **Consent ledger** (`ConsentRecord` model) — append-only table that records
  every consent grant or withdrawal with purpose, policy version, IP, and
  user-agent so the consent history is auditable end-to-end.
- **Data export tracking** (`DataExportRequest`) and **decision-review tracking**
  (`DecisionReviewRequest`) models for Art. 15/20 and Art. 22 SLA proof.
- **Soft-delete / erasure marker** (`User.deletedAt`) — login is blocked for
  erased accounts and identifying fields are replaced with anonymised tokens,
  while the database row is retained for regulatory compliance.
- **AES-256-GCM field-level encryption** (`common/services/field-encryption.ts`)
  for special-category personal data (diagnosis, treatment — GDPR Art. 9 /
  KDPA s.44-46). Ciphertext is versioned (`enc:v1:…`) to support future
  key-rotation migrations. Applied transparently via a Prisma middleware in
  `PrismaService` so call sites keep using plain string assignments.
- **PII redaction helpers** (`common/services/pii-redaction.ts`) — `redactEmail`
  and `redactPhone` applied across all service log output (notifications
  processor, email service, SMS service, email ingestion, maker-checker fan-out)
  to prevent personal data appearing in log aggregators and incident exports.
- **Consent capture at registration** — `AuthService.register` and
  `registerProvider` now create `ConsentRecord` rows (terms of service +
  privacy policy) in the same transaction as the user row, with IP address,
  user-agent, and policy version recorded. `RegisterDto` validates
  `acceptTerms: true` so the endpoint rejects unsigned registrations.
- **Privacy & Data tab** in the frontend Profile page — surfaces all
  data-subject rights in one place: download personal data export, withdraw or
  re-grant consent per purpose, and request account erasure with a typed
  confirmation phrase.
- **Global HTTP exception filter** (`common/filters/http-exception.filter.ts`)
  — stable JSON error envelope `{ statusCode, code, message, requestId,
  timestamp, path }` on every error response. 5xx responses log the underlying
  error server-side and return a generic message so stack frames and Prisma
  constraint names are never exposed to callers.
- **Request-ID middleware** (`common/middleware/request-id.middleware.ts`)
  — stamps every request with an `X-Request-ID` header (accepts a
  caller-supplied ID or generates a UUID v4), mirrors it in the response, and
  stashes it on `req.requestId` so the exception filter and logging interceptor
  can correlate logs across a request.
- **HSTS and Permissions-Policy headers** — `Strict-Transport-Security` with
  one-year `max-age`, `includeSubDomains`, and `preload` in production; a
  `Permissions-Policy` header disabling camera, microphone, geolocation,
  payment, and USB for all responses.
- **`/api/ready` readiness probe** — exercises Prisma and Redis with a 500 ms
  budget per dependency; returns 200 when all checks pass or 503 with a
  per-dependency status map when any dependency is unreachable. Skipped from
  rate limiting for the same reason as `/api/health`.
- **BullMQ job retry with exponential backoff** — global default of 5 attempts
  with a 5 s initial delay (doubling each attempt) so transient OCR provider
  failures and network blips are retried automatically before landing in the
  failed set.
- **GDPR compliance documentation suite** (`docs/gdpr/`):
  - `dpia.md` — Data Protection Impact Assessment (KDPA s.31 / GDPR Art. 35).
  - `ropa.md` — Record of Processing Activities (Art. 30).
  - `breach-notification-sop.md` — 72-hour regulator notification procedure.
  - `rbac-review-procedure.md` — quarterly least-privilege access review.
  - `backup-encryption.md` — key management and backup-encryption policy.
  - `tabletop-exercise.md` — annual breach simulation scenario.
  - `dpa-inventory.md` — third-party data processor inventory.
  - `docs/reports/generate_gdpr_report.py` — report generation script.
- **Privacy Policy contact details** — DPO phone number and registered office
  address (CIC Plaza, Mara Road, Upper Hill) are now populated; ODPC
  registration number updated to `ODPC.ENT.0123456`.

### Changed

- **SameSite cookie attribute** unified to `Lax` across all cookie
  set/clear operations (`/auth/login`, `/auth/logout`, `/gdpr/account`).
  The Render static-site rewrite proxies `/api/*` and `/socket.io/*` from the
  frontend origin to the backend, so the browser sees same-origin requests and
  `SameSite=Lax` is the correct CSRF-resistant choice. The prior
  `SameSite=None` (cross-site) setting is no longer required.
- **JWT_EXPIRES_IN** reduced from `7d` to `1d` in `render.yaml` and
  `backend/.env.example`. A 7-day token outlives the cookie by 6 days; since
  revocation is expiry-only (no server-side revocation list), a leaked token
  would remain valid long after logout. `1d` matches the cookie `maxAge`.
- **BigInt JSON serialisation** in `main.ts` changed from `Number(this)` to
  `this.toString()`. `Number()` silently truncates values above 2^53-1, which
  would corrupt large byte-count or future BIGINT monetary fields.
- **Activity-log sanitiser** (`activity-logging.interceptor.ts`) extended to
  walk nested objects recursively (capped at depth 6), match sensitive key
  names case-insensitively and by substring (`twoFactor`, `accessToken`,
  `authorization`, `cookie`, `backupCode`, `cvv`, `pin`, `otp`, `mfa`,
  `signature`), and redact Prisma update shapes (`{ set: '…' }`).
- **Excel export** migrated from SheetJS (`xlsx`) to ExcelJS across all three
  export surfaces (Reports, Claims, BatchUpload). SheetJS 0.18.x carries an
  open prototype-pollution advisory; ExcelJS is actively maintained and
  produces the same column-header, bold-first-row output.
- **Vite dev proxy** extended to forward `/socket.io` to the backend with
  WebSocket support (`ws: true`), matching the production Render rewrite.

### Fixed

- **Disabled two-factor auth stub files** (`two-factor.controller.ts.disabled`,
  `two-factor.service.ts.disabled`) removed from the repository. These were
  incomplete drafts that were excluded from compilation via the `.disabled`
  suffix but added noise to diffs and `grep` results.

### Security

- Consent is recorded atomically with user creation — a half-created account
  can never exist in the database without its corresponding consent record.
- Erased accounts are blocked from login via the `User.deletedAt` soft-delete
  check before bcrypt comparison, preventing timing-attack enumeration of
  erased emails.
- `DATA_ENCRYPTION_KEY` provisioned in `render.yaml` with `generateValue: true`
  — Render generates a unique 32-byte hex key on first deploy. Rotating the key
  requires a key-wrap migration; the deploy config documents this constraint.

### Changed

- **`Dockerfile.prod` boot chain** trimmed from 4 steps to 3:
  - Removed the one-off `prisma migrate resolve --rolled-back
    20260423220000_add_claim_branch` step. It was scaffolded for a
    historical migration failure that's long since resolved; running it
    every boot was harmless but noisy. Future migration recovery should
    be done interactively via `render shell`, not baked into boot.
  - Seed step (`node dist/prisma/seed.js`) is now **gated behind
    `RUN_SEED=true`**. The seed remains idempotent (all `upsert`), but
    re-running on every restart re-applies demo passwords and writes to
    the audit trail unnecessarily. Set `RUN_SEED=true` once for a fresh
    DB; leave unset otherwise.
- **Seed credential block** (`prisma/seed.ts`) is no longer printed when
  `NODE_ENV=production`. Listing demo emails alongside the literal
  `password: password123` in prod logs surfaces working credentials to
  anyone with read-only log access (log aggregators, support
  dashboards). Dev terminals still get the convenience list.

### Security

- **WebSocket CORS allowlist** (`notifications/events.gateway.ts`) now
  gates the localhost regex behind `NODE_ENV !== 'production'`,
  matching the REST CORS policy in `main.ts`. Previously the WS gateway
  accepted `Origin: http://localhost` in production too; this isn't
  remotely exploitable but represented a needless inconsistency with
  the REST side.

### Fixed

- **Health-check 429 / cold-start oscillation** — `/api/health` is now
  decorated with `@SkipThrottle({ global: true, auth: true })` so
  Render's edge probes don't count against the rate limiter. Symptom
  was alternating "Instance failed (HTTP 429)" / "Service recovered"
  events on Render every few minutes, with the browser seeing
  intermittent 502s during the kill-and-replace window. Probes share a
  small egress IP pool with the keep-warm workflow; together they trip
  the limiter, return 429, and Render marks the instance unhealthy.
  The names matter — `@nestjs/throttler@6`'s `SkipThrottle()` defaults
  to `{ default: true }`, which is a no-op against our named
  throttlers (`global`, `auth`), so each one has to be listed
  explicitly.

## [1.5.0] - 2026-05-12

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
- **Redis eviction policy** changed from `allkeys-lru` to `noeviction`
  in `render.yaml`. BullMQ requires `noeviction` — any other policy
  risks silently discarding queued jobs under memory pressure, which
  causes batch submissions and email notifications to vanish without
  error traces.

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

[Unreleased]: https://github.com/Makaly/claimsflow/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/Makaly/claimsflow/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Makaly/claimsflow/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Makaly/claimsflow/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Makaly/claimsflow/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Makaly/claimsflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Makaly/claimsflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Makaly/claimsflow/releases/tag/v1.0.0
