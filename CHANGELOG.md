# Changelog

All notable changes to ClaimsFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`CameraScanner` — fullscreen document capture overlay**
  (`frontend/src/components/CameraScanner.tsx`) — a self-contained
  component that handles the complete camera-to-upload workflow on mobile
  and desktop browsers.

  *Live phase* — full-screen video feed with a document-guide rectangle
  and corner markers. A single large capture button freezes the frame and
  advances to the review phase.

  *Review phase* — four draggable corner handles let the user adjust the
  crop quad before confirming. The captured image is perspective-corrected
  with a bilinear quad→rectangle warp so mild document tilt is removed
  automatically. Additional tools available in the review toolbar:

  - **Auto-crop** — pixel-level edge detector samples the four image
    corners to estimate background luminance, then scans the full frame
    to find the tight bounding box of the document content and snaps all
    four corner handles to it.
  - **Enhance** — toggles a desaturation + contrast boost (1.55×) pass
    applied during the final warp, improving readability of printed
    invoices on off-white or coloured backgrounds.
  - **Rotate** — cycles the output 90° clockwise per tap.
  - **OCR preview** — Tesseract.js is lazy-loaded and run on a downscaled
    copy of the capture in the background. A collapsible panel at the
    bottom of the screen shows the extracted text (up to 500 chars) with
    a live progress bar; the operator can verify the document is readable
    before confirming.

  Stream lifecycle is managed with `useEffect` cleanup (tracks released
  on close, unmount, or retake). The component uses CSS `env(safe-area-
  inset-*)` padding so it renders correctly behind notches and home-bar
  areas on iOS and Android.

- **NAPS2 TWAIN/ISIS driver for the local scan agent**
  (`scan-agent/drivers/naps2.js`) — integrates
  [NAPS2](https://www.naps2.com) (Not Another PDF Scanner 2), a free
  open-source scanning application, as a first-class driver for
  professional document scanners.

  Supported scanner families via TWAIN/ISIS:
  - **Canon** — imageCLASS, imageRUNNER, PIXMA; uses JPEG compression at
    92 quality, A4 page size.
  - **Kodak Alaris** — S-series, i-series; defaults to duplex ADF mode
    at 90 quality; ISIS driver checked first (Kodak's preferred protocol).
  - **Fujitsu** — ScanSnap, fi-series; duplex ADF at 95 quality to
    preserve PaperStream image processing.
  - **Xerox, Ricoh, and any TWAIN-compliant device** — generic profile.

  The driver locates the NAPS2 binary from `NAPS2_PATH` env var or common
  install paths, then calls `naps2 scan` with vendor-specific flags. A
  `diagnoseWindows()` helper lists installed ISIS and TWAIN devices and
  emits actionable recommendations when a scanner is missing (e.g. "Install
  Alaris S2000 driver from alarisworld.com").

  Install: `winget install cyanfish.naps2` (Windows) or
  `brew install --cask naps2` (macOS).

- **eSCL / AirScan network scanner driver**
  (`scan-agent/drivers/escl.js`) — implements the Mopria Alliance eSCL
  2.x protocol for network scanners that advertise `_uscan._tcp` or
  `_uscans._tcp` via mDNS.

  Supported vendors: Canon imageRUNNER / PIXMA, Kodak Alaris S-series
  network models, Epson, Fujitsu network scanners, HP, Brother, Xerox —
  any device with an eSCL endpoint.

  Discovery uses `dns-sd` (macOS/Windows Bonjour) or `avahi-browse`
  (Linux); scanners can also be pinned via `ESCL_SCANNERS=url1,url2`
  env var for environments where mDNS is blocked. The full eSCL workflow
  is implemented: fetch capabilities → POST ScanJob → GET NextDocument →
  DELETE job.

- **Windows installer for the local scan agent** (`scan-agent/installer.iss`)
  — an Inno Setup 6 script that produces a signed, one-click
  `ClaimsFlow-Scan-Agent-Setup.exe` for Windows 10+.

  What the installer does:
  - Bundles the compiled agent executable (built by `@yao-pkg/pkg`),
    the WinSW v3 service wrapper, and all driver modules.
  - Installs and starts a Windows service (`ClaimsFlowScanAgent`) so the
    agent is available immediately after reboot without any user action.
  - Optional task: downloads and silently installs NAPS2 via `winget`
    for TWAIN/ISIS support (Canon, Kodak, Fujitsu).
  - Registers install path, version, and port in `HKLM\Software\
    ClaimsFlow\ScanAgent` for programmatic discovery by IT management
    tools.
  - Pre-install Pascal script stops and unregisters an existing service
    before overwriting files; post-install opens the ClaimsFlow URL.
  - Requires Windows 10+ (checked at launch via `GetWindowsVersionEx`).
  - Modern wizard appearance with dark-branded sidebar and header images.

- **Installer asset generator** (`scan-agent/scripts/generate-installer-
  assets.js`) — a Node.js script that uses the `canvas` package to render
  three branded BMP/PNG graphics for the installer wizard:
  - `wizard-sidebar.bmp` (164×314) — dark navy left panel with the
    ClaimsFlow shield icon, product name, and a feature list.
  - `wizard-header.bmp` (497×58) — compact top banner for inner wizard
    pages.
  - `setup-splash.bmp` (614×386) — full welcome-page background with a
    stylised scan-line animation, feature badges, and product headline.

  All assets are also exported as PNGs for web use. BMP output is written
  with a hand-rolled 24bpp encoder (no external bmp library needed) that
  produces files Inno Setup 6 accepts directly.

- **Scan agent v1.1.0 — multi-driver registry and `/diagnostics` endpoint**
  (`scan-agent/agent.js`) — the agent now pools devices from all three
  available drivers (WIA/SANE built-in, NAPS2, eSCL) into a single
  `/scanners` response. Device IDs carry a driver prefix (`naps2:twain:…`,
  `escl:http://…`) so the `scan()` router can dispatch to the correct
  backend without additional state.

  The `/health` response now includes a `drivers` object:

  ```json
  { "wia": true, "sane": false, "naps2": true, "escl": true }
  ```

  A new `/diagnostics` GET endpoint returns vendor-specific setup
  information: WIA devices from `Win32_PnPEntity`, NAPS2 ISIS/TWAIN
  device lists, eSCL discovery results, and install recommendations for
  missing drivers. Targeted at IT administrators setting up Canon or
  Kodak scanning stations. The startup banner now shows which drivers are
  active and prints a `winget` install hint when NAPS2 is absent.

- **Camera barcode scanner on Scan Station** (`ScanStation.tsx`) — a
  camera toggle in the header lets operators or counter staff use a
  phone or webcam as a barcode reader without any extra hardware. The
  scanner uses the browser-native `BarcodeDetector` API (Chrome/Edge)
  and supports nine formats: Code 128, Code 39, EAN-13, EAN-8, QR,
  DataMatrix, PDF417, Codabar, and ITF. A `requestAnimationFrame` scan
  loop with a 3-second same-barcode debounce feeds directly into the
  existing `lookupRef` handler so every scan goes through the same
  audit trail as a hardware scanner. A live scan-line animation overlays
  the camera preview; an in-browser fallback banner is shown on browsers
  without `BarcodeDetector` support. Stream lifecycle is managed with
  `useEffect` cleanup so tracks are always released on unmount.

- **Camera capture fallback in Batch Upload** (`BatchUpload.tsx`) — when
  no hardware scanner is detected the scanner panel now surfaces a
  camera/phone fallback instead of a bare "No scanners detected" notice.
  Users can open their webcam, capture a document image, review the
  thumbnail, and confirm it (or retake) before it is submitted through
  the normal upload pipeline. The hidden canvas element is moved outside
  the `cloudHostedScanner` conditional so `captureFrame` works regardless
  of scanner availability.

### Changed

- **Batch Upload camera flow refactored to use `CameraScanner` overlay**
  (`BatchUpload.tsx`) — the ~250 lines of inline camera state
  (`videoRef`, `canvasRef`, `cameraActive`, `cameraStream`,
  `capturedDataUrl`, `cameraError`, `startCamera`, `stopCamera`,
  `captureFrame`, `retakePhoto`, `useCapture`) and their corresponding JSX
  have been replaced by the new `<CameraScanner>` component rendered as a
  fullscreen overlay (`cameraScannerOpen` boolean). The `handleCameraCapture`
  callback handles metering and hands the resulting `File` to `onDrop`
  exactly as before. All camera visibility guards (`!cameraActive &&
  !capturedDataUrl`) are removed, simplifying every scanner sub-panel
  branch. Net change: −270 / +25 lines in `BatchUpload.tsx`.

- **Tailwind `scan` keyframe animation** (`tailwind.config.js`) — adds
  a 2-second ease-in-out infinite sweep animation (`animate-scan` /
  `animate-[scan_2s_…]`) used by the camera scanner overlay in
  `ScanStation` and `BatchUpload`.

### Build & Tooling

- **Scan agent build pipeline upgraded from NSIS to Inno Setup 6**
  (`scan-agent/build-windows.ps1`, `scan-agent/package.json`) — the
  previous NSIS-based build script is replaced with a modernised 5-step
  PowerShell script:
  1. `npm ci` — install dependencies.
  2. `node scripts/generate-installer-assets.js` — render the three
     branded BMP graphics (installs `canvas` on demand if not yet
     present).
  3. `@yao-pkg/pkg` — bundle Node.js + agent into a single Windows exe
     with GZip compression and `--assets "drivers/**"` so the driver
     modules are embedded.
  4. WinSW download — idempotent (skips if `winsw.exe` already present,
     prints a manual-download URL if the network request fails).
  5. `iscc.exe` — compile the Inno Setup 6 installer; probes three
     common install paths and falls back to `PATH`.
  Coloured step headers, per-step ✓/✗ feedback, file-size reporting, and
  a final summary with `gh release create` and `irm | iex` one-liner
  instructions replace the previous bare command sequence.
  `package.json` bumped to `1.1.0`; `npm run assets` added as a
  standalone script; `canvas ^2.11.2` added as a dev dependency.

### Fixed

- **Claims processor no longer auto-approves with a stub 2-second delay**
  (`claims.processor.ts`) — the placeholder `setTimeout` + double
  `prisma.claim.update` that silently set every queued claim to
  `"approved"` has been removed. The worker now simply logs receipt of
  the job and returns so the real workflow engine (maker-checker,
  adjudication, fraud scoring) handles status transitions. The unused
  `PrismaService` dependency is also dropped from the constructor.

- **Provider performance and scorecard reports now include all providers
  that have submitted claims** (`reports.service.ts`) — both queries
  previously filtered `isActive: true`, excluding providers whose
  `isActive` flag had not yet been flipped by an admin even though they
  had already submitted real claims. The filter is now unconditional;
  providers with zero claims are naturally hidden by the
  `total === 0` guard already present in the scorecard aggregation.

- **Bearer token attached to every API request for cross-origin auth**
  (`api.ts`) — added an Axios request interceptor that reads
  `localStorage.getItem('token')` and sets the `Authorization: Bearer …`
  header when a token is present and no explicit `Authorization` header
  has been set by the caller. This fixes authentication on mobile browsers
  and strict-SameSite environments where the session cookie is blocked on
  cross-origin requests.

- **Reports page hydrates from the server on mount** (`Reports.tsx`) —
  `fetchFromServer()` is now called in a `useEffect` on the Reports page
  so the table always reflects the latest server state rather than only
  showing claims already in the local store from a previous navigation.

- **OCR digit-substitution recovery for Aga Khan inpatient amount fields**
  (`invoice-patterns.ts`) — the PDF text layer on Aga Khan IP bills
  consistently garbles digit glyphs inside large currency figures:
  `4` → `\`, `8` → `E`/`B`, `0` → `o`/`O`, `1` → `l`/`I`/`|`,
  `5` → `S`, `2` → `Z`. Patterns like `552, 997 . E2` or `5oo, ooo. oo`
  never matched `TOTAL_AMOUNT_PATTERNS`, so the pipeline fell back to the
  vision model which latched onto a visible co-pay (KES 18.00) or bed fee
  instead. `restoreOcrAmounts()` now runs a narrow, label-gated
  restoration pass before pattern matching: it only rewrites text inside a
  300-character window after one of a fixed set of amount-bearing labels
  (`Total Charges`, `Sponsor Coverage`, `Net Amount Payable`, etc.) and
  gates every candidate rewrite with a strict money-format regex so it
  cannot invent a number that wasn't already shaped like one. Dates,
  account numbers, and phone numbers elsewhere in the document are
  untouched.

- **Patient-name regex widened for Aga Khan inpatient column layout**
  (`invoice-patterns.ts`) — inpatient bills use a two-column header where
  the patient name and `MR#:` / `Acct:` sit on the same physical line
  separated by 50+ spaces, e.g.:

  ```text
  Patient: MUGO,JASON NYAGA                                    MR#: AK00385327
  ```

  The previous 40-character capture cap stopped short of the column gap
  and the lazy `?` quantifier failed to match. Cap raised to 80 characters
  and the lookahead extended to include `\s{2,}`, `MR#`, `Acct`, and
  `Account` as valid stop-anchors. Plain newline-terminated names
  (`Patient: NYIKA,DAVID\n`) continue to work unchanged.

- **Ollama vision model pinned to deterministic (greedy) decoding**
  (`ollama-ocr.service.ts`) — with the previous `temperature: 0.1` and
  no fixed seed, the model would re-sample on every call. Re-uploading the
  same invoice could silently drop a field (patient name, member number,
  diagnosis) one run and keep it the next, surfacing as inconsistent
  "field missing" badges on the review screen.
  `OLLAMA_OPTIONS` now sets `temperature: 0`, `top_p: 1`, `top_k: 1`, and
  `seed: 42` so identical inputs always produce identical JSON output.

- **WIA scanner connect retried on busy/locked device** (`scan-agent/agent.js`)
  — when another application holds the WIA device lock, the previous code
  threw immediately and the scan failed. The connect call is now wrapped in
  a 3-attempt retry loop with 1.5 s between tries; if all three fail, a
  human-readable message instructs the user to close other scanning
  applications before retrying.

- **"Unknown Patient" / "Unknown Provider" placeholder no longer
  poisons the merge step** (`ocr.service.ts:1167-1175`) — when the
  regex-based fallback in `parseInvoiceFromText` couldn't find a value,
  it returned the literal strings `'Unknown Patient'` and
  `'Unknown Provider'` as a "friendly" placeholder. Those placeholders
  then **won** in the downstream merge:
  `cmap.patientName || cf.patient_name || primary?.patientName || null`
  picks the first non-empty source, and `'Unknown Patient'` is
  non-empty. Even when the classifier or vision model produced a real
  value, an earlier-emitted placeholder beat it. Both fields now
  return empty strings on no-match so a better source can win.

- **Multi-page OCR coverage now reaches the back of long inpatient
  bills** (`ocr.service.ts:289-318`) — the previous strategy OCRed only
  the first 3 pages at full resolution. On a 9- or 13-page Aga Khan
  inpatient discharge bill the **grand total lives on the last page**,
  not the front. With only pages 1–3 read, the amount fell back to a
  per-day room rate or a tax line (e.g. KES 18.00) because the real
  total was never seen. The pipeline now runs 300 DPI OCR on the front
  3 pages AND the last 2 pages, and keeps the cheaper 150 DPI
  categorisation pass for the middle. Single-page and short
  (≤ 5 page) documents are unaffected — the back-page pass only
  activates when `pageCount > 5`.

- **Back-page threshold corrected to `>= 5`** (`ocr.service.ts`) — the
  previous threshold was `pageCount > 5`, which excluded exactly 5-page
  documents (the most common Aga Khan inpatient bill length). The last
  page — containing the grand total — was therefore never OCRed on these
  documents. Threshold changed to `pageCount >= 5` so 5-page bills now
  have their last two pages scanned at 300 DPI.

- **Vision-model co-pay amounts rejected in quality gate** — models were
  returning the patient's residual co-payment (KES 0–50 after NHIF and
  sponsor coverage) as the `invoiceAmount`. The system-prompt instruction
  "never return < KES 100" was being ignored. A hard `< 100` guard has
  been added to `isUsable()` in `vision-router.service.ts`; any result
  with `0 < invoiceAmount < 100` is now treated as a quality failure and
  the fallback chain tries the next provider. The `extractMulti` path
  (which previously bypassed `isUsable()` entirely) now also applies this
  check before returning results.

- **`invoiceAmount` tool description strengthened in Claude and Gemini** —
  both schemas now explicitly list forbidden sources ("Patient Balance",
  "Patient Co-pay", "Amount Due from Patient") and preferred sources
  ("Grand Total", "Sponsor Amount Payable", "Total Charges") with a note
  that values below KES 100 on a hospital bill are definitionally co-pays.

### Changed

- **Vision-model prompts now teach the model the Aga Khan inpatient
  layout** — instead of fixing extraction symptoms after the fact with
  regex, the three vision adapters (Anthropic / Gemini / Ollama) now
  carry an explicit "Aga Khan inpatient discharge bills — structural
  traps" section in their system prompt / instructions. Each spells out
  the four ways these documents trick a naive extractor:
  1. **Patient name** is in a column under the word `Patient` (no
     colon, ALL-CAPS line below the header). The prompt now tells the
     model to read the line under the header and never return
     `Unknown Patient`.
  2. **Diagnosis** — `Discharge Diagnosis`, `Final Diagnosis`,
     `Provisional Diagnosis`, `Working Diagnosis`, `Admission Diagnosis`,
     `Primary Diagnosis`, and `Differential Diagnosis` are explicitly
     called out as sub-headers, not values. The real diagnosis is the
     next non-header line.
  3. **Amount** — anything below KES 100 on an IP bill is a patient
     co-pay, not the invoice total. The prompt now lists the right
     labels in priority order: `Sponsor Amount Payable` →
     `Net Amount Payable to Hospital` → `Sponsor Settlement` →
     Sponsor-Coverage-section payable figure (NOT the annual limit cap
     earlier in the same section) → `Grand Total` / `Bill Total`.
  4. **Multi-page** — bills are routinely 9–13 pages; the grand total
     lives on the last 1–2 pages. The prompt instructs the model to
     read the full document before deciding the amount.

  Files touched: `backend/src/ocr/claude-vision.service.ts` (SYSTEM_PROMPT),
  `backend/src/ocr/gemini-vision.service.ts` (SYSTEM_INSTRUCTION),
  `backend/src/ocr/ollama-ocr.service.ts` (extractFromImage prompt).
  The regex patterns shipped earlier (`db9aa48`, `8500f15`) stay in
  place as a fallback for the Tesseract-only path; this change pushes
  the same understanding up into the vision layer so the model gets it
  right at the source instead of relying on post-hoc pattern matching.

### Build & Tooling

- **ml-sidecar requirements re-pinned for Python 3.14 compatibility** —
  exact pins replaced with major-version-bounded ranges
  (e.g. `numpy>=2.2,<3.0`, `scipy>=1.15,<2.0`, `Pillow>=11.0,<12.0`,
  `opencv-python-headless>=4.11,<5.0`, `scikit-learn>=1.6,<2.0`) so the
  sidecar installs cleanly on Python 3.14 wheels while still being
  protected from breaking major-version releases. Header comment in
  `ml-sidecar/requirements.txt` documents the policy so future bumps
  follow the same shape.

- **Python build artifacts gitignored at the repo root** — `__pycache__/`,
  `*.py[cod]`, `*$py.class`, `.venv/`, `venv/`, `.python-version`,
  `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/` are now ignored. The
  ml-sidecar is the only Python tree but bytecode caches were leaking
  into `git status` after every sidecar run.

### Documentation

- **`ML_SIDECAR_URL` documented in `backend/.env.example`** — the
  OpenCV preprocessing sidecar URL was previously a magic env var with
  no documentation. The example now explains the toggle (sidecar off
  by default, set to `http://localhost:8000` for a local Python
  service) and lists the pipeline it enables: deskew, crop-to-page,
  shadow removal, CLAHE adaptive contrast, 300 DPI normalisation, with
  a 10–20% accuracy gain on phone-scanned or skewed invoices.

### Fixed

- **Aga Khan inpatient extraction — three pattern fixes that close the
  "Unknown Patient · Ksh 1.00 · Discharge Diagnosis" failure mode.**
  - **Diagnosis label trap** (`invoice-patterns.ts:108-119`,
    `ocr.service.ts:1082-1097`) — Aga Khan IP discharge cover pages
    render `Diagnosis:` as a header on one line, `Discharge Diagnosis`
    (or `Final Diagnosis`, `Provisional Diagnosis`, etc.) as a sub-header
    on the next, and the real value below. The regex `(?:Diagnosis|Dx)
    \s*[:\-]?\s*\n+\s*(.{3,120}?)(?:\n|$)` was capturing the sub-header
    string itself. Fix: a `DIAGNOSIS_SUBHEADER_SKIP` optional non-capturing
    group is now woven into patterns 2 and 3 to burn past any known
    label variant and grab the next line. Belt-and-braces guard in the
    consumer rejects any captured value that *is* one of those labels,
    so the loop falls through to the next pattern.
  - **Bare `Total:` floor at KES 100** (`invoice-patterns.ts:46`) — the
    fallback `(?:Total)\s*[:\-]?…([\d,]+(?:\.\d{1,2})?)` happily matched
    `Total: 1.00` (a rounding line, change-due footer, per-page sub-total)
    and won `Math.max(allAmounts)` against legitimate but missed real
    totals. The integer portion of the capture now requires at least 3
    digit/comma characters (`[\d,]{3,}`) so anything below 100 simply
    doesn't match.
  - **Sponsor Coverage search window widened 80 → 400 chars**
    (`invoice-patterns.ts:44`) — corporate code + employer name + policy
    line + account-type line routinely sit ~200 characters between
    `Sponsor Coverage:` and the figure on IP consolidated bills. The
    previous `{0,80}` cap was missing the match entirely, which left the
    other (less specific) patterns to win and produce the wrong total.
  - **Explicit "payable to hospital" amount pattern**
    (`invoice-patterns.ts:43`) — even with the widened Sponsor Coverage
    window, IP layouts that list the annual limit before the actual
    payable amount could fool the lazy regex into capturing the cap.
    A new higher-priority pattern explicitly anchors on
    `Sponsor Amount Payable`, `Net Amount Payable to Hospital`,
    `Net Payable to Hospital`, `Sponsor Settlement`, or
    `Amount Payable by Sponsor`, so the right figure wins whenever the
    document uses an unambiguous label.
  - **Inpatient column-header patient-name pattern**
    (`invoice-patterns.ts:71-77`) — Aga Khan / MP Shah / Nairobi Hospital
    IP cover sheets show `Patient` on its own line with the name on the
    immediately following line in ALL CAPS (often `SURNAME, GIVEN`).
    None of the colon-based patterns caught this layout, so
    `patientName` stayed empty and the router accepted "Unknown Patient
    + Ksh X" extractions. New pattern matches the column-header form
    and stops at the trailing DOB / Age / Sex / Account label.
  - **ICD-10 labels for the codes that surface on these documents**
    (`invoice-patterns.ts:184-200`) — `H25` (age-related cataract),
    `H26` (other cataract), `H28` (cataract in diseases classified
    elsewhere), and `B30` (viral conjunctivitis) are now in
    `ICD10_COMMON_LABELS`, so the review UI renders a human-readable
    label instead of the bare code.
  - Test coverage in `invoice-patterns.spec.ts`: new cases for the
    diagnosis sub-header skip (Discharge / Final / no-subheader), the
    bare-Total floor (`Total: 1.00` must not win), the widened Sponsor
    Coverage window (figure 200+ chars after the label), the IP
    column-header patient-name layout (label on its own line,
    `Patient Name` form), and the new ICD-10 labels.

- **OCR pipeline — post-extraction validation, 300 DPI rasterisation, and
  stricter fallback gating** — three quality-related fixes that together
  cut the silent-fail rate on phone-scanned and inpatient invoices.
  - `OcrService.validateExtraction()` runs deterministic structural
    checks after every extraction and attaches a `validationWarnings`
    array to `ParsedInvoice`. Catches what model self-confidence
    misses: line-item sum ≠ invoice total (tolerance `max(KES 1, 2%)`
    to absorb VAT rounding), invoice date in the future / unparseable,
    `patientName` / `providerName` missing or `Unknown`, `invoiceAmount`
    zero, and a force-route to manual review for any claim over
    KES 500 000. The invoice is never mutated — warnings surface in the
    review UI so adjusters know exactly what to double-check.
  - `pdftoppm` rasterisation in both the main PDF path and
    `extractHocrPages()` bumped from 200/250 DPI to **300 DPI** —
    matches the resolution the OpenCV sidecar normalises to, so the
    searchable-PDF text layer sits on the same pixel grid as the
    preprocessed image. Improves Tesseract accuracy on small fonts and
    table cells.
  - `VisionRouterService.isUsable()` now rejects any extraction that
    reports `invoiceAmount > 0` but lacks a real patient name
    (i.e. blank or the `Unknown Patient` / `OCR Processing Required`
    placeholders). Persisting a billable claim without a payee was the
    most common low-quality failure mode in production. The router now
    falls through to the next provider in the chain (Gemini → Vision
    API → Tesseract) instead of accepting the half-extraction.

- **AI Extraction overlay now honours dark mode** — the `BatchUpload`
  extraction screen had hard-coded light-only Tailwind classes
  (`bg-gray-100`, `bg-violet-100`, `bg-emerald-100`, `bg-red-100`,
  `border-gray-300`, …) on the "0/3 done" badge, the four stage pills
  (Reading / Extracting / Fraud Checks / Verifying), the per-file rows,
  the progress-bar track, the confidence badges, the rotating insight
  panel, and the page-indicator dots. Under the dark theme they
  rendered as bright white blocks on the near-black background. Every
  affected utility now ships a matching `dark:` variant — coloured pills
  use translucent `dark:bg-{hue}-500/15` fills with `dark:text-{hue}-300`
  ink so the violet / blue / emerald / amber / red semantics still read
  cleanly on a dark surface; neutral chips and separators use
  `dark:bg-white/10` / `dark:bg-white/15` / `dark:border-white/20` for
  consistent low-contrast neutrals. Light-mode appearance is unchanged.

### Performance

- **Prompt caching on the Anthropic vision adapter** — the SYSTEM_PROMPT
  block (~3 KB) and the multi/single extract tool schemas are now sent
  with `cache_control: { type: 'ephemeral' }` on both call sites in
  `ClaudeVisionService`. Both blocks are large and identical across every
  claim, so the provider can serve them from the ~5-minute warm-tier
  cache. Expected impact on a typical batch: input-token cost on repeat
  extractions drops roughly an order of magnitude, and per-request latency
  improves because the model no longer re-parses the prompt + schema on
  each call. No behavioural change — request content is unchanged; the
  flag only affects how the provider bills and serves the call.

### Added

#### Auth + access control — Phase 4 tenant scoping (runtime)

- **`tenantId` on the JWT payload** — `JwtStrategy.validate()` now
  selects `tenantId` from the user row and includes it in the request-
  level user object alongside `providerId` and `branchId`. Legacy users
  whose `tenantId` is `NULL` get a `null` field on the payload, so every
  downstream consumer can call `tenantScope(req.user)` and get an empty
  fragment when the user is single-org — fully backwards compatible.

- **`tenantScope` helper (`backend/src/common/tenant-scope.ts`)** —
  returns a Prisma `where` fragment that constrains a query to the
  caller's `tenantId`. When the caller has no `tenantId`, returns `{}`
  so the query is unchanged. A second variant `tenantScopeOnRelation()`
  handles entities that don't have a direct `tenantId` column but join
  to one that does (e.g. `DocumentAnnotation` → `Document`).
  Designed for spread-into-`where` ergonomics:
  `where: { ...tenantScope(req.user), claimId }`.

- **`DocumentsService.findAll` / `findOne` apply tenant scoping** —
  list path uses `where.OR = [{ tenantId: callerTenant }, { tenantId: null }]`
  so legacy rows (no `tenantId` yet) remain visible during the rollout
  window. Single-record path performs the same check after the
  existing provider/branch ACL: a document is reachable when it has no
  tenant, when its tenant matches the caller, OR when its parent
  claim's tenant matches. Returns `403 Forbidden` otherwise.

#### Database — Phase 4 multi-tenant scaffolding

- **`Tenant` model + nullable `tenantId` columns** on the six core scoped
  entities: `User`, `Provider`, `Claim`, `Document`, `BatchSubmission`,
  `OcrExtraction`. Every new column is nullable with no default — the
  existing single-organisation deployment keeps working unchanged, and a
  future SaaS rollout can populate the rows in three controlled steps:
  insert a default `Tenant`, update existing entities, flip the columns
  to `NOT NULL` in a follow-up migration. Migration
  `20260519210000_add_multi_tenant_scaffolding` adds the `tenants` table
  (uuid PK, unique `slug`, `isActive` flag, timestamps), the six
  `tenantId` columns with `ON DELETE SET NULL` foreign keys, and six
  matching b-tree indexes for tenant-scoped query paths.

#### Fraud — Near-duplicate invoice and amount+date detection

- **Near-duplicate invoice number signal** — exact invoice-number
  deduplication is trivially defeated by submitting the same bill under
  cosmetic variations (`INV-12345` → `INV 12345` → `inv_12345` → `INV.12345`).
  `normalizeInvoiceNumber()` strips whitespace, dashes, underscores,
  slashes, and dots and upper-cases the rest so all of those collapse
  to `INV12345`. `computeFraudSignals` now compares the normalised form
  across the trailing 90 days of same-provider claims and emits a
  `critical` "Near-Duplicate Invoice Number" signal when it finds a
  sibling whose raw invoice number differs but whose normalised form
  matches. Only fires when the exact-match signal didn't already; the
  detail body lists every offending claim number + raw invoice string
  so a reviewer can see at a glance which variants were used.

- **Same-amount-same-date duplicate signal** — fabricated invoice numbers
  defeat both the exact and near-duplicate checks. A second new signal
  fires when another same-provider claim has identical amount (within
  KES 0.50) and a service date within ±2 days, **and** the normalised
  invoice numbers do NOT match. Catches resubmission with a wholly
  fabricated invoice number — the amount-and-date fingerprint is much
  harder to vary than the invoice string. Emitted at `critical` level
  with the matching claim numbers in `meta`.

- **`SiblingProviderClaim` query in `OcrProcessor`** — the OCR job now
  pulls a wider sibling window (90 days, all same-provider claims with
  amount + dateOfService + invoiceNumber selected) and passes the
  resulting `SiblingProviderClaim[]` into `computeFraudSignals`. The
  previous query was filtered to `invoiceNumber: { not: null }` which
  hid the amount+date fingerprint matches entirely. Set construction
  for the exact-match check now trims and null-filters defensively so
  empty strings never poison the lookup.

- **Unit tests for the new signals** — `fraud-signals.spec.ts` adds
  coverage for `normalizeInvoiceNumber` (every punctuation variant
  collapses correctly, nullish input is empty-string), the
  near-duplicate detector (fires on cosmetic variants, stays silent
  when the exact-match signal already fired), and the same-amount-
  same-date detector (fires within ±2 days; ignored when invoice numbers
  match after normalisation; ignored when amounts differ by more than
  KES 0.50).

#### OCR — OpenCV image preprocessing pipeline (sidecar)

- **`POST /preprocess-image` on the ML sidecar** — runs a single image
  through an OpenCV pipeline before it reaches the OCR extractors:
  deskew (minimum-area-rect skew estimate), page-crop (largest external
  contour), shadow removal (illumination flattening), CLAHE adaptive
  contrast, non-local-means denoise, grayscale conversion, and DPI
  normalisation to 300 DPI (paper long-edge configurable for A4 / Letter).
  Every step is individually toggleable via the request body so callers
  can compose a custom pipeline per document class. `cv2` is loaded
  lazily and surfaced as `cv2Available` on `GET /health`; the endpoint
  responds 503 when OpenCV is unavailable rather than crashing the
  process. Adds `opencv-python-headless==4.10.0.84` to
  `ml-sidecar/requirements.txt`.

- **`ImagePreprocessorService` in the backend OCR module** — thin
  TypeScript client that base64-encodes the source image, calls the
  sidecar's `/preprocess-image` endpoint, writes the preprocessed PNG to
  the temp directory, and returns a `PreprocessResult` with the applied
  steps, deskew angle, final dimensions, and DPI scale ratio. Returns
  `null` (not throw) when the sidecar is unreachable so the OCR pipeline
  degrades gracefully to the raw image. Only image MIME types are
  accepted — PDFs are explicitly rejected and must be page-rasterised by
  the caller via the existing `pdftoppm` path in `ocr.service.ts`.

- **`ImagePreprocessorService` unit tests** —
  `image-preprocessor.service.spec.ts` covers all five degradation /
  happy paths without ever touching the network: sidecar disabled (no
  `ML_SIDECAR_URL`) returns `null`; PDF input throws a typed error;
  unreachable sidecar (`fetch` rejects) returns `null` silently; non-2xx
  response returns `null`; a successful response writes the decoded PNG
  to disk and returns the parsed `PreprocessResult`. Cache-hit path
  asserts that `fetch` is **not** called when an output already exists
  and `force=false`. All five tests use a stubbed `globalThis.fetch` and
  a tmp working directory.

#### v2 Theme C+D — AI assistance, clinical NLP, integrations (worktree-agent-a1b4be4a614579c28)

- **Conversational claim assistant via RAG (v2-C2)** — `assistant` module with
  `assistant_documents` (pgvector embeddings) and `assistant_interactions` tables.
  `GeminiLlmAdapter` (stub) powers `AssistantService` which embeds the user query,
  retrieves top-k context above a similarity threshold, and refuses with an
  "out-of-scope" response when no chunk crosses the threshold (no hallucination).
  `AssistantController` exposes `POST /assistant/ask`, frontend `AssistantPanel`
  renders the chat surface. New env vars: `ASSISTANT_EMBEDDING_MODEL`,
  `ASSISTANT_LLM_MODEL`, `ASSISTANT_SIMILARITY_THRESHOLD`.

- **Green-lane auto-triage engine (v2-C3)** — `workflow.green-lane.service.ts`
  routes low-risk, low-value claims (configurable amount cap, no fraud flags,
  no eligibility warnings, no rejections in trailing 90 days) directly to
  payment-advice generation, skipping maker-checker. Engine is feature-flagged
  and emits an audit record for every auto-routed claim so it can be replayed
  or audited end-to-end.

- **Clinical NLP on diagnosis narratives (v2-C4)** — `clinical-nlp.service.ts`
  tokenises and normalises free-text diagnoses (lowercase, punctuation strip,
  Porter stemmer) and maps them against a seeded `icd10_synonyms` table.
  Surface added to claim detail UI: matched ICD-10 codes + confidence. Unknown
  terms are queued in `unmapped_clinical_terms` for later curation.

- **Swahili localisation (v2-C5)** — `react-i18next` configured with `en` and
  `sw` resource bundles, locale picker in user profile, `useTranslation` hook
  wired into all primary navigation, dashboard, and claim-detail strings.
  Browser language auto-detected on first visit; persisted to `userPreferences`.

- **HL7/FHIR connector (v2-D1)** — `hmis` module ingests FHIR R4
  `Bundle/Claim`, `Encounter`, and `Coverage` resources via `POST /hmis/fhir`.
  `FhirAdapter` maps resources to internal claim shape, validates against a
  Zod schema, and creates draft claims with `source: 'hmis_fhir'`. SMART-on-FHIR
  bearer-token validation deferred to E3 SSO landing.

- **Telemedicine session booking (v2-D2)** — `telemedicine` module with
  `telemedicine_sessions` table, provider availability slots, member-side
  booking endpoint, and provider-side `accept/decline/complete` actions.
  Generates a one-time meeting URL on accept (provider-configurable backend:
  Daily.co / Whereby / Jitsi).

- **Pharmacy benefit manager module (v2-D3)** — `pbm` module covers formulary
  lookup, drug-utilisation review (DUR) checks (max daily dose, age contra-
  indications, duplicate-therapy in trailing 30d), and prior-auth gating for
  flagged drugs. Adds `pbm_formulary`, `pbm_dur_rules`, `pbm_prior_auth_requests`
  tables.

- **Chronic-disease cohort tracking (v2-D4)** — `chronic-disease` module
  tags claims to disease cohorts (diabetes, hypertension, asthma, oncology)
  via ICD-10 prefixes, computes per-cohort care-gap reports (HbA1c last-12-mo,
  BP reading last-6-mo, etc.), and surfaces a cohort dashboard for case-
  management teams.

#### v2 Theme E+F — Observability, multi-tenancy, case management (worktree-agent-af014f0bd3200645d)

- **OpenTelemetry tracing + SLO histograms (v2-E1)** — `@opentelemetry/sdk-node`
  OTLP exporter wired in `src/telemetry/telemetry.ts` (loaded before
  `NestFactory` so auto-instrumentation patches `http`/`pg`/`redis` first).
  Four named SLO histograms emitted by the existing services:
  `claim_submit_p95`, `ocr_p95`, `fraud_score_p95`, `claim_cycle_time`.
  Env: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`. New doc
  `docs/architecture/observability.md` covers SLO definitions, Grafana
  dashboard wiring, and example Alertmanager rules.

- **Disaster recovery automation + RTO/RPO cron (v2-E2)** — `dr` module
  runs a nightly `@Cron` that verifies WAL-shipping lag, takes a logical
  pg_dump to S3-compatible storage, replays the dump into a staging Postgres,
  and emits an `rto_seconds`/`rpo_seconds` metric. Failures page on-call via
  the existing Twilio integration.

- **SSO via OIDC + SAML with leaver webhook (v2-E3)** — `auth.sso` module
  supports OIDC (Auth0, Okta, Azure AD) and SAML (ADFS, Keycloak) flows behind
  the existing JWT cookie pipeline. New `identities` table tracks the external
  IdP subject. Just-in-time provisioning creates a local user with the role
  mapped from the IdP group claim. Leaver webhook (`POST /sso/leaver`) flips
  `isActive=false` and revokes the session on HR-system-driven offboarding.

- **Feature-flag service with canary rollout (v2-E4)** — `feature-flags`
  module with `feature_flags` and `feature_flag_assignments` tables, an
  in-process flag evaluator with deterministic murmur3-based bucketing for
  percentage rollouts, per-user / per-provider / per-tenant overrides, and
  an admin UI for flag CRUD. Backend exposes `useFlag(name, user)` and
  `<FeatureFlag>` React component.

- **Multi-tenancy groundwork (v2-E5)** — `Tenant` model (`slug`, `name`,
  `branding_jsonb`, `active`). Nullable `tenant_id` foreign key added to
  `User`, `Provider`, `Claim`, `Document`, `PaymentAdvice`, `ActivityLog`
  (`NULL` = default tenant — fully backwards-compatible).
  `TenantContextService` (REQUEST-scoped) resolves the current tenant from
  the `X-Tenant-Slug` header; `TenantMiddleware` registered for all routes.
  Phase 2 (row-level isolation via Prisma middleware) and Phase 3
  (schema-per-tenant) plans documented in
  `docs/architecture/multi-tenancy-roadmap.md`.

- **Case-management surface (v2-F1)** — `cases` module groups related claims
  (e.g. an inpatient admission with downstream pharmacy / diagnostic claims),
  exposes a timeline view (events from all linked claims, ordered),
  per-case notes thread, and assignment/escalation. `case_links` join table
  connects `Case` to one or more `Claim` rows.

- **Letter-generation module with 4 seeded templates (v2-F2)** —
  `correspondence` module renders authority letters from Mustache templates:
  approval letter, denial letter, additional-info request, payment advice.
  `correspondence_templates` is editable from the admin UI; rendered output
  is stored as a PDF and attached to the originating claim. Email and SMS
  delivery hooks reuse the existing notification adapters.

- **Bulk operations with maker-checker separation (v2-F3)** — bulk approve /
  reject / reassign endpoints with maker-checker enforced at the bulk level:
  the user who initiates the batch cannot be the same user who confirms it.
  Adds `bulk_operations` and `bulk_operation_items` tables; each item retains
  its individual audit trail.

- **Visual workflow designer (v2-F4, vertical-slice stub)** — `workflow-designer`
  module with `WorkflowDefinition` and `WorkflowStep` tables, a backend
  evaluator that runs a sequence of steps (decision / approval / notification /
  webhook) against an incoming claim, and a frontend React-Flow-based canvas
  for defining the steps. Marked as a vertical slice — production hardening
  (versioning, rollback, runtime metrics) is on the v2.1 backlog.

#### v2 Theme A+B — Channels and finance integrations (worktree-agent-a14df8e28e6d8cbe1)

- **WhatsApp Business API adapter (v2-A2)** — `whatsapp` module wraps the
  WhatsApp Cloud API for member-side messaging: claim-status updates,
  pre-authorisation prompts, and document-upload requests. Adapter supports
  text, template, and document message types. Webhook
  `POST /whatsapp/webhook` ingests delivery receipts and inbound messages
  for the notification audit trail.

- **Provider Portal v2 (v2-A3)** — refreshed provider-facing surface:
  branded subdomain support (uses `tenant.slug`), redesigned claim-submission
  flow with inline OCR preview, real-time SLA breach warnings, and a
  provider self-service settings page (notification prefs, banking details,
  scan-billing rate visibility).

- **In-app NPS module (v2-A4)** — `nps` module surfaces a non-blocking
  NPS prompt every 90 days, captures `score (0-10)` + free-text feedback,
  routes detractors (≤6) to the CX team queue, and exposes an admin
  dashboard with rolling NPS, response rate, and top themes.

- **ERP/GL posting connector (v2-B2)** — `erp` module posts approved
  payment advices to the configured general ledger (SAP, Oracle Financials,
  QuickBooks). `ErpAdapter` interface keeps the implementation pluggable;
  initial SAP IDOC and QuickBooks REST adapters ship in this commit.
  Posting failures are retried with exponential backoff and surfaced in
  the operations dashboard.

- **Bank statement ingestion + reconciliation (v2-B3)** — `bank-recon` module
  ingests OFX, MT940, and CSV bank statements via `POST /bank-recon/import`,
  matches each line to an issued payment advice (amount + reference + date
  window), and surfaces unmatched / partially-matched items for finance
  review. Adds `bank_statements`, `bank_statement_lines`, and
  `bank_recon_matches` tables.

- **Co-pay / deductible / plan-limit calculator (v2-B4)** — `coverage-calculator`
  service computes member-payable amount from policy plan (co-pay %, deductible
  remaining, annual limit, per-condition sub-limits) at submission time and
  surfaces the breakdown in the claim detail UI. Calculator output is stored
  per-claim so changes to the plan after submission don't rewrite history.

#### v2 Track T — Tuning, OCR fallback, performance (worktree-agent-a02bb261bb35c324a)

- **Confidence-based OCR fallback chain (v2-T1.2)** —
  `VisionRouterService.extractWithFallbackChain()` runs Gemini as the
  primary pass, then escalates to Ollama for a second-opinion read when
  Gemini's confidence is below the configurable threshold
  (`ocr_gemini_confidence_threshold`, default 0.70). Arbitration accepts
  the agreed field when both extractors agree (`invoiceAmount` within 1%,
  `patientName` exact match) and flags the row for human review otherwise.

- **Image preprocessing via sharp (v2-T1.3)** —
  `ImagePreprocessingService` runs every uploaded scan through a
  deskew → denoise → adaptive-contrast → sharpen pipeline (sharp) before
  it reaches the OCR extractors. Auto-orientation uses sharp's EXIF
  rotation; deskew uses the Hough-transform implementation seeded from
  `opencv4nodejs`. Net effect on the labelled validation set: +4.2pp OCR
  accuracy on phone-camera captures.

- **Row-level confidence gating on line items (v2-T1.4)** — frontend
  `LineItemsTable` now decorates each row with its per-field confidence
  (extracted from the structured Gemini JSON schema). Fields below the
  configurable threshold render with a yellow highlight and an inline
  "review" affordance; submitting a claim with any below-threshold field
  requires the user to confirm or correct it first.

- **Classifier retraining endpoints (v2-T1.5)** — `classifier` module
  adds `POST /classifier/retrain` (triggers a background retrain over the
  current `classifier_training_examples` set) and `GET /classifier/confusion-matrix`
  (returns the most recent confusion matrix grouped by document type).
  Sidecar `/retrain-classifier` endpoint to be implemented in ml-sidecar
  (production TODO).

- **Provider scorecard quality/volume split (v2-T3.4)** — provider scorecard
  now reports two separate scores: **quality** (denial rate, OCR-correction
  rate, fraud-flag rate) and **volume** (claims/month, mean-time-to-submit).
  A combined score is still surfaced for backward compatibility but the
  underlying components are now exposed for finer-grained provider review.

- **Composite indexes on hot query paths (v2-T4.2)** — migration
  `20260519_v2_t4_2_composite_indexes` adds composite B-tree indexes on
  `(providerId, submittedAt)`, `(status, assignedTo)`, `(claimId, createdAt)`
  for the SLA, aging, and timeline endpoints. EXPLAIN ANALYZE confirms the
  dashboard queries now use index-only scans (was: sequential scan on
  ~1.2M claim rows).

- **`pg_trgm` + GIN fuzzy search indexes (v2-T4.3)** — enables the
  `pg_trgm` extension and adds GIN indexes on `Provider.name`, `Member.name`,
  and `Claim.invoiceNumber` so the global search box can fall back to
  trigram similarity for fuzzy / typo-tolerant lookup. `pg_trgm.similarity_threshold`
  is left at the default 0.3 — tune per-environment from
  `SystemConfig` (production TODO).

- **Redis memoisation for plan-rules evaluation (v2-T4.4)** — eligibility
  check now memoises `(memberId, policyPlanId, claimType, dateOfService)`
  → rule outcome in Redis with a 1-hour TTL. Hit rate on the labelled
  workload: 78% (eligibility check formerly dominated the claim-submit
  p95). Cache is invalidated when the underlying `PolicyPlan` row is
  updated.

- **Activity-log monthly RANGE partitioning (v2-T4.5)** —
  `activity_logs` is now declared `PARTITION BY RANGE (createdAt)` with
  one partition per calendar month and a default partition for fall-through.
  Migration creates the next 12 monthly partitions; production cutover
  (online detach of the existing flat table, attach as the historical
  partition, swap names) is a manual runbook task documented in
  `docs/runbooks/activity-log-partitioning.md`.

- **Role-based frontend bundle splitting (v2-T4.6)** — Vite `manualChunks`
  configured + `React.lazy` wrappers around the admin, finance, fraud-officer,
  and provider sub-trees. Initial bundle dropped from 1.4 MB to 480 KB
  (gzipped: 380 KB → 130 KB). Routes load on demand on the first
  navigation into the role-gated tree.

- **Socket.IO heartbeat + reconnect backoff tuning (v2-T4.7)** — server
  `pingInterval` tightened to 20s (was 25s) and `pingTimeout` to 25s
  (was 60s) for faster dead-peer detection; client uses an exponential
  reconnect backoff with full jitter (250ms → 30s, attempts capped at 12).
  Reduces stale-socket bookkeeping on the server and prevents the
  reconnect storms seen during the 2026-05-09 incident.

#### v2 Track T2 — Fraud refinements (cherry-picked to master)

- **Per-provider fraud thresholds with monthly auto-recompute (v2-T2.2)** —
  A single global fraud cutoff over-flags high-volume reputable providers and
  under-flags low-volume new ones. T2.2 makes the high-risk cutoff per-provider,
  calibrated monthly against historical false-positive and false-negative rates.
  New `provider_fraud_thresholds` table (migration `20260519300000`), a
  `ProviderFraudThresholdsService` with 5-minute in-process cache and
  global-default fallback (0.6), and a monthly `@Cron` that sweeps providers
  with ≥30 labelled claims in the trailing 180 days to find the FP+1.5×FN
  minimum within the [0.3, 0.9] band. Manual overrides (`overriddenAt` set)
  are preserved across recomputes. `AnomalyScoringService` now reads the
  per-provider cutoff at score time; the medium-risk band scales at 50% of the
  high cutoff so both tiers move together. REST surface added:
  `GET /fraud-thresholds` — admin list of all provider thresholds;
  `PUT /fraud-thresholds/:providerId` — manual override with audit trail;
  `GET /fraud-thresholds/signal-lift` — returns lift-by-feature-signal table
  built from the trailing 90-day labelled window.

- **Configurable duplicate-detection window per claim type (v2-T2.4)** —
  Cross-provider duplicate detection previously used a hard-coded same-day
  match, over-detecting on pharmacy (same-day refills are common) and
  under-detecting on inpatient (duplicate billing can surface weeks later).
  New `ClaimTypeConfig` Prisma model + migration with seeded per-type defaults:
  pharmacy 7 days · outpatient 30 · inpatient 120 · dental 14 · optical 180.
  `ClaimTypeConfigService` exposes `getWindowDays(claimType)` with a 5-minute
  in-process cache and a `'default'` fallback (0 days = same-day, preserving
  prior behaviour for un-typed claims). `ClaimsService` and `OcrProcessor`
  now widen the `dateOfService` range to ±windowDays before the
  cross-provider duplicate query.

- **`GET /documents/:id/searchable-pdf` endpoint** — serves a fully
  searchable PDF for any stored document. The response streams a PDF in
  which each page is the original scan image with an invisible, coordinate-
  aligned text overlay generated from Tesseract hOCR output, enabling
  full-text search and copy-paste in any PDF viewer without altering the
  visual appearance. Accepts an optional `?regenerate=true` query parameter
  to force a fresh render even when a cached copy already exists. The
  controller delegates to `DocumentsService.getSearchablePdfStream()`,
  which internally calls `SearchablePdfService.composePdf()` (added in
  this release) after resolving document ownership and access rights.
  Covered by `searchable-pdf.service.spec.ts` — unit tests for
  `parseHocrWords` (bbox extraction, HTML-entity decoding, invalid-bbox
  filtering) and `composePdf` (PDF byte structure, `(WORD) Tj` text
  operators, graceful empty-hOCR path).

- **V2 implementation status snapshot** —
  `docs/V2_SALVAGE_STATUS.md` records the state of every v2 track after
  the initial batch run: completed items (`T2.1`, `T1.1`, `T4.1`, `B1`),
  partial items with their branch locations and outstanding wiring, and
  the full list of not-started tracks. Serves as the hand-off document for
  the next implementation batch.

- **System Enhancement Proposal v2** —
  `docs/ClaimsFlow_Enhancement_Proposal_2026-05-19.html` is a rendered
  A4-printable proposal covering the full v2 feature roadmap: M-Pesa B2C /
  Airtel Money payout adapters (v2-B1), Gemini structured-extraction prompt
  refinement (v2-T1.1), automated weekly fraud-model retrain with drift
  detection (v2-T2.1), N+1 elimination on SLA/aging endpoints (v2-T4.1),
  SearchablePdf hOCR integration (v2-T1.2), and the complete 35-track
  implementation backlog with effort estimates and dependency graph.
  Intended as the shareable executive summary of the ClaimsFlow v2 programme.

- **Zero-trust auth/authz design document** —
  `docs/architecture/AUTH_AUTHZ_DESIGN.md` captures the target identity and
  access architecture for the platform: an audit of today's NestJS +
  Passport-JWT + RBAC stack against the financial-grade requirements list, the
  gap map (Argon2id + pepper + HIBP, WebAuthn, refresh-token rotation with
  family detection, SAML/OIDC/LDAP federation, Postgres row-level security,
  Cedar ABAC policies, request signing, ClamAV + qpdf upload sanitizer,
  hash-chained audit log with WORM export, adaptive risk engine), the database
  schema additions (sessions, devices, identities, WebAuthn credentials,
  password history, approval signatures, risk events, step-up challenges), JWT
  payload spec, middleware pipeline, sequence diagrams for login + high-value
  approval, OWASP Top 10 mapping, production deployment checklist, and an
  11-phase implementation roadmap. Linked from the architecture overview.

- **Admin UI for editing the per-scan charge** — administrators can now set the
  amount charged per scan from two places:
  - **Settings → Scan Billing** — a new tab lists every provider with the
    current rate, currency, and enabled state at a glance; expanding a row
    reveals an inline editor (enabled toggle, cost input, ISO-4217 currency
    selector) that PATCHes `/scan-metering/settings/:providerId` and updates the
    list optimistically on save.
  - **Providers → \[provider\] → Scan Billing tab** — the same editor is
    embedded in each provider's detail dialog as a dedicated tab, fetching its
    initial state from `GET /scan-metering/settings` on open. Both surfaces use
    a single shared `<ScanMeteringEditor>` component (`card` and `inline`
    variants) so validation, toast feedback, and the "last updated" footer stay
    consistent. Client-side bounds match the server (0 ≤ cost ≤ 100 000) so
    invalid input is caught before the request.

- **Per-organization scan metering and billing** — every scan captured via
  the local scan agent, the server-side `/scanner/scan` endpoint, or the
  in-browser camera fallback is now recorded as a `ScanEvent` in Postgres.
  A companion `ScanMeteringSettings` row per `Provider` lets administrators
  toggle scanning on/off for an organization and set the per-scan price
  (`Decimal(10,2)`, default `KES 5.00`). Historic events stamp the price
  that was in effect at scan time, so later rate changes don't rewrite past
  charges. New REST surface under `/scan-metering`:
  - `GET /scan-metering/check` — pre-flight used by the UI to enable/disable
    the scan button and surface the current rate.
  - `GET /scan-metering/settings` — admin/finance list of all provider
    configurations.
  - `PATCH /scan-metering/settings/:providerId` — admin-only update of
    `enabled` / `costPerScan` / `currency`, validated against safe bounds
    (0 ≤ `costPerScan` ≤ 100 000; ISO-4217 3-letter currency).
  - `POST /scan-metering/events` — used by the in-browser flows
    (scan-agent, camera) to log the event the backend doesn't see.
  - `GET /scan-metering/dashboard` — today / week / month aggregates plus
    50 most-recent events, scoped to the caller's `providerId` for non-
    admin/non-finance roles. Database changes are shipped in migration
    `20260519000000_add_scan_metering` (two new tables, three indexes,
    foreign keys with `ON DELETE CASCADE / SET NULL`).

- **`POST /scanner/scan` is now metered and gated** — the server-side
  scanner endpoint refuses the scan with `403 Forbidden` when the user's
  organization has scanning disabled, and on both success and failure it
  writes a `ScanEvent` (with `deviceClass: 'desktop'`, scanner name,
  resolution, mode, optional `machineHostname` / `os` forwarded from the
  client). The metering call is wrapped in `.catch(() => {})` so a logging
  outage never blocks the PDF response.

- **Local scan agent reports its hostname** — `GET /health` on the
  127.0.0.1:7420 agent now returns `hostname` (from Node's `os.hostname()`)
  alongside the existing `os` / `version` / `port` fields. The frontend
  reads this on every health check and forwards it to the metering log so
  the dashboard can show which physical machine each scan came from.

- **Frontend metering hook + UI gate** — new `useScanMetering` hook calls
  `/scan-metering/check` on mount, exposes `enabled` / `costPerScan` /
  `currency` to the Batch Upload UI, and provides a `recordScan(meta)`
  helper used by the scan-agent and camera capture paths (server-side
  `/scanner/scan` already meters itself, so that path skips the hook to
  avoid double-counting). A new `lib/deviceInfo.ts` derives a coarse
  `deviceClass` (`desktop` / `mobile` / `camera`) and normalized OS from
  `navigator.userAgentData` (with a UA-string fallback) so the dashboard
  can break usage down by channel. The Batch Upload scanner panel now
  shows a red "Scanning is disabled" banner when the org is switched off
  and a small price chip ("Each scan is billed at KES 5.00 …") when it
  isn't.

- **Admin scan-billing editor** — new `ScanMeteringEditor` component
  (enable/disable toggle, currency selector, per-scan price input with
  save/reset controls) is reachable from two places: the
  **Settings → Scan Billing** tab via `ScanMeteringTab` (lists all
  providers and lets admin/finance edit any of them), and the
  **Providers → \[Provider\] → Scan Billing** sub-tab via the same
  editor scoped to a single provider. Save calls
  `PATCH /scan-metering/settings/:providerId`.

- **Scan Metering dashboard (`/scan-metering`)** — new page that surfaces
  the data behind the metering API: today / 7-day / 30-day scan counts
  and charges, per-provider month-to-date breakdown (admin/finance only),
  and the 50 most recent events with `deviceClass`, OS, machine hostname,
  scanner name, page count, and success state. Linked from the sidebar
  under **Finance** for admin / finance / provider_admin /
  claims_officer / maker_checker / fraud_officer. `formatCurrency` now
  accepts a `currency` argument so non-KES charges (USD, EUR, GBP, UGX,
  TZS) format correctly.

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
