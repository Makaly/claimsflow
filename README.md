<div align="center">

# ClaimsFlow

**End-to-end medical claims automation platform for CIC Insurance Group PLC**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/Makaly/claimsflow/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![NestJS](https://img.shields.io/badge/backend-NestJS%2010-e0234e)](https://nestjs.com/)
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
| Backend       | NestJS 10, TypeScript, Passport JWT, Socket.IO, BullMQ, Helmet          |
| Database      | PostgreSQL 15 + Prisma ORM                                              |
| Cache / Queue | Redis 7                                                                 |
| OCR / AI      | Google Gemini Vision, Anthropic API, Ollama, Tesseract                  |
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
│   │   ├── claims/           Core claims domain + eligibility service
│   │   ├── workflow/         Maker/checker queues + SLA tracking
│   │   ├── appeals/          Appeals adjudication
│   │   ├── payment/          Payment advice generation
│   │   ├── preauth/          Pre-authorisation
│   │   ├── system-config/    Runtime configuration
│   │   ├── notifications/    Email, SMS, WebSocket gateway
│   │   ├── ocr/              Gemini, Ollama, Tesseract pipelines
│   │   ├── reports/          Analytics & scorecards
│   │   └── ...
│   └── prisma/               Schema and migrations
├── frontend/                 React SPA
│   └── src/
│       ├── pages/            Route-level views
│       ├── components/       Shared UI
│       ├── hooks/            Custom React hooks
│       ├── services/         API client
│       └── store/            Zustand state stores
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
| `GEMINI_API_KEY` | Google Gemini Vision (OCR)         |
| `OLLAMA_URL`     | Local Ollama server (optional)     |

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
```

---

## Roles

| Role       | Capabilities                                                      |
| ---------- | ----------------------------------------------------------------- |
| `admin`    | Full access, user/role management, system configuration           |
| `maker`    | Create, edit, and submit claims for checking                      |
| `checker`  | Approve, reject, or return claims; final adjudication authority   |
| `fraud`    | Review flagged claims, investigate anomalies                      |
| `provider` | Submit claims, view status, file appeals, view payment advice     |

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
