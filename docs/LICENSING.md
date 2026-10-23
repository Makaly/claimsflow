# Licensing & Activation

ClaimsFlow ships with two complementary licensing models. They can be used
independently or together:

| Model | Unit | Enforcement | Use case |
|-------|------|-------------|----------|
| **Subscription licensing** | a tenant | feature gating + monthly usage quotas | multi-tenant / cloud SaaS |
| **Installation licensing** | a deployed instance | online activation + phone-home heartbeat with offline lockout | on-prem / self-hosted |

Both rely on the same offline-verifiable cryptography: a single **Ed25519**
key-pair. The **private key** lives only on the issuing/license-server node; the
**public key** ships with every deployment and is used to verify signatures
without contacting a server.

```
LICENSE_PRIVATE_KEY   # issuer / license-server only — signs tokens & leases
LICENSE_PUBLIC_KEY    # every deployment — verifies tokens & leases offline
```

> Keys are never committed. `.env` and `*.pem` are in `.gitignore`. Generate a
> key-pair with the mint CLI (below) and store the private key in a secrets
> manager.

---

## 1. Subscription licensing (tenants)

Source: `backend/src/licensing/` · Admin UI: **Usage & License** (`/usage-license`)

### Tiers

The catalog is the single source of truth (`backend/src/licensing/plans.ts`) and
is served publicly at `GET /api/licenses/tiers`:

| Plan | Seats | Claims / mo | Extractions / mo | Highlights |
|------|-------|-------------|------------------|-----------|
| **Core** | 10 | 5,000 | 10,000 | Intake, OCR extraction, workflow |
| **Professional** | 50 | 50,000 | 120,000 | + fraud scoring, billing audit, appeals, provider portal, job setups |
| **Enterprise** | Unlimited | Unlimited | Unlimited | + multi-branch, white-label, SSO, audit logs, API, on-prem |

### Lifecycle

`TRIAL → ACTIVE → EXPIRED (read-only) → renewed`, with a separate
`SUSPENDED` (paused) state. An expired licence drops to **read-only** (GET
requests succeed, writes return `403 LICENSE_EXPIRED`); a paused subscription
blocks all access with `403 SUBSCRIPTION_PAUSED`. Status is recomputed on read
and auto-flips `ACTIVE → EXPIRED` once the term passes.

### Enforcement

- **Feature gating** — routes are gated with `@RequiresEntitlement(feature)` and
  `@RequiresPlan(tier)`; the `EntitlementGuard` returns `403` when a plan lacks a
  capability.
- **Metered usage** — `@Meter(metric)` + `UsageMeterInterceptor` record usage
  after a successful request. In `report` mode usage is metered but never
  blocked; in `enforce` mode an over-quota request returns `402`.

### Admin API (`/api/licenses`)

| Method & path | Role | Purpose |
|---------------|------|---------|
| `GET /tiers` | any auth | Public tier catalog |
| `GET /me` | any auth | Current tenant licence + live usage |
| `GET /all` | admin | All tenants' licence state |
| `GET /dashboard` | admin | Aggregate analytics (expiring soon, by plan/status) |
| `POST /apply/:tenantId` | admin | Issue / renew a licence |
| `POST /generate` | admin | Generate a licence key (optionally apply) |
| `POST /install` | admin | Install a signed token |
| `POST /pause-request/:tenantId` | admin | Pause / resume (credits paused days back) |
| `POST /billing-invoices` | admin | Create a per-seat invoice |
| `GET /preview-pdf/:tenantId` | admin | Branded PDF licence certificate |

### Issue a licence

From the **Usage & License** page: choose a tenant, plan and term, then
**Issue licence**. The per-row table actions provide **Renew / Pause / Resume**.
Alternatively mint a signed token (below) and paste it into the install box.

---

## 2. Installation licensing (phone-home)

Source: `backend/src/license-server/` (server) + `backend/src/installation/`
(client) · Admin UI: **Installation & Licence** (`/installation-license`)

This model licenses **each installed instance** of the system and keeps it
honest with a periodic online check-in.

### How it works

```
                ┌─────────────────────── License server (CIC) ───────────────────────┐
                │  holds LICENSE_PRIVATE_KEY · mints activation keys · signs leases   │
                └─────────────────────────────────────────────────────────────────────┘
                         ▲  activate(key)                 ▲  heartbeat (every 6h)
                         │  → signed 7-day lease          │  → fresh 7-day lease
   ┌─────────────────────┴───────────┐        ┌───────────┴─────────────────────────┐
   │ Installation A (LICENSE_SERVER_ │        │ Installation B …                     │
   │ URL set) caches & verifies lease│        │                                      │
   └─────────────────────────────────┘        └──────────────────────────────────────┘
```

1. **Identity** — each install generates a one-time installation ID on first
   boot (singleton `system_installation` row).
2. **Activation** — an admin enters an **activation key** (minted on the server).
   The install registers, the server binds the key to the installation, returns a
   one-time machine secret and a signed lease (plan, features, limits, expiry).
3. **Heartbeat** — a scheduled job (every 6 hours) calls the server, which
   re-signs a fresh lease valid for the lease window (default **7 days**).
4. **Offline lockout** — the install verifies the cached lease **offline** on
   every request. If it cannot refresh before the lease expires (i.e. roughly a
   week with no internet), the lease lapses and a global guard enforces
   **full lockout** (`403 INSTALLATION_LOCKED`) on every route except the
   reactivation/status endpoints, until a successful check-in.
5. **Remote control** — suspending or revoking an installation on the server
   takes effect on its next heartbeat.

Nodes without `LICENSE_SERVER_URL` set run in **standalone** mode and never lock
(used by the license-server node itself and by local development).

### Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `LICENSE_PRIVATE_KEY` | license-server node only | Signs leases |
| `LICENSE_PUBLIC_KEY` | every node | Verifies leases offline |
| `LICENSE_SERVER_URL` | customer installs | Enables phone-home + lockout (unset ⇒ standalone) |

### API

Machine endpoints (no auth — used by deployments over the internet):

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/license-server/activate` | activation key | Bind key → installation, return lease + secret |
| `POST /api/license-server/heartbeat` | `x-installation-secret` header | Refresh the lease |

Admin endpoints (`admin` role):

| Method & path | Purpose |
|---------------|---------|
| `POST /api/license-server/keys` | Mint activation keys |
| `GET /api/license-server/keys` | List keys |
| `POST /api/license-server/keys/:id/revoke` | Revoke a key |
| `GET /api/license-server/installations` | List installations + last-seen |
| `POST /api/license-server/installations/:id/{suspend,resume,revoke}` | Remote control |
| `GET /api/license-server/dashboard` | Fleet summary (online / stale) |

Installation (client) endpoints:

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/installation/status` | open (allow-listed) | Lock/licence state — drives the reactivation screen |
| `POST /api/installation/activate` | admin | Activate with a key |
| `POST /api/installation/heartbeat-now` | admin | Force an immediate check-in |

---

## Issuer CLI

Run by the licence operator only — never deployed to customers.

```bash
# One-time: generate the Ed25519 key-pair (prints both PEMs)
npx ts-node -r tsconfig-paths/register backend/src/scripts/license.ts keygen

# Mint a signed subscription token
LICENSE_PRIVATE_KEY="$(cat private.pem)" \
  npx ts-node -r tsconfig-paths/register backend/src/scripts/license.ts mint \
  --tenant <tenantId|null> --plan pro --type PRO --to "Acme Insurance" --months 12 --enforce
```

## Database

All licensing tables are added by additive, idempotent migrations:

- `…_add_licensing_e6`, `…_license_model_e7` — subscription model
  (`tenants` columns, `licenses`, `entitlements`, `usage_counters`,
  `license_pause_requests`, `license_billing_invoices`, `license_billing_payments`).
- `…_installation_licensing_e8` — installation model (`installations`,
  `activation_keys`, `system_installation`).

```bash
npx prisma generate
npx prisma migrate deploy   # or apply the SQL and `prisma migrate resolve --applied <name>`
```
