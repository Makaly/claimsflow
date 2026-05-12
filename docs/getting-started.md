# Getting started

## Prerequisites

- Node 20+ (`.nvmrc` is the source of truth)
- PostgreSQL 14+
- Redis 7+
- Python 3.10+ (only needed to build the docs site)

## Install

```bash
# backend
cd backend
npm ci --legacy-peer-deps
npx prisma generate

# frontend
cd ../frontend
npm ci
```

## Run locally

```bash
# in one terminal — backend
cd backend && npm run start:dev

# in another — frontend
cd frontend && npm run dev
```

The frontend dev server proxies `/api` to `http://localhost:4000` (see
`frontend/vite.config.ts`).

## Test

```bash
# backend unit + e2e
cd backend
npm test
npm run test:e2e

# frontend unit + component + a11y
cd ../frontend
npm test

# frontend end-to-end (Playwright)
npm run test:e2e
```
