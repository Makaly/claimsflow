# System Architecture

This document describes the architectural decisions, data flow, and structural conventions of the CIC Medical Claims frontend.

---

## High-Level Overview

The application is a **single-page application (SPA)** served by Vite. It communicates with a REST API backend over HTTP. There is no server-side rendering — all routing, state management, and rendering happen in the browser.

```
Browser (React SPA)
│
├── React Router v6 — client-side routing + ProtectedRoute guards
├── TanStack Query v5 — server state cache (API responses)
├── Zustand — client state (auth session, theme, claims cache)
│
├── Pages — route-level components (25+ pages)
├── Components — shared domain + UI primitive components
├── Services — Axios-based API clients per resource
├── Stores — Zustand state slices
├── Types — shared TypeScript interfaces
└── Lib — pure utility functions
```

---

## Routing

Routes are defined in `src/App.tsx`. All authenticated routes are wrapped in a `ProtectedRoute` component that:

1. Checks `authStore` for a valid session
2. Redirects unauthenticated users to `/login`
3. Checks the user's role against the route's `allowedRoles` array
4. Renders a 403 screen if the role is not permitted

Public routes (no auth required):
- `/login`
- `/register`
- `/forgot-password`
- `/terms`
- `/privacy`

All other routes require authentication and at least one matching role.

---

## State Management

Two complementary state layers are used, each for a different concern:

### Zustand (client / UI state)

| Store | Responsibility |
|---|---|
| `authStore` | Authenticated user object, JWT token, `isAuthenticated` flag, `login()` / `logout()` actions |
| `themeStore` | `dark` / `light` mode preference, persisted to `localStorage` |
| `claimsStore` | Client-side claims cache with `fetchFromServer`, `addClaim`, `updateClaim` |
| `batchSessionStore` | Batch upload session: uploaded rows, processing state, progress counters |

### TanStack Query (server / async state)

Used for all API data that should be cached, deduplicated, or refetched on window focus. Default configuration:

```ts
staleTime: 5 * 60 * 1000   // 5 minutes
retry: 1
```

---

## API Service Layer

All HTTP calls go through `src/services/api.ts` — an Axios instance with two interceptors:

**Request interceptor** — reads the JWT from `localStorage` and attaches it as `Authorization: Bearer <token>` to every outgoing request.

**Response interceptor** — on a `401 Unauthorized` response, clears `token` and `user` from `localStorage` and redirects to `/login`. This handles expired or revoked tokens globally without any per-component handling.

Individual service modules wrap the Axios instance:

| Service | Resource |
|---|---|
| `authService` | `/auth` — login, register, logout, 2FA verify |
| `claimsService` | `/claims` — CRUD, approve, reject |
| `workflowService` | `/workflow` — queue fetching, stage transitions |
| `providersService` | `/providers` — CRUD, approve |
| `batchService` | `/batch` — upload, status polling |
| `userService` | `/users` — CRUD, password change |
| `rbacService` | `/roles`, `/permissions` — role and permission management |

---

## Component Architecture

Components are split into two categories:

### `src/components/ui/`
Unstyled, accessible **primitive components** built on top of [Radix UI](https://www.radix-ui.com/). These have no domain knowledge — they are pure UI building blocks (Button, Dialog, Input, Select, Table, etc.).

### `src/components/`
**Domain components** that combine primitives with business logic:

| Component | Responsibility |
|---|---|
| `Layout` | App shell — renders Sidebar + Header + `<Outlet />` |
| `Sidebar` | Left navigation with role-based link visibility |
| `Header` | Top bar with user menu, notifications, and theme toggle |
| `DocumentViewer` | Full-featured PDF viewer (react-pdf-viewer + 11 plugins + Tesseract OCR) |
| `ClaimPacketViewer` | Side-by-side claim detail and document viewer |
| `AnnotationCanvas` | Canvas overlay for PDF markup and annotation |
| `PdfViewerModal` | Modal wrapper around DocumentViewer |
| `InlineDocumentPreview` | Compact inline document thumbnail |
| `Pagination` | Controlled pagination component for data tables |
| `ProviderOnboarding` | Multi-step provider registration wizard |
| `OnboardingPacketReview` | Admin review panel for provider onboarding documents |
| `ProviderApprovalGate` | UI gate that blocks access for pending providers |

---

## Document Processing

Document processing is performed entirely **client-side** to avoid uploading raw files to intermediate processing services.

**OCR pipeline:**
1. User uploads a document (PDF or image) via `react-dropzone`
2. `pdfTextExtract.ts` attempts to extract embedded text from PDFs using `pdfjs-dist`
3. If the PDF is scanned (no embedded text), `Tesseract.js` runs OCR on each rendered page
4. Extracted text and confidence scores are stored against the document record
5. `pdfBarcode.ts` scans for barcodes within PDFs for claim matching

**PDF viewing:**
- `@react-pdf-viewer/core` renders PDFs using a `pdf.worker.min.js` web worker (served from `/public`)
- Active plugins: `bookmark`, `default-layout`, `full-screen`, `highlight`, `print`, `rotate`, `scroll-mode`, `search`, `selection-mode`, `thumbnail`, `toolbar`

---

## Styling

- **Tailwind CSS v3** utility-first styling with a custom design system defined via CSS custom properties (HSL colour variables)
- Dark mode uses Tailwind's `class` strategy — the `dark` class is toggled on the `<html>` element by `themeStore`
- Custom colours: `sidebar-*` and `chart-*` palette extensions
- `@tailwindcss/forms` plugin for consistent form element styling
- `clsx` + `tailwind-merge` combined in the `cn()` utility (`src/lib/utils.ts`) for conditional class composition

---

## Build & Bundling

| Concern | Solution |
|---|---|
| Dev server | Vite 5 on port 3000 with HMR |
| API proxy | `/api/*` → `http://localhost:4000` (no CORS config needed in dev) |
| Path alias | `@/` → `src/` (TypeScript + Vite both configured) |
| OCR worker | `tesseract.js` excluded from Vite dep optimisation (runs in its own worker) |
| PDF worker | `pdfjs-dist` worker served as a static file from `/public/pdf.worker.min.js` |
| Production build | `tsc -b && vite build` outputs to `dist/` |

---

## Security Architecture

- **Authentication:** JWT tokens stored in `localStorage`; cleared on logout and on 401
- **Route guards:** `ProtectedRoute` checks role before rendering any protected page
- **Input validation:** Zod schemas validate all form data client-side before API submission
- **2FA:** TOTP secrets generated server-side; QR code displayed once during setup
- **No secrets in bundle:** Only `VITE_`-prefixed variables are included in the browser build

---

## Key Conventions

1. **TypeScript strict mode** — `noImplicitAny`, `strictNullChecks` enabled
2. **`@/` imports** — use the alias instead of relative paths for `src/` imports
3. **`PascalCase.tsx`** — all component files
4. **`camelCase.ts`** — all service, store, and utility files
5. **Zod + React Hook Form** — all forms use schema-based validation
6. **Conventional Commits** — all commit messages follow the spec (see `CONTRIBUTING.md`)
