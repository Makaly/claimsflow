# CIC Medical Claims Automation — Backend

A production-ready REST API for end-to-end medical insurance claims processing built with **NestJS**, **Prisma ORM**, **PostgreSQL**, and **Redis**.

## Features

- **Authentication & Authorization** — JWT-based auth with role-based access control (admin, claims officer, supervisor, provider admin, provider user)
- **Provider Management** — Full lifecycle: onboarding, approval workflow, branch management, suspension/reactivation
- **Claims Processing** — Create, submit, assign, validate, approve/reject with a maker-checker workflow
- **Document Management** — Secure upload, storage, watermarking, barcode/QR generation, PDF operations, TIFF conversion
- **OCR Engine** — Multi-model extraction pipeline: Gemini Vision, AI Vision API, Ollama (local), and Tesseract fallback; circuit-breaker quota management; model-agnostic page pre-scan for consistent claim splitting across all backends
- **Batch Submissions** — Bulk claim submission via CSV/Excel with async processing
- **Notifications** — Email (SMTP/Nodemailer) and SMS (Africa's Talking) delivery with queue-backed retries
- **Workflow Engine** — Completeness validation, auto-assignment, escalation, and audit trail
- **Activity Logging** — Request-level interceptor writing structured logs to the database
- **External Integrations** — EDMS and eOxegen connectors

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 |
| Cache / Queue | Redis + Bull |
| Auth | Passport.js + JWT |
| OCR | Tesseract.js + Gemini Vision + AI Vision API + Ollama |
| PDF | pdf-lib, PDFKit, pdf-parse |
| Container | Docker |

## Prerequisites

- Node.js >= 20
- PostgreSQL >= 15
- Redis >= 7
- Tesseract OCR (`eng` language data) — see [OCR Setup](#ocr-setup)

## Getting Started

### 1. Clone & Install

```bash
git clone git@github.com:Makaly/invoice_backend.git
cd invoice_backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/cic_claims?schema=public"
JWT_SECRET="change-me-in-production"
REDIS_HOST="localhost"
REDIS_PORT=6379
PORT=4000
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"
SMTP_FROM="noreply@yourdomain.com"
```

### 3. Database Setup

```bash
# Apply migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# (Optional) Seed initial data
npm run prisma:seed
```

### 4. OCR Setup

Install Tesseract and the poppler PDF utilities (used for per-page rendering):

```bash
# Ubuntu / Debian
sudo apt-get install tesseract-ocr tesseract-ocr-eng poppler-utils

# macOS
brew install tesseract poppler

# Or download traineddata manually
wget https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
```

Configure vision providers in `.env`. Any combination works — the pipeline automatically selects the best available backend:

```env
# Gemini Vision (Google AI Studio key — free tier available)
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-2.5-pro          # optional override

# AI Vision API (higher accuracy on complex documents)
ANTHROPIC_API_KEY=your-vision-api-key
ANTHROPIC_MODEL=your-preferred-model    # optional override

# Ollama local inference (no API key — privacy-first, GPU recommended)
OLLAMA_URL=http://localhost:11434
OLLAMA_VISION_MODEL=moondream        # moondream (1B, CPU-friendly) or llama3.2-vision (11B, GPU)

# Active provider selection
VISION_DEFAULT_PROVIDER=gemini       # gemini | ai-vision | ollama | tesseract
```

Without any cloud key the pipeline falls back to Ollama (if running locally) then the Tesseract regex pipeline. All providers share the same page pre-scan split logic so claim grouping is consistent regardless of the active backend.

A **circuit breaker** automatically skips a provider for 5 minutes after a quota or billing error, routing requests to the next available backend without manual intervention.

### 5. Run

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

The API will be available at `http://localhost:4000/api`.

## OCR & Vision Engine

The extraction pipeline runs a lightweight **page pre-scan** on every PDF before any model call. The pre-scan reads the digital text layer, strips stamped barcodes, and produces an authoritative split map (invoice boundaries, continuation pages, supporting-doc attachments) that is consumed identically by all backends — Gemini, and Tesseract — ensuring consistent claim splitting regardless of which model is active.

### Supported providers (auto-detected)

| Provider | Type | Detection signals |
|---|---|---|
| Aga Khan University Hospital | Inpatient | `Invoice # UH…` / `Account Number: UH…` |
| Zion Medical Centre | Outpatient | `DETAILED INVOICE` header |
| Nomad Dental Centre | Outpatient | `NOMAD DENTAL` / `DENTAL CENTRE` header |
| Generic providers | Outpatient | Invoice number + date present |

### Key environment variables

```env
GEMINI_API_KEY=...                     # enables Gemini Vision
ANTHROPIC_API_KEY=...                  # enables AI Vision API backend
OLLAMA_URL=http://localhost:11434      # enables local Ollama inference
VISION_DEFAULT_PROVIDER=gemini         # gemini | ai-vision | ollama | tesseract
OCR_USE_PAGE_HINTS=true                # set 'false' to disable pre-scan (not recommended)
```

The pipeline uses the provider set in `VISION_DEFAULT_PROVIDER` first, then falls back through the remaining chain automatically. Each provider runs the same pre-scan split logic so claim grouping stays consistent even after a failover. The circuit breaker suppresses a failed provider for 5 minutes so subsequent requests skip directly to the next available backend.

## Docker

```bash
# Build image
docker build -t cic-claims-backend .

# Run container (ensure PostgreSQL and Redis are reachable)
docker run -p 4000:4000 --env-file .env cic-claims-backend
```

## API Overview

| Module | Base Path | Description |
|---|---|---|
| Auth | `/api/auth` | Login, register, token refresh |
| Providers | `/api/providers` | Provider CRUD and approval |
| Claims | `/api/claims` | Claim lifecycle management |
| Documents | `/api/documents` | Upload, download, watermark |
| OCR | `/api/ocr` | Invoice data extraction |
| Batch | `/api/batch-submission` | Bulk claim uploads |
| Notifications | `/api/notifications` | Email / SMS delivery |
| Workflow | `/api/workflow` | Assignment and escalation |

## Available Scripts

```bash
npm run start:dev        # Start with hot-reload
npm run build            # Compile TypeScript
npm run start:prod       # Run compiled build
npm run lint             # Lint and auto-fix
npm run test             # Unit tests
npm run test:cov         # Tests with coverage report
npm run prisma:migrate   # Run database migrations
npm run prisma:studio    # Open Prisma Studio (DB GUI)
npm run prisma:seed      # Seed the database
```

## Project Structure

```
src/
├── auth/                   # JWT auth, guards, strategies
├── claims/                 # Claims CRUD, processor, DTOs
├── batch-submission/       # Bulk upload and async processing
├── common/
│   ├── interceptors/       # Activity logging
│   └── services/           # PDF, barcode, EDMS, OCR helpers
├── documents/              # Document storage and management
├── notifications/          # Email + SMS services and processor
├── ocr/                    # Multi-model invoice extraction (Gemini, AI Vision, Ollama, Tesseract)
│   ├── gemini-vision.service.ts  # Gemini Vision + shared model-agnostic page pre-scan
│   ├── claude-vision.service.ts  # AI Vision backend (single + multi-claim)
│   ├── ollama-ocr.service.ts     # Local Ollama inference with text-layer fast-path
│   ├── vision-router.service.ts  # Quota-aware circuit-breaker + fallback chain
│   ├── ocr.service.ts            # Tesseract pipeline + claim grouping logic
│   └── invoice-patterns.ts       # Regex knowledge base for field extraction
├── prisma/                 # Prisma service and module
├── providers/              # Provider management
├── workflow/               # Assignment, maker-checker, validation
├── app.module.ts
└── main.ts
prisma/
├── schema.prisma           # Database schema
└── migrations/             # Migration history
```

## Fraud Signal Detection

Every claim is automatically evaluated against ten signal rules at creation / OCR completion time. Results are stored on the `Claim.fraudSignals` JSON field so they reflect what the system detected at processing time, not at view time.

| Signal | Level | Trigger |
|---|---|---|
| Round-Amount Billing | warning / critical | Invoice total is an exact round thousand (≥ KES 10,000) |
| Unknown / Missing Patient Identity | critical | Member number absent or name contains "Unknown" |
| High-Value Claim | warning | Invoice total > KES 200,000 |
| Duplicate Invoice Number | critical | Same invoice number appears on another claim for the same provider |
| Low OCR Confidence | warning | AI-extracted fields with < 70% confidence |
| Impossible Date Sequence | critical | Service date is after invoice date (backdating indicator) |
| Future-Dated Invoice | critical | Invoice date is in the future |
| Future Service Date | critical | Service date is more than 2 days in the future |
| Stale Claim | warning | Service date more than 90 days ago |
| Member Velocity in Batch | warning / critical | Same member appears multiple times in a batch (escalates to critical when amount also matches) |

Duplicate-invoice signals carry structured metadata (`duplicateClaimNumbers`, `uploadedBy`, `uploadedAt`) so the UI can surface actionable detail without additional queries.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch conventions, commit style, and pull request guidelines.

## License

MIT © CIC Insurance Group PLC
