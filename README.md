<div align="center">

# ClaimsFlow

**End-to-end medical claims automation platform for CIC Insurance Group PLC**

[![CI](https://github.com/Makaly/claimsflow/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Makaly/claimsflow/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Makaly/claimsflow/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/Makaly/claimsflow/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/Makaly/claimsflow?display_name=tag&sort=semver)](https://github.com/Makaly/claimsflow/releases)
[![License](https://img.shields.io/github/license/Makaly/claimsflow)](LICENSE)
[![NestJS](https://img.shields.io/badge/backend-NestJS%2011-e0234e)](https://nestjs.com/)
[![React](https://img.shields.io/badge/frontend-React%2018-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Overview

ClaimsFlow digitises the full medical claims lifecycle — from provider intake and OCR extraction through maker-checker adjudication, SLA tracking, fraud screening, appeals, and payment advice generation. It replaces paper-based workflows with a configurable, auditable, and secure platform built around the CIC SRD.

### Highlights

- **Batch intake** with barcoded provider submissions and PDF watermarking
- **OCR & AI extraction** via Gemini Vision, Ollama, and Tesseract fallbacks
- **Maker-Checker dual control** with full audit trail
- **SLA tracking** with automated breach detection and aging dashboards
- **Eligibility verification** against member policies and plan limits
- **Appeals workflow** with adjudication and documentation
- **Payment advice** generation, export, and reconciliation
- **Pre-authorisation** module for elective treatment approvals
- **Real-time notifications** via WebSockets
- **Two-factor authentication**, password reset, role-based access
- **Reporting** — operational, financial, fraud, provider scorecards
- **ML feedback loop** — claim labelling, factor-effectiveness analysis, and anomaly weight tuning
- **Hardened security** — HttpOnly JWT cookies, Helmet CSP, HSTS, global rate limiting, magic-byte file verification
- **GDPR / KDPA compliance** — data-subject rights (access, portability, erasure, objection), consent ledger, AES-256-GCM field encryption for special-category data, structured request-ID tracing

---

## Architecture

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   React Frontend │◄────►│  NestJS Backend  │◄────►│   PostgreSQL DB  │
│   (Vite + TS)    │ HTTP │   (REST + WS)    │      │   (via Prisma)   │
└──────────────────┘      └────────┬─────────┘      └──────────────────┘
                                   │
                          ┌────────┴─────────┐
                          │  Redis + BullMQ  │
                          │  (queues/cache)  │
                          └──────────────────┘
```

### Tech stack

| Layer         | Technology                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Frontend      | React 18, TypeScript, Vite, TailwindCSS, Radix UI, Zustand, React Query |
| Backend       | NestJS 11, TypeScript, Passport JWT, Socket.IO, BullMQ, Helmet          |
| Database      | PostgreSQL 15 + Prisma ORM                                              |
| Cache / Queue | Redis 7                                                                 |
| OCR / AI      | Gemini Vision, AI Vision API, Ollama (local), Tesseract                 |
| Notifications | Nodemailer (SMTP), Twilio, Africa's Talking, Socket.IO                  |
| Reports       | ExcelJS, PDFKit, pdf-lib                                                |
| Deployment    | Docker, Render, Alpine + OpenSSL                                        |

---

## Repository layout

```
claims/
├── backend/                  NestJS API server
│   ├── src/
│   │   ├── auth/             Authentication, 2FA, JWT, roles
│   │   ├── claims/           Core claims domain, eligibility, ML labels
│   │   ├── workflow/         Maker/checker queues + SLA tracking
│   │   ├── appeals/          Appeals adjudication
│   │   ├── payment/          Payment advice generation
│   │   ├── preauth/          Pre-authorisation
│   │   ├── policy/           Policy module
│   │   ├── system-config/    Runtime configuration
│   │   ├── notifications/    Email, SMS, WebSocket gateway
│   │   ├── ocr/              Gemini, Ollama, Tesseract pipelines
│   │   ├── reports/          Analytics & scorecards
│   │   ├── gdpr/             Data-subject rights API (Art. 15-22 / KDPA)
│   │   ├── common/
│   │   │   ├── filters/      Global HTTP exception filter
│   │   │   ├── middleware/   Request-ID middleware
│   │   │   └── services/     Field encryption, PII redaction, integrations
│   │   ├── mock-integrations/ EDMS + eOxegen stubs for local dev
│   │   └── ...
│   └── prisma/               Schema and migrations
├── frontend/                 React SPA
│   └── src/
│       ├── pages/            Route-level views
│       ├── components/       Shared UI
│       ├── hooks/            Custom React hooks
│       ├── services/         API client
│       └── store/            Zustand state stores
├── docs/
│   ├── gdpr/                 DPIA, RoPA, breach SOP, RBAC review, backup policy
│   └── ...                   MkDocs site — architecture, API, security, changelog
├── scripts/                  Repo-level shell helpers (e.g. build-redoc.sh)
├── perf/                     k6 performance suite (smoke + auth load)
├── k8s/                      Kubernetes manifests (namespace, backend, frontend)
└── docker-compose.yml        Local dev orchestration
```

---

## Quick start

### Prerequisites

- Node.js **20.19+**
- PostgreSQL **15+**
- Redis **7+**
- npm **9+**

### Local development

```bash
# 1. Clone
git clone https://github.com/Makaly/claimsflow.git
cd claimsflow

# 2. Backend
cd backend
cp .env.example .env       # fill in DATABASE_URL, JWT_SECRET, etc.
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev          # http://localhost:3000

# 3. Frontend (new shell)
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

### Docker

```bash
docker compose up --build
```

See [docker-compose.yml](docker-compose.yml) for service definitions.

---

## Environment variables

The backend reads configuration from `.env`. See [backend/.env.example](backend/.env.example) for the full list. Required keys:

| Variable         | Purpose                            |
| ---------------- | ---------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string       |
| `REDIS_URL`      | Redis connection string            |
| `JWT_SECRET`     | Secret used to sign access tokens  |
| `JWT_EXPIRY`     | Token lifetime (e.g. `1d`, `12h`)  |
| `SMTP_*`         | Outbound email                     |
| `TWILIO_*`       | SMS via Twilio                     |
| `AT_*`           | SMS via Africa's Talking           |
| `GEMINI_API_KEY`      | Google Gemini Vision (OCR)                                          |
| `OLLAMA_URL`          | Local Ollama server (optional)                                      |
| `DATA_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM field encryption (GDPR Art. 9). Generate with `openssl rand -hex 32` and store in the deployment secret store — **never commit this value**. |

> **Never commit `.env`.** Rotate API keys immediately if exposed. See [SECURITY.md](SECURITY.md).

---

## Scripts

### Backend

```bash
npm run start:dev       # nest start --watch
npm run build           # production build to dist/
npm run start:prod      # node dist/main
npm run prisma:migrate  # apply pending migrations
npm run prisma:seed     # seed demo users + reference data
npm run test            # unit tests
npm run lint            # ESLint + Prettier
```

### Frontend

```bash
npm run dev             # Vite dev server
npm run build           # tsc + vite build
npm run preview         # serve built bundle
npm run lint            # ESLint
npm test                # Vitest unit + a11y tests
npm run test:e2e        # Playwright browser e2e
npm run storybook       # Storybook dev server
npm run build-storybook # static Storybook bundle
npm run depcruise       # dependency-cruiser layering rules
```

---

## Documentation

| Surface           | Where                                                    |
| ----------------- | -------------------------------------------------------- |
| Project site      | `mkdocs serve` → http://localhost:8000 (built in CI)     |
| API (Swagger UI)  | http://localhost:4000/api/docs (live, while backend up)  |
| API (Redoc)       | `./scripts/build-redoc.sh` → `site/api/index.html`       |
| Architecture / SRD | [docs/architecture/](docs/architecture/)                 |
| GDPR / compliance  | [docs/gdpr/](docs/gdpr/)                                 |
| Changelog         | [CHANGELOG.md](CHANGELOG.md)                             |
| Security policy   | [SECURITY.md](SECURITY.md)                               |

---

## Roles

| Role             | Display Name           | Capabilities                                                                 |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `admin`          | Administrator          | Full system access, user/role management, system configuration               |
| `claims_officer` | Claims Officer         | Final invoice approver; adjudicates appeals; manages policy plans and members; SLA escalation target |
| `maker_checker`  | Maker-Checker          | Verifies captured invoice data; merges/splits documents; full document QA    |
| `fraud_officer`  | Fraud Officer          | Investigates fraud signals; issues cleared/confirmed verdicts; joins appeal threads |
| `finance`        | Finance Officer        | Views pending payments; generates and confirms payment advices; runs reports |
| `provider_admin` | Provider Administrator | Provider org owner — uploads invoices, manages branches                      |
| `provider_user`  | Provider User          | Provider branch staff — uploads invoices, views own claim status             |

> **v1.7 migration note:** `supervisor` was merged into `claims_officer` and `checker` into `maker_checker`. Existing users were migrated automatically via the `20260514000000_maker_checker_workflow_refactor` migration.

---

## Contributing

Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, commit-message style, and review checklist.

For security-sensitive issues, follow [SECURITY.md](SECURITY.md) — do not open a public issue.

---

## License

Released under the [MIT License](LICENSE).

---

<div align="center">

Built and maintained by the engineering team at **CIC Insurance Group PLC**.

</div>
