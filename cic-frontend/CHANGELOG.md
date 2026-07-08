# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Dedicated `/testlogin` route for demo sign-in** — the demo-account role
  chooser (Admin, Claims Officer, Maker-Checker, Finance, Fraud Officer,
  Provider Admin, Provider User) moved off the production login onto a new
  `/testlogin` route. The page reuses the same `Login` component behind a
  `showDemo` prop and is visibly badged "Test environment" so demo sessions
  are never mistaken for production sign-ins.

- **Human photography across the landing and login surfaces** — the marketing
  pages now lead with people instead of abstract art, mirroring the imagery
  language of ke.cicinsurancegroup.com ("We keep our word" / "Walking with
  you"). CIC Group's own hero photography (family, couple, retirees, pharmacy
  team, Nairobi skyline) was mirrored locally as optimised WebP under
  `public/images/` and used in: a new hero composition (family photo with the
  dashboard art and a "claim settled" chip floating over it), a photo strip in
  the Solutions band, a new "Walking with you" people section with persona
  testimonial cards, a clinician-with-phone backdrop in the mobile section, a
  care photo beside the trust band, and a Nairobi-at-dusk backdrop under the
  final CTA. The login brand panel now sits over the pharmacy-team photo
  behind a dark wash. All imagery is centralised in `landing/data.ts`
  (`PEOPLE`, `TESTIMONIALS`) so it can be re-themed by swapping files in
  `public/images/` without touching layout code.

### Changed

- **`/login` is now a clean production sign-in** — email, password,
  remember-me, and the registration links only; no demo credentials are
  rendered on the route users reach from the landing page. The e2e smoke
  suite asserts both behaviours: the demo chooser is absent on `/login` and
  present on `/testlogin`.

- **Marketing photography re-curated toward candid, authentically African
  imagery** — the five stock-looking photos (beach family, staged kitchen
  couple, sunset retirees, posed pharmacy duo, US-style clinic scene) were
  replaced with candid, editorial-style shots of African subjects: a laughing
  family in a park (hero), a family checking a tablet on their sofa
  (`members-family.webp`, was `members-couple.webp`), a grandmother embraced
  by her grandson (`life-stages.webp`, was `retired-couple.webp`), a
  pharmacist at his dispensary counter, and a nurse in scrubs at a clinic.
  Alt text and the branding guide's imagery table updated to match.

- **Dev/preview API proxy retargeted to port 4001** — the Vite `server.proxy`
  for `/api/*` and `/socket.io` now points at `http://localhost:4001` to match
  the backend's port, and the same proxy is mirrored under `preview` (Vite
  does not inherit `server.proxy` there) so `vite preview` builds can reach
  the backend locally. Getting-started docs updated to match.

- **Residual indigo accents recolored to the CIC maroon ramp** — a final
  sweep replaced the leftover indigo (`#6366f1`) and blue accents that the
  initial rebrand missed: comment/annotation avatars, badges and tab counters
  in `DocumentViewer`, the active-annotation highlight in `InlinePdfViewer`,
  zone-drawing outlines and segment colours in `DocumentClassifierEditor` and
  `Documents`, chart series colours in `Dashboard`, `Reports` and
  `WorkflowDashboard`, and the signature-pad ink in `BatchUpload` (now a deep
  brand maroon `#5c1118`). Semantic status colours remain untouched.

- **CIC Group corporate rebrand** — the whole UI now carries the CIC Insurance
  Group identity. Design tokens (`--primary`, `--ring`, charts) and the
  Tailwind `brand`/`cta` ramps switched from the blue/indigo palette to the
  CIC maroon (`#AC202D`) and gold (`#F9BF13`) taken from the official logo;
  every button, link, focus ring and gradient that used blue/indigo now uses
  the brand ramp. The official CIC Group logo replaces the placeholder
  "C"/shield marks in the sidebar, all auth pages and the landing page, and
  the favicon, PWA manifest and `theme-color` were refreshed to match. Status
  colours (red/amber/emerald) and the violet AI accents are unchanged. See
  `docs/branding.md`.

### Added

- **Job Setup user assignments** — admins can now restrict which users or providers see a given job setup via a new **Assigned Users** tab in the setup editor. A searchable dropdown (opens on focus, filters by name / email) lists all available users; assigned users are displayed with a badge chip and can be removed inline. Job setup cards show the assigned user count (`N users` / `all users`). Setups with no assignments remain visible to everyone for backwards compatibility.

- **Gated batch upload flow** — the Upload page now enforces a structured three-step entry: (1) optional batch name, (2) job setup selection, (3) file browse / scan. The dropzone and scanner panel are locked behind a placeholder until a job setup is chosen, preventing accidental uploads without a classification context.

- **Billing audit `pending` state** — `InvoiceBillingAudit` accepts a new `pending` flag from the API. When the backend is still computing the audit in the background the component displays a loading indicator and polls until the result is ready, eliminating the previous indefinite blank state on first open.

### Changed

- **`BatchUpload`** — added a "Batch name" input field at the top of the upload card so operators can label a batch before selecting files.

### Added

- **Checker Queue — inline OCR field editor, zone capture, and document audit
  trail** (`src/pages/CheckerQueue.tsx`, `src/components/InlinePdfViewer.tsx`)
  — all nine standard OCR fields are now shown in the detail panel regardless
  of extraction success; each field is editable inline (text / number / date
  input) and saves to the backend via `PATCH /claims/:id/ocr-corrections`.
  Confidence score badges and anomaly/missing indicators guide the maker-checker
  to fields that need attention. A "📷 OCR" button per field launches zone
  capture: drag a rectangle over the embedded PDF, Tesseract reads it, and the
  result auto-fills the editor. Per-field correction history expands below each
  field showing who changed it, when, and the old → new values. The Document
  Indexing section gains an indexing-notes textarea (auto-saves on blur) and a
  collapsible audit trail with actor, timestamp, and field-level diffs.
  `InlinePdfViewer` gains a `zoneMode` prop with drag-to-capture rectangle,
  canvas crop + upscale, `/ocr/zone-text` round-trip, Esc-to-cancel, and a
  status banner.

- **Scan metering hook and Batch Upload UI gate** — new
  `hooks/useScanMetering` calls `GET /scan-metering/check` on mount and
  exposes `enabled`, `costPerScan`, `currency`, and a `recordScan(meta)`
  helper to the rest of the app. `BatchUpload` consumes the hook to:
  (a) refuse to start a scan when the user's organization has scanning
  disabled, surfacing a red banner instead of an opaque error;
  (b) show a small "Each scan is billed at KES X.XX …" chip when scanning
  is enabled and priced; (c) record scan events from the in-browser
  paths (local agent + camera) that the backend never sees. The
  server-side `/scanner/scan` path is already metered server-side, so the
  frontend skips `recordScan` there to avoid double-counting.

- **`lib/deviceInfo.ts` device classification helper** — derives a coarse
  `deviceClass` (`desktop` / `mobile` / `camera`) and normalized OS string
  from `navigator.userAgentData` with a UA-string fallback, so scan events
  carry enough channel information for the dashboard breakdown without
  any heavy fingerprinting.

- **Scan-agent hostname forwarded to the metering log** — `BatchUpload`
  reads `hostname` from the local agent's `/health` response (now exposed
  in scan-agent ≥ 1.0.0) and includes it on every recorded scan event so
  the dashboard can attribute scans to specific physical machines.

- **Admin: scan-billing editor** — new `components/ScanMeteringEditor`
  (enable/disable Switch, currency Select, per-scan price Input,
  Save/Reset buttons) is reachable from two places: a new
  **Settings → Scan Billing** tab (`components/ScanMeteringTab`) that
  lists every provider and lets admins edit any of them, and a new
  **Providers → \[Provider\] → Scan Billing** sub-tab that opens the
  same editor scoped to one provider. Saves issue
  `PATCH /scan-metering/settings/:providerId` and reflect the change in
  the table without a full reload.

- **Scan Metering dashboard page (`/scan-metering`)** — new
  `pages/ScanMeteringDashboard` shows today / 7-day / 30-day aggregates,
  a per-provider month-to-date breakdown (admin/finance only), and the
  50 most recent scan events with device class, OS, machine hostname,
  and outcome badges. Routed from `App.tsx` behind `ProtectedRoute`
  (admin, finance, provider_admin, claims_officer, maker_checker,
  fraud_officer) and surfaced in the sidebar under **Finance**.

- **`formatCurrency` accepts a currency code** — `lib/utils.ts`
  `formatCurrency(amount, currency?)` now defaults to KES but can render
  any ISO-4217 code (used by the metering dashboard so non-KES providers
  show the correct symbol).

- **Per-OS scan-agent install commands in the Scan Document tab** — the
  scanner-pairing panel in `BatchUpload` now renders separate cards for Linux
  and macOS, each with a copy-to-clipboard `curl … | bash` one-liner that
  points at the new prebuilt installer published with the `scan-agent-latest`
  GitHub release. Together with the existing Windows `.exe` card, all three
  desktop install paths are reachable in one click. The clipboard interaction
  is handled by a new local `InstallSnippet` component with a short-lived
  "copied" confirmation state.

### Changed

- **Site-wide migration from `fetch` to Axios (`api` instance)** — all manual
  `fetch` call sites across `BatchUpload`, `Branches`, `CheckerQueue`,
  `Claims`, `Header`, `MakerQueue`, `Profile`, `ProviderDashboard`,
  `ProviderOnboarding`, `Providers`, and `UserManagement` have been replaced
  with the shared `api` Axios instance (`withCredentials: true`). Benefits:
  - Auth cookie is forwarded automatically on every request; no more
    `localStorage.getItem('token')` scattered across components.
  - The existing `401` response interceptor handles session expiry in one
    place: it calls `authStore.logout()` then redirects to `/login`, preventing
    the previous pattern of each component doing its own partial cleanup.
  - Error messages now surface structured `err.response.data.message` from the
    backend instead of falling back to generic HTTP-status strings.

- **`authStore.logout()` is now async** — the logout action calls
  `POST /auth/logout` to clear the server-side HttpOnly cookie before wiping
  local state. If the server is unreachable the cookie expires naturally;
  local state is cleared regardless.

- **`api` interceptor avoids infinite 401 loops** — the 401 handler now skips
  `/auth/logout` and `/auth/login` URLs so a failed logout or bad-credentials
  login no longer triggers a recursive redirect cycle.

- **`App` profile validation on every boot** — `fetchProfile()` is called once
  on mount unconditionally (not just when `user` is null), so a stale cached
  profile whose HttpOnly cookie has since expired is caught and cleared on the
  next page load.

- **`rememberMe` wired end-to-end** — `Login` page passes `rememberMe` to
  `authService.login()`; the `LoginCredentials` type gains an optional field;
  the backend sets a 30-day cookie when the flag is true.

- **Scanner device cards redesigned** (`BatchUpload`) — both scanner list
  panels (desktop sidebar and mobile tab) now render rich device cards with a
  coloured icon square (violet + `Printer` for USB/SANE; blue + `Wifi` for
  network scanners), a driver protocol badge (`SANE`, `WIA`, `TWAIN`, `NAPS2`,
  `eSCL`, `AirScan`) in accent colours derived from `getScannerMeta()`, a
  custom dot-in-ring radio indicator, and the agent hostname shown in the panel
  header. A scanner count badge appears next to "Connected Scanners" when
  devices are present.

- **Stale agent liveness re-check before scan** (`BatchUpload`) — a 1.5-second
  `AbortSignal.timeout` ping to `/health` runs immediately before every scan;
  if the agent has stopped since the page loaded, `agentAvailable` is cleared
  and the request routes to the cloud backend rather than surfacing a raw
  network error.

### Added

- **Scan preview & approval dialog** (`BatchUpload`) — after the local scan
  agent returns a PDF, a modal opens with a full pdf.js canvas renderer, page
  navigation arrows, and ±25% zoom. The operator approves (adds to upload
  queue + session cache), rescans, or cancels — preventing misfeeds and blank
  pages from entering the processing pipeline silently.

- **`getScannerMeta(device)` helper** — pure function that derives
  `{ isNetwork, driverLabel }` from a `ScannerDevice` record. Handles
  `airscan:` → AirScan, `escl:` → eSCL, `naps2-wia` → WIA,
  `naps2-twain` → TWAIN, `naps2*` → NAPS2, default → SANE. Shared by both
  scanner card render paths so driver-badge logic stays in one place.

- **Scan agent version check and in-app upgrade banner** (`BatchUpload`) —
  the `version` field from `GET /health` is compared against
  `AGENT_MIN_VERSION` (`1.1.0`). When the agent is older, an amber banner
  appears with the current / required versions and OS-aware download links
  (Windows `.exe` or Linux/macOS shell script) so operators can upgrade
  without filing a support ticket.

- **Firefox-compatible no-body POST for scan requests** (`BatchUpload`) —
  `POST /scan` now passes parameters as query-string fields with no request
  body, avoiding the CORS preflight that Firefox refuses to send to an HTTP
  localhost origin from an HTTPS page. Works in all browsers unchanged.

### Planned
- Unit and integration test suite (Vitest + React Testing Library)
- End-to-end tests (Playwright)
- i18n / localisation support
- Progressive Web App (PWA) offline mode
- WebSocket-based real-time queue updates

---

## [1.0.3] — 2026-05-12

### Fixed

- **Service date extraction** (`pdfTextExtract`, `BatchUpload`) — `serviceDate` was previously hardcoded to the date of upload/processing when not found in the document. It now correctly falls back to `invoiceDate` from the extracted data, and ultimately to an empty string so missing dates are surfaced rather than silently fabricated. This prevents incorrect service dates from being persisted against submitted claims.
- **Vision model auto-selection** (`BatchUpload`) — when no previously stored model is available, the model picker now selects the highest-priority available tier (`best → recommended → fast → local → fallback`) rather than taking the first model returned by the API, which could be a lower-quality option. The server `defaultModel` hint still takes precedence when provided.

---

## [1.0.2] — 2026-05-10

### Fixed

- **OCR zone endpoint** (`DocumentViewer`, `BatchUpload`) — zone-crop OCR now calls the dedicated `/ocr/zone-text` backend endpoint instead of `/ocr/extract`. The extract endpoint runs full invoice-structure parsing and returns text under `data.invoices[0].rawText`; it never matched arbitrary zone crops. The zone-text endpoint returns plain Tesseract output under `data.text`, which is what zone selection needs. Response parsing updated accordingly. Client-side Tesseract fallback is unchanged.

---

## [1.0.1] — 2026-05-10

### Fixed

- **OCR zone-crop accuracy** (`DocumentViewer`, `BatchUpload`) — small selection zones (width < 200 px or height < 60 px) are now upscaled 3× before being sent to Tesseract; mid-size zones (< 400 × 120 px) are upscaled 2×. Bilinear smoothing (`imageSmoothingQuality: 'high'`) is applied during upscaling. This resolves near-zero recognition rates on narrow fields such as invoice numbers and dates.
- **Tesseract fallback always fires** (`DocumentViewer`, `BatchUpload`) — previously the client-side Tesseract.js path was only reached when the backend OCR request threw an exception. The backend `/ocr/extract` endpoint returns `rawText` only for full-invoice submissions, not arbitrary zone crops, so the fallback was silently skipped for all zone selections. The condition is now `if (!extractedText)` instead of a catch clause, ensuring Tesseract always runs when the backend returns no usable text.

### Changed

- **Batch upload claim list** — extracted claims are now sorted with fully-indexed claims (no missing fields) at the top, followed by incomplete claims. Within each group, claims are sorted by descending AI confidence score. Section headers ("Complete" / "Incomplete") are injected before each group to aid review.
- **Missing-field badge** (`BatchUpload`) — refined visual treatment: `rounded-md`, slightly larger horizontal padding, `shadow-sm`, and per-claim field-score badge with colour-coded completeness state (emerald / amber / red).

---

## [1.0.0] — 2026-05-10

Initial production release of the CIC Medical Claims frontend.

### Added

#### Authentication & Security
- JWT-based authentication with automatic Bearer token injection via Axios interceptor
- Automatic session invalidation and redirect to `/login` on 401 responses
- TOTP two-factor authentication with QR code setup flow (`TwoFactorSetup` page)
- Password reset flow with email verification (`ForgotPassword` page)
- User registration page (`Register`)

#### Role-Based Access Control
- Seven distinct roles: `admin`, `supervisor`, `claims_officer`, `checker`, `fraud_officer`, `provider_admin`, `provider_user`
- `ProtectedRoute` component in `App.tsx` enforcing role-based route access
- Sidebar navigation with role-conditional visibility
- Granular permission management UI (Roles, Permissions pages)

#### Claims Management
- Full claim lifecycle: `submitted → under_review → approved / rejected → paid`
- Claims list page with search, filter by status/priority, and pagination
- Claim detail view with attached documents (`ClaimPacketViewer`)
- Priority system: `urgent`, `high`, `normal`, `low`
- Barcode-based claim identification
- Rejection with mandatory reason and return-to-maker capability

#### Maker / Checker Workflow
- `MakerQueue` — initial claims review for `claims_officer` role
- `CheckerQueue` — four-eyes validation queue for `checker` role
- `FraudQueue` — fraud investigation queue for `fraud_officer` role
- `WorkflowDashboard` — queue depth metrics and throughput charts
- Approval decisions stored with stage, user, and timestamp (`ClaimApproval`)

#### Provider Management
- Provider registration with type classification (`hospital`, `clinic`, `pharmacy`, `lab`)
- Multi-step onboarding flow with document collection (`ProviderOnboarding`)
- Admin onboarding packet review (`OnboardingPacketReview`)
- Provider approval/rejection workflow (`ProviderApprovals`)
- Branch management for multi-site providers (`Branches`)
- Provider-scoped dashboard for `provider_admin` / `provider_user` roles

#### Document Management
- Drag-and-drop document upload (`react-dropzone`)
- Client-side OCR processing via Tesseract.js (no server round-trip)
- Rich PDF viewer with 11 plugins: highlight, search, annotations, print, thumbnail, full-screen, rotate, scroll mode, selection mode, bookmark, and toolbar
- Canvas-based annotation and markup tools (`AnnotationCanvas`)
- Document type classification engine (`DocumentClassifiersTab`, `DocumentClassifierEditor`)
- Unknown document resolution queue (`UnknownDocuments`)
- Inline and modal PDF preview components

#### Batch Processing
- CSV / Excel bulk claim upload (`BatchUpload`)
- Per-row processing status and real-time progress bar
- Failed row identification and reporting
- Batch session state management via Zustand (`batchSessionStore`)

#### Reporting & Analytics
- Executive `Dashboard` with KPI cards (total claims, pending, approved, rejected, amounts)
- Trend charts and workflow throughput visualisation (Recharts)
- Exportable reports as XLSX (xlsx library) and PDF (pdf-lib)
- Full `ActivityLogs` audit trail with user, action, entity, IP, and timestamp

#### User Management
- Admin user CRUD (`UserManagement`)
- Role assignment per user
- Extended profile fields: phone, job title, department, location, timezone, language, bio, avatar
- User `Profile` self-edit page

#### UI / UX
- Responsive app shell: collapsible `Sidebar` + `Header` + route `Outlet`
- Dark / Light mode with `localStorage` persistence (`themeStore`)
- Toast notification system (Sonner)
- 18 accessible Radix UI primitive components (Button, Card, Dialog, Input, Select, Table, Tabs, Badge, Avatar, Checkbox, DropdownMenu, Label, Progress, ScrollArea, Separator, Switch, Textarea, Tooltip)
- `Terms of Service` and `Privacy Policy` public pages

#### Infrastructure
- Vite 5 dev server on port 3000 with HMR
- `/api/*` proxy to `http://localhost:4000` (no CORS config needed in dev)
- `@/` path alias mapped to `src/`
- Dockerfile for containerised development
- GitHub Actions CI pipeline (lint → build → audit → artifact upload)
- GitHub issue templates (bug report, feature request)
- Pull request template
- `.env.example` with all required variables documented

---

[Unreleased]: https://github.com/Makaly/invoice_frontend/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/Makaly/invoice_frontend/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Makaly/invoice_frontend/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Makaly/invoice_frontend/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Makaly/invoice_frontend/releases/tag/v1.0.0
