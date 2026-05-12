# CIC Medical Claims — Frontend

A production-grade medical claims management system built with React 18, TypeScript 5, and Vite. Designed for insurance companies to process, track, and manage medical claims end-to-end — from provider submission through maker/checker approval to final payment.

[![CI](https://github.com/Makaly/invoice_frontend/actions/workflows/ci.yml/badge.svg)](https://github.com/Makaly/invoice_frontend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![React](https://img.shields.io/badge/react-18.3-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/tailwind-3.4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Roles & Permissions](#roles--permissions)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Docker](#docker)
- [CI/CD](#cicd)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Overview

CIC Medical Claims is a role-based web application that digitises the end-to-end lifecycle of a medical insurance claim. Healthcare providers submit claims (individually or in bulk), and internal staff process them through a structured **maker → checker → supervisor** approval chain.

Key capabilities include client-side OCR for document extraction, a rich PDF viewer with annotation support, real-time workflow queues, comprehensive audit logging, and exportable analytics dashboards.

---

## Features

### Claims Processing
- Submit, view, update, and track medical claims throughout their full lifecycle
- Status tracking: `submitted → under_review → approved / rejected → paid`
- Priority flagging (`urgent`, `high`, `normal`, `low`)
- Barcode-based claim identification

### Maker / Checker Workflow
- **Four-eyes principle** enforced at the workflow level
- Dedicated queues for each role (Maker Queue, Checker Queue, Fraud Queue)
- Approval decisions with mandatory comments (`approved`, `rejected`, `returned`)
- Supervisor override capability for final approval

### Provider Management
- Register and manage healthcare providers (`hospital`, `clinic`, `pharmacy`, `lab`)
- Multi-step onboarding flow with document collection
- Branch management for multi-site providers
- Admin approval/rejection workflow with status tracking

### Document Management
- Drag-and-drop document upload with multi-format support
- **Client-side OCR** via Tesseract.js — no server round-trip for text extraction
- Feature-rich PDF viewer with 11 plugins: search, annotations, highlight, print, thumbnail, full-screen, and more
- Document type classification and unknown document resolution queue
- Canvas-based annotation and markup tools

### Batch Processing
- Bulk claim submission via CSV / Excel upload
- Real-time processing progress with per-row status
- Failed row reporting and re-submission support

### Reporting & Analytics
- Executive dashboard with live KPI cards and trend charts (Recharts)
- Workflow throughput metrics and queue depth visualisation
- Export reports to **XLSX** or **PDF**
- Activity log with full audit trail (user, action, IP, timestamp)

### Security & Access Control
- JWT authentication with automatic Bearer token attachment
- **TOTP-based two-factor authentication** (QR code setup flow)
- Role-based access control (RBAC) with granular permissions
- Automatic session invalidation on 401 responses
- Password reset flow with email verification

### UX
- Responsive layout with collapsible sidebar
- Dark / Light mode with persisted preference
- Toast notifications (Sonner)
- Accessible component primitives (Radix UI)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                  │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Router  │  │  Zustand     │  │   TanStack Query       │ │
│  │ (React   │  │  (Auth,      │  │   (Server-state cache, │ │
│  │  Router  │  │  Theme,      │  │    5-min stale time,   │ │
│  │  v6)     │  │  Claims)     │  │    1 retry)            │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Pages / Views                     │   │
│  │  Dashboard · Claims · MakerQueue · CheckerQueue      │   │
│  │  FraudQueue · Providers · BatchUpload · Reports      │   │
│  │  UserManagement · ActivityLogs · Settings · ...      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Shared Components                      │   │
│  │  Layout · Sidebar · Header · DocumentViewer          │   │
│  │  ClaimPacketViewer · AnnotationCanvas · Pagination   │   │
│  │  + 18 Radix UI primitives (Button, Dialog, ...)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Services (Axios)                       │   │
│  │  authService · claimsService · workflowService       │   │
│  │  providersService · batchService · userService       │   │
│  │  rbacService                                         │   │
│  │                                                      │   │
│  │  api.ts — base instance with request/response        │   │
│  │           interceptors (token attach, 401 redirect)  │   │
│  └──────────────────────────────────────────────────────┘   │
│                       │ /api/* proxy                        │
└───────────────────────┼─────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Backend REST API │
              │  (localhost:4000) │
              └──────────────────┘
```

**Data flow:** User interactions trigger React state updates. API calls go through the Axios service layer (auto-attaches JWT, handles 401 globally). Responses are cached by TanStack Query. Persistent UI state (auth session, theme preference) lives in Zustand stores backed by `localStorage`.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | React | 18.3 |
| Build tool | Vite | 5.3 |
| Language | TypeScript | 5.5 |
| Routing | React Router | 6 |
| Client state | Zustand | 4.5 |
| Server state | TanStack Query | 5 |
| Forms | React Hook Form + Zod | 7.5 + 3.2 |
| UI primitives | Radix UI | various |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 2.12 |
| PDF viewer | @react-pdf-viewer | 3.12 |
| OCR | Tesseract.js | 5.1 |
| HTTP client | Axios | 1.7 |
| Notifications | Sonner | 1.5 |
| Icons | Lucide React | 0.427 |
| Containerisation | Docker | — |

---

## Getting Started

### Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20.x |
| npm | 9.x |
| Backend API | Running on port 4000 |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Makaly/invoice_frontend.git
cd invoice_frontend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set VITE_API_BASE_URL to your backend URL

# 4. Start the development server
npm run dev
```

The app will be available at **http://localhost:3000**.

---

## Project Structure

```
.
├── .github/
│   ├── workflows/
│   │   └── ci.yml                  # GitHub Actions CI pipeline
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── pull_request_template.md
├── docs/
│   ├── architecture.md             # Detailed system architecture
│   ├── deployment.md               # Deployment guide (Docker, production)
│   └── roles-permissions.md        # RBAC reference
├── public/
│   └── pdf.worker.min.js           # PDF.js web worker
├── src/
│   ├── components/
│   │   ├── ui/                     # Radix-based primitive components
│   │   ├── AnnotationCanvas.tsx    # Canvas drawing/markup on PDFs
│   │   ├── ClaimPacketViewer.tsx   # Claim + documents side-by-side view
│   │   ├── DocumentViewer.tsx      # Full-featured PDF viewer with OCR
│   │   ├── Header.tsx              # Top navigation bar
│   │   ├── Layout.tsx              # App shell (Sidebar + Header + Outlet)
│   │   ├── Pagination.tsx          # Table pagination
│   │   ├── Sidebar.tsx             # Left navigation with role visibility
│   │   └── ...
│   ├── pages/
│   │   ├── Dashboard.tsx           # Executive KPI overview
│   │   ├── Claims.tsx              # Claims list with filters
│   │   ├── MakerQueue.tsx          # Initial maker review queue
│   │   ├── CheckerQueue.tsx        # Checker validation queue
│   │   ├── FraudQueue.tsx          # Fraud review queue
│   │   ├── Providers.tsx           # Provider management
│   │   ├── ProviderApprovals.tsx   # Admin provider approval
│   │   ├── BatchUpload.tsx         # Bulk CSV/Excel claim upload
│   │   ├── WorkflowDashboard.tsx   # Workflow metrics and queue status
│   │   ├── Reports.tsx             # Analytics and export
│   │   ├── UserManagement.tsx      # User CRUD and role assignment
│   │   ├── ActivityLogs.tsx        # Full audit log
│   │   └── ...
│   ├── services/
│   │   ├── api.ts                  # Axios base instance + interceptors
│   │   ├── authService.ts          # Login, register, 2FA
│   │   ├── claimsService.ts        # Claims CRUD and approval
│   │   ├── workflowService.ts      # Workflow queues and transitions
│   │   ├── providersService.ts     # Provider management
│   │   ├── batchService.ts         # Batch upload operations
│   │   ├── userService.ts          # User management
│   │   └── rbacService.ts          # Roles and permissions
│   ├── store/
│   │   ├── authStore.ts            # Auth state (user, token, login/logout)
│   │   ├── claimsStore.ts          # Claims cache
│   │   ├── batchSessionStore.ts    # Batch upload session state
│   │   └── themeStore.ts           # Dark/light mode with persistence
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces (User, Claim, Provider, ...)
│   ├── lib/
│   │   ├── utils.ts                # cn(), formatCurrency(), formatDate()
│   │   ├── fileCache.ts            # Document blob caching
│   │   ├── pdfBarcode.ts           # PDF barcode extraction
│   │   └── pdfTextExtract.ts       # PDF text extraction utilities
│   ├── hooks/
│   │   └── useUnknownDocCount.ts   # Unknown document count hook
│   ├── App.tsx                     # Router + ProtectedRoute + QueryClientProvider
│   └── main.tsx                    # React root bootstrap + PDF.js worker setup
├── .env.example                    # Environment variable template
├── Dockerfile                      # Docker image definition
├── tailwind.config.js              # Tailwind CSS configuration
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite configuration
└── package.json
```

---

## Roles & Permissions

The application enforces role-based access at both the route level (`ProtectedRoute` in `App.tsx`) and the UI level (conditional rendering based on the authenticated user's role).

| Role | Description | Key Access |
|---|---|---|
| `admin` | Full system access | User management, RBAC, settings, all queues, all reports |
| `supervisor` | Operations oversight | All queues, reports, workflow dashboard, provider approvals |
| `claims_officer` | Claim submission & maker review | Maker queue, claims creation, batch upload |
| `checker` | Four-eyes validation | Checker queue, claim review and decision |
| `fraud_officer` | Fraud investigation | Fraud queue, claim details, activity logs |
| `provider_admin` | Provider organisation admin | Provider dashboard, branch management, claim submission |
| `provider_user` | Provider branch user | Provider dashboard, claim submission (branch-scoped) |

See [`docs/roles-permissions.md`](docs/roles-permissions.md) for the full permission matrix.

---

## Environment Variables

Copy `.env.example` to `.env` and set the values:

```env
# URL of the backend REST API
VITE_API_BASE_URL=http://localhost:4000
```

> All client-side variables **must** be prefixed with `VITE_` to be included in the browser bundle.

During development, Vite proxies `/api/*` to `http://localhost:4000` (see `vite.config.ts`), so no CORS configuration is needed locally.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR on port 3000 |
| `npm run build` | Type-check (`tsc`) then build for production |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint across all source files |

---

## Docker

A `Dockerfile` is included for containerised development:

```bash
# Build the image
docker build -t cic-claims-frontend .

# Run the container
docker run -p 3000:3000 --env-file .env cic-claims-frontend
```

For production deployments, build the static assets with `npm run build` and serve the `dist/` directory from a web server such as Nginx. See [`docs/deployment.md`](docs/deployment.md) for a complete production deployment guide.

---

## CI/CD

GitHub Actions runs on every push to `main` or `develop`, and on all pull requests targeting `main`:

1. **Checkout** — fetch the repository
2. **Node.js setup** — Node 20 with npm cache
3. **Install** — `npm ci` (clean install from lock file)
4. **Lint** — `npm run lint`
5. **Build** — `npm run build` (type-check + Vite build)
6. **Audit** — `npm audit --audit-level=high`
7. **Upload artifact** — `dist/` retained for 7 days

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. In summary:

1. Fork the repository and create a feature branch from `main`
2. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
3. Ensure `npm run lint` and `npm run build` both pass
4. Open a PR using the provided template

---

## Security

To report a security vulnerability, please follow the process outlined in [SECURITY.md](SECURITY.md). **Do not open a public issue for security vulnerabilities.**

---

## License

This project is licensed under the [MIT License](LICENSE).
