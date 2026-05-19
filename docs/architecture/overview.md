# Architecture overview

ClaimsFlow is a TypeScript monorepo with three logical layers:

```text
┌───────────────────────┐
│  React 18 + Vite SPA  │  frontend/
└──────────┬────────────┘
           │ HTTPS (JWT cookie)
┌──────────┴────────────┐
│ NestJS 11 API gateway │  backend/
│  - REST + WebSocket   │
│  - BullMQ workers     │
│  - Prisma + Postgres  │
└──────────┬────────────┘
           │
┌──────────┴────────────┐
│ External services     │  AI Vision API, Gemini, Ollama,
│ OCR pipeline (Tesser- │  Africastalking SMS, SMTP,
│ act + vision models)  │  Eoxegen eligibility, Twilio
└───────────────────────┘
```

## Backend modules

Each module is wired in `backend/src/app.module.ts`:

| Module                | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `AuthModule`          | JWT auth, login lockout, password reset                        |
| `ClaimsModule`        | Claim CRUD, fraud signals, anomaly scoring, eligibility check  |
| `OcrModule`           | Tesseract + AI Vision / Gemini / Ollama routing with circuit-breaker |
| `DocumentsModule`     | Upload + classify + viewer endpoints                           |
| `WorkflowModule`      | Maker → checker → supervisor state machine                     |
| `BatchSubmissionModule` | Batch claim ingestion + per-claim fanout                     |
| `RbacModule`          | Role / permission management                                   |
| `ReportsModule`       | Aging, factor effectiveness, exports                           |
| `NotificationsModule` | Email + SMS + in-app                                           |
| `EmailIngestionModule` | IMAP poller that enrolls inbound mail as claims               |

## Frontend structure

`frontend/src/` is organised by capability:

- `pages/` — one per route
- `components/` — shared UI; `components/ui/` are Radix primitives
- `services/` — Axios clients per backend module
- `store/` — Zustand stores (auth, theme, etc.)
- `lib/` — formatting, classnames, file caching
- `utils/` — pure helpers

## Data layer

PostgreSQL via Prisma. Schema lives in `backend/prisma/schema.prisma`.
Migrations are in `backend/prisma/migrations/`.

## Security & identity

See [`AUTH_AUTHZ_DESIGN.md`](AUTH_AUTHZ_DESIGN.md) for the zero-trust
authentication and authorization design — audit of today's stack, RBAC + ABAC
model, multi-tenant isolation via Postgres row-level security, JWT structure,
risk engine, document-pipeline hardening, OWASP threat model, and the phased
roadmap to SOC 2 / ISO 27001 readiness.

## Background work

BullMQ on Redis. Queues:

- `claims` — eligibility + anomaly scoring on new claims
- `ocr` — text extraction for newly uploaded documents
- `batch-submission` — fanning out a batch upload into individual claims
