# ClaimsFlow — Zero-Trust Authentication & Authorization Design

**Status:** Draft for review
**Owners:** Platform Security
**Last updated:** 2026-05-19
**Target compliance:** SOC 2 Type II, ISO 27001, GDPR Art. 32, PCI DSS 4.0 (cardholder data scope)

---

## 0. Executive Summary

ClaimsFlow already ships a working auth stack (NestJS + Passport-JWT + cookie sessions, RBAC with 8 roles and 33 permissions, an append-only `activity_logs` table, Helmet/CSP/HSTS hardening, throttling on `/auth/*`, and TOTP MFA with backup codes). The gap between today's implementation and a financial-grade zero-trust target is real but tractable; this document specifies what to add, how to fit it into the existing modules, and the order to ship it.

### 0.1 Gap map (today → target)

| Area                       | Today                                       | Target                                                                       | Effort   |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Password hashing           | bcrypt cost 10                              | **Argon2id** + server-side pepper + history(5) + HIBP k-anonymity check      | S        |
| MFA                        | TOTP + backup codes                         | TOTP + **WebAuthn/passkeys** + email-OTP fallback + **step-up on approvals** | M        |
| Federation                 | None                                        | **OIDC** + **SAML 2.0** + LDAP/AD via SCIM provisioning                      | L        |
| Sessions                   | Single JWT, 1d/30d cookie                   | Access(10m) + **refresh-rotation with family detection** + device binding    | M        |
| Authorization              | RBAC                                        | RBAC + **ABAC (OPA/Cedar)** + tenant scope enforced server- and DB-side      | M        |
| Tenant isolation           | Code-enforced `providerId` filter           | **Postgres row-level security** + tenant-scoped pools                        | M        |
| Workflow                   | State machine + ClaimApproval table         | + **hash-chained audit** + **cryptographic approval signatures** + step-up   | M        |
| API surface                | Cookie+Throttler                            | + **CSRF double-submit** + **request signing** for `/payments`, `/exports`   | S        |
| Documents                  | Magic-byte sniff (pdf/png/jpg)              | + **ClamAV/YARA** + **PDF sanitizer** + EXIF/XMP strip + visible watermark   | M        |
| Risk engine                | None                                        | **Adaptive auth** (impossible travel, new device, VPN/Tor, behaviour)        | L        |
| Audit                      | Append-only `activity_logs`                 | + **hash chain** + **WORM export** + DB triggers blocking UPDATE/DELETE      | S        |
| Headers                    | Helmet + custom Permissions-Policy          | + tighter CSP (nonce-based, no `unsafe-inline`) + **Trusted Types**          | S        |

**Effort:** S = ≤1 sprint, M = 1–2 sprints, L = 2–4 sprints.

### 0.2 Guiding principles

1. **Zero trust** — never trust the network. Every request re-validates user, tenant, device, and risk.
2. **Defence in depth** — overlap controls: server-side filter, JWT scope, RLS, audit log, request signature. Any single failure must not compromise tenant isolation.
3. **Fail closed** — when the risk engine or audit pipeline is unavailable, sensitive operations (approve, export, payment) reject the request.
4. **Boring crypto** — use established primitives (Argon2id, RS256/EdDSA, AES-GCM, HKDF). No bespoke schemes.
5. **Reversible by design** — every privilege grant has an expiry; every elevated session re-auths via step-up MFA.

---

## 1. Authentication Architecture

### 1.1 Identity providers (federated stack)

```
                       ┌──────────────────────────┐
                       │   ClaimsFlow Gateway      │
                       │   (NestJS + Passport)     │
                       └────────────┬──────────────┘
                                    │
        ┌───────────────┬──────────┴───────────┬──────────────────┐
        │               │                      │                  │
   ┌────▼────┐    ┌─────▼─────┐         ┌──────▼──────┐    ┌──────▼──────┐
   │ Local   │    │  OIDC     │         │  SAML 2.0   │    │  LDAP/AD    │
   │ (email+ │    │  (Google, │         │  (Okta,     │    │  (Active    │
   │ Argon2) │    │  Azure AD)│         │   ADFS,     │    │   Directory │
   │         │    │           │         │   PingFed)  │    │   via SCIM) │
   └─────────┘    └───────────┘         └─────────────┘    └─────────────┘
                                    │
                       ┌────────────▼──────────────┐
                       │  Account linker           │
                       │  (one User → many Identity│
                       │   rows; tenant scoped)    │
                       └───────────────────────────┘
```

- **Local credentials** stay the default for retail/CIC-internal users. Argon2id, server pepper, breach-checked.
- **OIDC** is the path for B2B partners using Google / Microsoft / Auth0.
- **SAML 2.0** is the enterprise tenant path (Okta, ADFS, Ping). Each tenant configures their own IdP via `tenant_identity_provider` rows.
- **LDAP/AD** is provisioning + sync via **SCIM 2.0**: nightly user/group sync from the tenant's directory creates/disables ClaimsFlow accounts.
- **WebAuthn passkeys** are not an IdP — they are an MFA factor and (when paired with usernameless flows) a passwordless login method on top of the local provider.

### 1.2 Local login flow (target)

1. POST `/auth/login` with `{email, password, tenantHint?}`.
2. Risk engine pre-check: rate-limit bucket, IP reputation, prior-failure count.
3. Look up user; verify password with `argon2.verify(stored, plaintext + PEPPER)`.
4. Check breach status of plaintext (HaveIBeenPwned k-anonymity: send SHA-1[0:5] only, deny if `count >= 1` and policy is strict).
5. If MFA enrolled, return `202 {mfaChallenge: 'totp'|'webauthn'|'email_otp', sessionTicket}` — no cookie issued yet.
6. After successful MFA, mint **access** (10 min, JWT in `Authorization` header for non-browser clients; in HttpOnly cookie for browsers) and **refresh** (sliding 7d, hashed in DB, family-tracked).
7. Bind session to a `device_id` (set as HttpOnly `__Host-cf_device` cookie, random 256-bit, persistent across logins).
8. Risk engine records the session: IP, ASN, UA, geo, prior device match → `risk_score (0–100)`.
9. Activity log: `login.success` with full context (redacted password).

### 1.3 Password policy

```ts
// backend/src/auth/policies/password.policy.ts
export const PASSWORD_POLICY = {
  algo: 'argon2id',
  argon2: { memoryCost: 65_536, timeCost: 3, parallelism: 1, hashLength: 32 },
  pepper: process.env.AUTH_PEPPER, // 256-bit, in KMS, rotated yearly
  minLength: 12,
  maxLength: 128,
  requireClasses: 3,               // any 3 of: lower, upper, digit, symbol
  passphrasesAllowed: true,        // ≥4 dictionary words bypasses class rule
  forbidCommonTop10k: true,        // baked-in wordlist
  hibpCheck: 'strict',             // deny if seen in any breach
  historyDepth: 5,                 // can't reuse last 5
  maxAgeDays: 365,                 // expiry; soft-prompt at 335
  resetTokenLifetime: '15m',
};
```

- Argon2id parameters chosen for ~200ms hash time on the reference 4-vCPU container — tune `memoryCost` per environment.
- **Pepper** lives in AWS Secrets Manager / HashiCorp Vault, *not* the DB. Rotation procedure: dual-hash period of 30 days where both old and new pepper are accepted; users transparently re-hashed on next login.
- Password history is stored as **hashes** in `password_history` (not plaintext).

### 1.4 Multi-factor authentication

| Factor          | Use case                              | Strength | Implementation                                    |
| --------------- | ------------------------------------- | -------- | ------------------------------------------------- |
| **WebAuthn**    | Primary 2nd factor; also passwordless | AAL3     | `@simplewebauthn/server` + `@simplewebauthn/browser` |
| **TOTP**        | Default for users without security keys | AAL2   | Existing `two-factor.service.ts` (keep)           |
| **Backup codes**| Recovery only                          | AAL2     | Existing — bcrypt-hashed, single-use              |
| **Email OTP**   | Low-trust fallback only (NOT step-up)  | AAL1     | 6-digit, 10-min TTL, max 3 sends/hour             |
| **Push/biometric** | Future (mobile app)                 | AAL2/3   | Out of scope for v1                               |

**Step-up MFA matrix (re-prompt even within an active session):**

| Action                                     | Required factor             | Re-auth window |
| ------------------------------------------ | --------------------------- | -------------- |
| Approve claim < 100k KES                   | None (session sufficient)   | —              |
| Approve claim ≥ 100k KES                   | TOTP **or** WebAuthn        | 5 min          |
| Approve claim ≥ 1M KES                     | WebAuthn (mandatory)        | 5 min          |
| Trigger payment release                    | WebAuthn (mandatory)        | 5 min          |
| Export PII / bulk data                     | TOTP **or** WebAuthn        | 10 min         |
| Change role / permission of another user   | WebAuthn (mandatory)        | 5 min          |
| Edit/disable own MFA                       | Same factor + email confirm | 5 min          |

Step-up is implemented as a `@RequireStepUp({ minFactor: 'webauthn', maxAgeSec: 300 })` decorator on the controller method; the guard inspects `last_strong_auth_at` on the session.

### 1.5 Session model

- **Access token** — JWT, RS256-signed, **10-minute** lifetime, contains the full payload (see §5).
- **Refresh token** — opaque 256-bit random, stored hashed (SHA-256) in `auth_sessions`. Each refresh **rotates** (issue new, mark old `superseded`).
- **Family detection** — every refresh chain has a `family_id`. If a *superseded* token is presented again, the entire family is revoked (probable theft).
- **Idle timeout** — 30 min for non-elevated, 10 min for elevated sessions (post step-up).
- **Absolute timeout** — 12 h for regular sessions, 8 h for elevated.
- **Concurrent sessions** — capped at 5 active per user by default; UI shows active sessions and allows revoke-all-others.
- **Device binding** — refresh tokens are scoped to a `device_id`; presenting a refresh from a different device fingerprint is rejected and triggers a `risk.device_mismatch` event.

---

## 2. Authorization Model — RBAC + ABAC

### 2.1 Layered authorization

```
   Request
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 1 — Coarse: RolesGuard                                 │
│   Does the user hold any role with the required permission?  │
└──────────────────────────────────────────────────────────────┘
      │  (yes)
      ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 2 — ABAC policy engine (OPA or Cedar)                  │
│   Evaluate attributes: tenant, amount, region, time, device  │
│   trust, workflow state, ownership.                          │
└──────────────────────────────────────────────────────────────┘
      │  (allow)
      ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 3 — Tenant scope                                       │
│   Postgres SET app.current_tenant = $1; RLS enforces.        │
└──────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 4 — Object-level check                                 │
│   For object-bound actions: did the loaded row belong to     │
│   this tenant? (Defence-in-depth against RLS bypass).        │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Roles (canonical, per tenant)

| Role               | Scope        | Sample permissions                                                  |
| ------------------ | ------------ | ------------------------------------------------------------------- |
| `tenant_admin`     | tenant-wide  | `roles.*`, `users.*`, `system_config.*`, `audit_logs.read`         |
| `finance_manager`  | tenant-wide  | `payments.release`, `invoices.approve`, `reports.financial.read`    |
| `claims_officer`   | tenant-wide  | `claims.review`, `claims.adjudicate`, `documents.read`              |
| `invoice_reviewer` | branch / dept| `invoices.review`, `invoices.flag`, `documents.read`                |
| `data_entry`       | branch       | `invoices.create`, `documents.upload`                               |
| `auditor`          | read-only    | `audit_logs.read`, `reports.*.read`, `exports.create`               |
| `external_partner` | tenant-wide  | `documents.upload` (only via `/partner/upload`)                     |

The 8 existing roles map cleanly — only `invoice_reviewer` and `external_partner` are net-new. Existing `maker_checker`, `fraud_officer`, `provider_admin`, `provider_user` remain.

### 2.3 ABAC: Cedar policies

Cedar (AWS Verified Permissions) is a typed, schema-validated policy language. Example:

```cedar
// policies/approvals.cedar
permit (
    principal in Role::"finance_manager",
    action == Action::"ApproveInvoice",
    resource is Invoice
) when {
    resource.tenantId == principal.tenantId &&
    resource.amount <= principal.approvalLimit &&
    resource.state == "verified" &&
    context.deviceTrust >= 2 &&
    context.timeOfDay >= 6 && context.timeOfDay < 22
};

forbid (
    principal,
    action,
    resource
) when {
    context.riskScore >= 80
};
```

Evaluation happens in-process via the Cedar JS SDK; policies are versioned in `policies/`, signed, and hot-loaded on change with a fallback to last-known-good if parse fails.

### 2.4 NestJS plumbing

```ts
// backend/src/authz/permissions.decorator.ts
export const RequirePermission = (perm: PermissionKey) =>
  SetMetadata('permission', perm);

// backend/src/authz/policy.decorator.ts
export const RequirePolicy = (action: string) =>
  SetMetadata('cedarAction', action);

// usage
@Post(':id/approve')
@UseGuards(JwtAuthGuard, PermissionsGuard, PolicyGuard, StepUpGuard)
@RequirePermission('invoices.approve')
@RequirePolicy('ApproveInvoice')
@RequireStepUp({ minFactor: 'webauthn', maxAgeSec: 300 })
async approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { … }
```

`PolicyGuard` builds a Cedar entity from `user + invoice + request context` and asks Cedar for a decision. Deny is logged with the policy ID that produced it for audit traceability.

---

## 3. Multi-tenant Isolation

### 3.1 Three layers of enforcement

1. **JWT scope** — every access token carries `tenant_id`; middleware refuses any request whose URL/body references a different tenant.
2. **Postgres row-level security** — `tenant_id` column on every tenant-owned table, RLS policy filters by `current_setting('app.current_tenant')`. The app sets it once per connection (per transaction in pooled mode).
3. **Application-level filter** — keep the existing `where: { providerId }` in services. Belt and braces.

### 3.2 RLS migration sketch

```sql
-- 20260601_enable_rls.sql
ALTER TABLE "Claim"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch"           ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Claim"
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation ON "Invoice"
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Audit table: read scoped to tenant, but writes are unrestricted (handled at app layer)
CREATE POLICY tenant_isolation_read ON "ActivityLog"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Service account bypasses RLS for cross-tenant maintenance
CREATE ROLE claimsflow_app    LOGIN PASSWORD '…';   -- normal app
CREATE ROLE claimsflow_ops    LOGIN PASSWORD '…' BYPASSRLS;  -- migrations, backfills
GRANT claimsflow_app TO authenticator;
```

### 3.3 Connection plumbing

Prisma connections are pulled from a tenant-aware pool wrapper:

```ts
// backend/src/prisma/tenant-prisma.service.ts
export class TenantPrismaService {
  constructor(private readonly base: PrismaService) {}
  forTenant(tenantId: string) {
    return this.base.$extends({
      query: {
        async $allOperations({ args, query }) {
          return this.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL app.current_tenant = '${tenantId}'`,
            );
            return query(args);
          });
        },
      },
    });
  }
}
```

`tenantId` flows in from the JWT via the request scope and is *never* read from request body/query.

### 3.4 IDOR defences

- Every URL parameter that names an object (`:claimId`, `:invoiceId`) routes through a loader that re-asserts tenant scope: `findByIdInTenant(id, tenantId)` returns `404` (not `403`) on mismatch — no information leak.
- Object IDs are **UUIDv7** (lexicographically sortable, unguessable). No incrementing IDs.
- Signed URLs for document downloads carry tenant + user + expiry in the signature.

### 3.5 No shared caches across tenants

- Redis keys are namespaced: `tenant:{tenantId}:claim:{id}`.
- Bull queues are tenant-prefixed: `tenant:{tenantId}:ocr`.
- In-process LRU caches keyed by `(tenantId, recordId)` tuple.
- A static-analysis lint rule forbids `redis.get(/*non-templated*/)` outside the cache helper.

---

## 4. Database Schema

Additions on top of the existing schema. Existing tables (`User`, `Role`, `Permission`, `UserRole`, `ActivityLog`, `Claim`, `Invoice`, `Document`, `ClaimApproval`) keep their names — new columns/tables are listed below.

```prisma
// ── Tenants (rename Provider → Tenant where appropriate, or keep as alias) ──
model Tenant {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  name            String
  region          String?
  identityProviders TenantIdentityProvider[]
  retentionDays   Int      @default(2557)  // 7y default
  createdAt       DateTime @default(now())
}

model TenantIdentityProvider {
  id            String  @id @default(uuid())
  tenantId      String
  kind          String  // 'oidc' | 'saml' | 'ldap'
  issuer        String
  metadataXml   String? // SAML
  clientId      String? // OIDC
  clientSecret  String? @db.Text   // KMS-encrypted
  jwksUri       String?
  defaultRole   String  @default("data_entry")
  scimToken     String? @db.Text   // hashed
  enabled       Boolean @default(true)
  tenant        Tenant  @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, kind, issuer])
}

// ── Sessions / refresh chain ────────────────────────────────────────────────
model AuthSession {
  id              String    @id @default(uuid())
  userId          String
  tenantId        String
  familyId        String                                  // refresh family
  parentId        String?                                 // previous token in chain
  refreshTokenHash String   @unique                      // sha256(plaintext)
  deviceId        String
  ip              String
  userAgent       String
  asn             String?
  geoCountry      String?
  geoCity         String?
  riskScore       Int      @default(0)
  issuedAt        DateTime @default(now())
  expiresAt       DateTime
  lastUsedAt      DateTime @default(now())
  status          String   @default("active")  // active | superseded | revoked | reused
  revokedReason   String?
  user            User     @relation(fields: [userId], references: [id])
  @@index([userId, status])
  @@index([familyId])
  @@index([deviceId])
}

model Device {
  id            String   @id @default(uuid())
  userId        String
  fingerprint   String                          // hash of UA+screen+TZ+platform
  label         String?                         // user-supplied "Work laptop"
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())
  trustLevel    Int      @default(1)            // 0=untrusted, 1=known, 2=trusted, 3=corp-managed
  user          User     @relation(fields: [userId], references: [id])
  @@unique([userId, fingerprint])
}

// ── Identity linking (one User → many credentials) ──────────────────────────
model Identity {
  id            String   @id @default(uuid())
  userId        String
  providerKind  String   // 'local' | 'oidc' | 'saml' | 'ldap' | 'webauthn'
  providerId    String?  // TenantIdentityProvider.id, or null for local/webauthn
  subject       String   // sub claim, NameID, DN, credentialId
  email         String?
  metadata      Json?
  createdAt     DateTime @default(now())
  user          User     @relation(fields: [userId], references: [id])
  @@unique([providerKind, providerId, subject])
}

model WebAuthnCredential {
  id              String   @id @default(uuid())
  userId          String
  credentialId    Bytes    @unique
  publicKey       Bytes
  signCount       BigInt
  aaguid          String?
  transports      String[]
  nickname        String?
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?
  user            User     @relation(fields: [userId], references: [id])
}

// ── Passwords ───────────────────────────────────────────────────────────────
model PasswordHistory {
  id        String   @id @default(uuid())
  userId    String
  hash      String                              // argon2id, includes salt
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId, createdAt])
}

// ── Permissions (already exist; add ABAC fields) ────────────────────────────
model Permission {
  id          String   @id @default(uuid())
  key         String   @unique              // 'invoices.approve'
  description String?
  scopes      String[]                      // optional ABAC scopes: ['tenant','branch']
}

// ── Approval signatures ─────────────────────────────────────────────────────
model ApprovalSignature {
  id            String   @id @default(uuid())
  approvalId    String   @unique
  algo          String                       // 'ed25519'
  keyId         String                       // user's signing key id
  payloadHash   String                       // sha256 of canonical approval payload
  signature     Bytes
  signedAt      DateTime @default(now())
  approval      ClaimApproval @relation(fields: [approvalId], references: [id])
}

// ── Audit hash chain ────────────────────────────────────────────────────────
model AuditLog {
  // Existing columns retained — add:
  prevHash      String?                      // sha256 of previous row's content
  contentHash   String                       // sha256(canonical(this row sans hashes))
  signature     Bytes?                       // hourly chain root signature
  @@index([createdAt])
}

// ── Risk events ─────────────────────────────────────────────────────────────
model RiskEvent {
  id          String   @id @default(uuid())
  userId      String?
  sessionId   String?
  kind        String   // 'impossible_travel'|'new_device'|'vpn_detected'|...
  score       Int      // contribution
  details     Json
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
}

// ── Step-up challenges ──────────────────────────────────────────────────────
model StepUpChallenge {
  id            String   @id @default(uuid())
  sessionId     String
  action        String                       // 'invoices.approve'
  resourceId    String?
  method        String                       // 'webauthn'|'totp'
  challenge     String                       // base64url
  expiresAt     DateTime
  consumedAt    DateTime?
  @@index([sessionId, expiresAt])
}
```

---

## 5. JWT Structure

### 5.1 Access token claims

```json
{
  "iss": "https://api.claimsflow.cic.co.ke",
  "aud": "claimsflow-web",
  "sub": "u_01HV…",                  // user_id (UUIDv7)
  "iat": 1716130000,
  "exp": 1716130600,                 // +10 min
  "nbf": 1716130000,
  "jti": "tok_01HV…",                // unique per token
  "tid": "t_01HV…",                  // tenant_id
  "sid": "s_01HV…",                  // session_id (auth_sessions row)
  "did": "d_01HV…",                  // device_id
  "roles": ["finance_manager"],
  "perms": ["invoices.approve", "payments.release", ...],
  "aal": 2,                          // authenticator assurance level
  "amr": ["pwd", "webauthn"],        // auth methods used
  "lsa": 1716130000,                 // last_strong_auth_at (for step-up)
  "rsk": 12,                         // risk_score 0–100
  "scp": "api:full"                  // OAuth-style scope
}
```

### 5.2 Signing

- Algorithm: **RS256** (asymmetric, allows gateway/edge verification with public JWKS).
- Keys: 2048-bit RSA, rotated **every 90 days** via JWKS endpoint with overlap window.
- Storage: private key in AWS KMS / HashiCorp Vault Transit; signing happens via Vault to keep key out of app memory.
- `kid` header always present; verifiers cache JWKS for 15 min.

### 5.3 Revocation

JWTs are short-lived (10 min) — the primary revocation strategy is "wait it out". For instant revocation:

1. Add `jti` to a Redis **denylist** with TTL = token's remaining lifetime.
2. The `JwtAuthGuard` checks the denylist on every request.
3. Revoke-all-sessions emits a fan-out: every session's current JTI hits the denylist; refresh tokens flipped to `revoked`.

### 5.4 What does **not** go in the JWT

- PII (email, name, phone). Look these up via `/me`.
- Mutable preference flags.
- Secrets, signing keys, or document IDs.

---

## 6. Middleware Design

### 6.1 Request pipeline (NestJS)

```
HTTP request
   │
   ▼
[edge: CDN/WAF]    — TLS 1.3 termination, generic OWASP rules, geofencing
   │
   ▼
[gateway: Cloudflare / Kong]  — global rate limit, bot fight, JA3 fingerprint
   │
   ▼
[helmet]           — security headers (CSP, HSTS, XFO, COOP/COEP)
   │
   ▼
[cors]             — strict origin allowlist (per-tenant configurable)
   │
   ▼
[requestId]        — generate/propagate X-Request-Id
   │
   ▼
[csrfDoubleSubmit] — verify CSRF cookie ↔ X-CSRF-Token header for state-changing methods
   │
   ▼
[bodyParser]       — strict size limits (1 MB JSON, 50 MB multipart)
   │
   ▼
[rateLimiterByUser]— per-user/IP buckets in Redis (sliding window)
   │
   ▼
[jwtAuthGuard]     — verify signature, expiry, denylist; load session row
   │
   ▼
[tenantScopeGuard] — pin tenant from JWT; reject if body/path references another
   │
   ▼
[rlsBinder]        — `SET LOCAL app.current_tenant`
   │
   ▼
[rolesGuard]       — RBAC layer
   │
   ▼
[policyGuard]      — Cedar/OPA evaluation
   │
   ▼
[stepUpGuard]      — re-check `lsa` for sensitive actions
   │
   ▼
[requestSignatureGuard] — verify HMAC on signed endpoints
   │
   ▼
[controller]       — business logic
   │
   ▼
[activityLoggingInterceptor] — append to audit chain
   │
   ▼
HTTP response
```

### 6.2 CSRF (double-submit cookie pattern)

```ts
// backend/src/common/middleware/csrf.middleware.ts
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.cookies['__Host-cf_csrf']) {
        res.cookie('__Host-cf_csrf', randomToken(), {
          httpOnly: false, secure: true, sameSite: 'strict', path: '/',
        });
      }
      return next();
    }
    const cookie = req.cookies['__Host-cf_csrf'];
    const header = req.headers['x-csrf-token'];
    if (!cookie || !header || !timingSafeEqual(cookie, header)) {
      throw new ForbiddenException('CSRF token mismatch');
    }
    next();
  }
}
```

The frontend reads the (non-HttpOnly) `__Host-cf_csrf` cookie and mirrors it into `X-CSRF-Token` on every mutating fetch. SameSite=Strict on the auth cookie *plus* this double-submit is belt-and-braces against legacy browser quirks.

### 6.3 Request signing (sensitive endpoints)

For `/payments/release`, `/exports/create`, `/users/:id/role`, callers (web app *and* internal services) must add:

```
X-Signature-Timestamp: 1716130000
X-Signature-Nonce:     5d9c…              (one-time, recorded for 5 min)
X-Signature:           v1=base64url(hmac-sha256(secret, ts||nonce||method||path||sha256(body)))
```

- `secret` is a per-session signing key derived via HKDF from the user's WebAuthn credential during step-up.
- Nonce store is Redis (`SETNX` with 5-min TTL); replay → reject + log.
- Skew tolerance: ±60 seconds.

---

## 7. Workflow Security (Invoice Pipeline)

### 7.1 State machine

```
[upload] → [ocr]   → [validate] → [review]   → [approve] → [pay]   → [archive]
   ↑          │          │            │            │          │          │
   │          │          ▼            │            │          │          │
   │          │      [rejected]       │            │          │          │
   │          ▼                       ▼            ▼          ▼          │
   └───── [quarantined]          [needs-edit] [denied]  [reversed] ──────┘
```

Each transition is a **typed event** with required permissions, optional step-up MFA, and a signed audit record:

```ts
// backend/src/workflow/transitions.config.ts
export const TRANSITIONS: TransitionSpec[] = [
  {
    from: 'review', to: 'approve',
    permission: 'invoices.approve',
    policy: 'ApproveInvoice',
    stepUp: { method: 'webauthn', maxAgeSec: 300, thresholdKes: 100_000 },
    requireSignature: true,
    immutableAfter: false,
  },
  {
    from: 'approve', to: 'pay',
    permission: 'payments.release',
    policy: 'ReleasePayment',
    stepUp: { method: 'webauthn', maxAgeSec: 300 },
    requireSignature: true,
    immutableAfter: true,        // can't be re-edited
  },
  // …
];
```

### 7.2 Approval signature

Every approval row gets a detached Ed25519 signature over the canonical payload:

```ts
const payload = canonicalJson({
  invoiceId, fromState, toState, amount, currency,
  approverId, tenantId, decidedAt, comment,
});
const sig = await vault.sign(`user-keys/${userId}`, sha256(payload));
await prisma.approvalSignature.create({
  data: { approvalId, algo: 'ed25519', keyId: userId,
          payloadHash: sha256Hex(payload), signature: sig },
});
```

Verification is a one-liner during audit replay and *fails closed*: a missing/invalid signature on a high-value approval marks the audit chain as broken and blocks the downstream payment job.

### 7.3 Immutable versioning of invoice edits

```prisma
model InvoiceVersion {
  id          String   @id @default(uuid())
  invoiceId   String
  version     Int
  data        Json                          // full snapshot
  editedById  String
  editedAt    DateTime @default(now())
  contentHash String                        // sha256(canonical(data))
  prevHash    String?                       // chain
  @@unique([invoiceId, version])
}
```

`invoices.update` writes a new `InvoiceVersion` row; the live `Invoice` row is the read model rebuilt from versions. Audit can replay any historical state.

---

## 8. API Security

### 8.1 Token hygiene

| Token            | Lifetime         | Storage                          | Rotation                          |
| ---------------- | ---------------- | -------------------------------- | --------------------------------- |
| Access JWT       | 10 min           | `__Host-cf_at` HttpOnly cookie (browser) **or** Authorization header (M2M) | issue new on refresh; old auto-expires |
| Refresh token    | 7d sliding, 30d max | `__Host-cf_rt` HttpOnly cookie (hashed in DB) | **rotates on every use**, family-tracked |
| Device cookie    | 1y persistent    | `__Host-cf_device` HttpOnly       | only on revoke-all                |
| CSRF token       | per session      | `__Host-cf_csrf` (non-HttpOnly)   | regenerate on login               |

### 8.2 Refresh rotation algorithm

```
On POST /auth/refresh with refresh_token RT:
  s = sessions.findActive(hash(RT))
  if not s:                       # token unknown — possible theft
    sessions.revokeFamilyByHash(hash(RT))    # nothing to revoke if truly unknown
    return 401
  if s.status == 'superseded':    # reuse of an already-rotated token
    sessions.revokeFamily(s.familyId)        # KILL THE FAMILY
    risk.record('refresh_reuse', userId=s.userId)
    return 401
  if s.status != 'active' or s.expiresAt < now():
    return 401
  # happy path
  newRT = random256()
  sessions.create({familyId: s.familyId, parentId: s.id,
                   refreshTokenHash: hash(newRT),
                   expiresAt: now() + 7d, …})
  sessions.update(s.id, { status: 'superseded' })
  accessJwt = mint(s.userId, s.tenantId, …)
  setCookies(accessJwt, newRT)
  return 204
```

### 8.3 Rate limiting

- Distributed via Redis (sliding window log).
- Defaults:
  - global: 120 req/min/user, 600 req/min/IP
  - `/auth/login`: 5 req/min/IP, 10 req/min/email
  - `/auth/refresh`: 30 req/min/session
  - `/uploads`: 60/min/user, 10/min/IP for anonymous
  - `/exports`: 5/hour/user
- 429 responses carry `Retry-After` and a `X-RateLimit-Bucket` header for client UX.

---

## 9. Risk-Based Security Engine

### 9.1 Signals

| Signal                   | Source                                | Score impact |
| ------------------------ | ------------------------------------- | ------------ |
| New device               | `Device` table lookup                 | +20          |
| Impossible travel        | (geo Δ / time Δ) > 800 km/h           | +50          |
| VPN/Tor detected         | IPinfo / IP2Proxy DB                  | +20          |
| Datacenter ASN           | ASN classification                    | +15          |
| Login outside business h | tenant config (e.g., 22:00–06:00 EAT) | +10          |
| Multiple failed logins   | `failedLoginCount` last 1h            | +5 each      |
| Unusual approval pattern | per-user behaviour baseline           | +30          |
| High-value approval      | amount > 95th percentile              | +20          |
| Burst of uploads         | > 50 files in 5 min                   | +25          |
| Disposable email domain  | maintained block-list                 | +30          |

Scores are additive, capped at 100. Bands:

- 0–29: allow
- 30–69: require step-up MFA
- 70–89: require step-up + notify tenant admin
- 90+: block + page on-call security

### 9.2 Component design

```
              ┌──────────────────────────────────────────┐
              │           Risk Scorer (Node)             │
              │  Pure functions: signal → contribution   │
              └──────────────────┬───────────────────────┘
                                 │
        ┌────────────────────────┴───────────────────────┐
        │                                                │
┌───────▼────────┐                                ┌──────▼───────┐
│ Synchronous    │                                │ Async        │
│ pre-auth check │                                │ background   │
│ (login, step-  │                                │ baselining + │
│ up, refresh)   │                                │ ML anomaly   │
└────────────────┘                                │ (BullMQ)     │
                                                  └──────────────┘
```

- The sync path stays under ~30 ms (Redis lookups + Maxmind GeoLite2 in-process).
- The async path computes per-user behavioural baselines (approvals/hour, p50/p95 amount, typical hours) using a rolling 90-day window; deviations feed back into `rsk` on subsequent tokens.

### 9.3 Adaptive policy

The `PolicyGuard` reads `context.riskScore` from the JWT; Cedar policies can refer to it directly (`forbid when context.riskScore >= 80`). Risk also feeds the step-up decision: a normally-passive action becomes a step-up trigger when the user's risk is elevated.

---

## 10. Audit & Compliance

### 10.1 Hash-chained activity log

```ts
// backend/src/audit/audit-chain.service.ts
async function append(entry: AuditEntry) {
  const last = await prisma.auditLog.findFirst({
    where: { tenantId: entry.tenantId },
    orderBy: { createdAt: 'desc' },
    select: { contentHash: true },
  });
  const prevHash = last?.contentHash ?? GENESIS;
  const canon = canonicalJson({ ...entry, prevHash });
  const contentHash = sha256Hex(canon);
  await prisma.auditLog.create({ data: { ...entry, prevHash, contentHash } });
}
```

- **Append-only at DB level:** `REVOKE UPDATE, DELETE ON activity_logs FROM claimsflow_app`; only the `ops` role with `BYPASSRLS` can prune older-than-retention rows (and that pruning emits its own audit event signed by ops's key).
- **Daily root signing:** a cron snapshots the latest `contentHash` per tenant, signs with the platform key, and writes to an external WORM store (S3 Object Lock in compliance mode).
- **Verification job:** nightly walks the chain and verifies hash continuity. Any break alerts on-call and freezes high-value payment release for the affected tenant until reconciled.

### 10.2 Exports

- Auditor role can request `POST /exports` (csv|json|jsonl) with filters.
- Job materialises export, computes sha256, signs manifest, uploads to tenant's WORM bucket, emails a signed URL valid for 24h.
- Each export is itself audited; manifest references included audit IDs.

### 10.3 Compliance mapping

| Control        | SOC 2 / ISO 27001 / GDPR ref     | Implementation                                                                  |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| Access control | CC6.1 / A.9 / Art. 32(1)(b)      | RBAC + ABAC + RLS + step-up                                                     |
| Auth + MFA     | CC6.1 / A.9.4.2                  | Argon2id + WebAuthn + TOTP                                                      |
| Logging        | CC7.2 / A.12.4 / Art. 30          | Hash-chained audit, WORM export                                                  |
| Encryption     | CC6.7 / A.10 / Art. 32(1)(a)     | TLS 1.3 in transit, AES-256-GCM at rest (RDS, S3, KMS-managed keys)             |
| Backup         | CC9.1 / A.12.3                   | RDS PITR (35d), cross-region snapshot daily, restore test quarterly             |
| Vulnerability  | CC7.1 / A.12.6                   | CodeQL + Trivy + npm audit + gitleaks + ZAP nightly + annual pentest            |
| Data subject   | Art. 15/17/20                    | Existing GdprModule + export/erasure + DPIA on file                             |

---

## 11. Document Security (Critical)

### 11.1 Upload pipeline

```
[client] -- multipart/form-data --> [size guard 50MB]
            │
            ▼
        [magic-byte check + MIME allowlist]   ← keep existing pdf/png/jpg
            │
            ▼
        [ClamAV scan (sidecar over TCP)]
            │  clean
            ▼
        [PDF sanitizer (qpdf --linearize --object-streams=disable
                        + remove /JavaScript /JS /AA /OpenAction /Launch)]
            │
            ▼
        [Image: strip EXIF/XMP via exiftool -all=]
            │
            ▼
        [Persist to S3 (SSE-KMS, tenant-scoped prefix, Object Lock)]
            │
            ▼
        [Apply visible watermark (per-tenant, per-user, timestamp)]
            │
            ▼
        [Record Document row + content hash + audit event]
            │
            ▼
        [Enqueue OCR job (BullMQ, tenant queue)]
```

### 11.2 Quarantine flow

If ClamAV returns `FOUND`:

- Upload accepted but stored in `s3://…/quarantine/` with `quarantined: true` flag.
- User sees a banner; document does not enter OCR.
- Tenant admin can review; security team auto-paged for category `ransomware`/`exploit`.

### 11.3 Secure preview

- No raw bytes returned to the browser.
- Backend renders PDF/image → PNG tiles (using a sandboxed `pdf-poppler` container with `--no-network`).
- Tiles signed with short-lived URLs (60 s) bound to user+device+document.
- Downloads of the original file are gated by `documents.download` permission + audit event.

### 11.4 PDF.js injection defence

- Never render uploaded PDFs in the user's browser via PDF.js directly; only the tile renderer (above) sees the raw PDF.
- Sandboxed renderer runs as a non-root user, no network, read-only root FS, seccomp restricted.

### 11.5 Watermarking

```
INVOICE #INV-2026-04211    │   user.email@tenant   │   2026-05-19 14:32 EAT
                            (45° diagonal, 20% opacity, tenant logo top-right)
```

- Visible to deter screen capture leaks.
- Carries an invisible LSB-encoded payload: `sha256(documentId + userId + timestamp)[:16]` — lets us trace leaked PDFs back to a user/session.

---

## 12. Security Headers & Hardening

```ts
// backend/src/main.ts (target)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'", `'nonce-${res.locals.cspNonce}'`, "'strict-dynamic'"],
      'style-src':   ["'self'", `'nonce-${res.locals.cspNonce}'`],
      'img-src':     ["'self'", 'data:', 'https://cdn.claimsflow.cic.co.ke'],
      'connect-src': ["'self'", 'https://api.claimsflow.cic.co.ke'],
      'frame-ancestors': ["'none'"],
      'base-uri':    ["'self'"],
      'form-action': ["'self'"],
      'object-src':  ["'none'"],
      'require-trusted-types-for': ["'script'"],
      'trusted-types': ['default', 'next-html', 'react-dom'],
      'upgrade-insecure-requests': [],
    },
  },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
  crossOriginOpenerPolicy:    { policy: 'same-origin' },
  crossOriginEmbedderPolicy:  { policy: 'require-corp' },   // turn back ON
  crossOriginResourcePolicy:  { policy: 'same-site' },
  referrerPolicy:             { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  frameguard: false,             // handled by frame-ancestors
}));

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

app.enableCors({
  origin: (origin, cb) => allowedOrigins.has(origin) ? cb(null, true) : cb(new Error('CORS')),
  credentials: true,
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-CSRF-Token','X-Signature','X-Signature-Timestamp','X-Signature-Nonce','X-Request-Id'],
  exposedHeaders: ['X-Request-Id','X-RateLimit-Bucket','Retry-After'],
  maxAge: 600,
});
```

Frontend ships with `unsafe-inline` removed; React renders use the CSP nonce; remaining inline styles are migrated to CSS modules.

---

## 13. Admin & Security Dashboard

A new tenant-scoped Security tab (admin role only):

1. **Sessions monitor** — table of active `auth_sessions`: user, device, IP, ASN, geo, risk score, age, last seen, revoke button. Backed by `GET /admin/sessions?status=active`.
2. **Login feed** — last 1000 login attempts (success/fail), filterable; click for full audit context. Heatmap of failures by IP.
3. **Approval tracker** — invoice approvals with approver, amount, step-up factor used, signature status, risk score at decision time. Filterable by amount band.
4. **Role console** — drag-and-drop assignment; every change writes an `audit.role_changed` row and requires WebAuthn step-up.
5. **Audit explorer** — full-text search over `activity_logs` (Postgres `tsvector`); export to signed CSV/JSON.
6. **Risk dashboard** — risk score distribution, top signals firing this week, list of users currently in 70+ band, MFA enrollment ratio per role.
7. **Federation health** — per-tenant IdP last-success timestamp, SCIM sync status, JWKS freshness.

---

## 14. Threat Model (OWASP Top 10 — 2021 mapping)

| OWASP                                         | Threat                              | ClaimsFlow control(s)                                                          |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| **A01 Broken Access Control**                 | Cross-tenant data access (IDOR)     | JWT tenant scope + RLS + object loader + signed download URLs                  |
| **A02 Cryptographic Failures**                | Weak hashing, plaintext secrets     | Argon2id + KMS pepper + RS256 JWT + TLS 1.3 + Vault Transit                    |
| **A03 Injection**                             | SQLi, XSS in invoice/comment fields | Prisma parametrised queries, React auto-escape, Trusted Types, DOMPurify for HTML inputs |
| **A04 Insecure Design**                       | Missing approval signatures         | §7.2 ApprovalSignature with Ed25519, mandatory step-up                        |
| **A05 Security Misconfiguration**             | Permissive CSP, missing headers     | §12 strict CSP w/ nonce + Trusted Types + COEP/COOP/CORP                       |
| **A06 Vulnerable & Outdated Components**      | Dep vulns, base-image CVEs          | Renovate bot + `npm audit` CI gate + Trivy on each image build                 |
| **A07 Identification & Auth Failures**        | Credential stuffing, weak MFA       | HIBP check + Argon2id + WebAuthn + per-email rate limit + lockout + risk engine |
| **A08 Software & Data Integrity Failures**    | Supply-chain (npm install scripts)  | npm `--ignore-scripts` + lockfile audit + signed releases + SLSA-2 build       |
| **A09 Security Logging & Monitoring Failures**| Missing/tampered audit trail        | Hash-chained `audit_logs` + WORM export + RLS-protected reads                  |
| **A10 SSRF**                                  | OCR fetches user-supplied URL       | Egress allowlist (Cloudflare gateway) + DNS pinning + private-IP block         |

Additional ClaimsFlow-specific threats:

| Threat                                        | Control                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Malicious PDF (JS, embedded files)            | §11 sanitizer + sandboxed renderer + no PDF.js in browser                     |
| OCR data poisoning (adversarial inputs)       | Confidence thresholds, second-pass with different OCR engine for high-value   |
| Insider fraud (collusion approving + paying)  | Separation of duties enforced in Cedar (approver ≠ payer; bothmust step-up)  |
| Session theft via XSS                         | HttpOnly cookies + nonce CSP + Trusted Types + SameSite=Strict                |
| Replay of approval                            | Request signing + nonce + ApprovalSignature + idempotency keys                |

---

## 15. Recommended Tech Stack

| Layer            | Choice                                              | Why                                                                  |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| App framework    | **NestJS 10** (existing)                            | Already adopted; modules/guards fit the design perfectly             |
| ORM              | **Prisma** (existing)                               | Extensions API allows the RLS binder cleanly                         |
| DB               | **PostgreSQL 16**                                   | RLS, `gen_random_uuid`, `pgcrypto`, `tsvector` for audit search      |
| Auth core        | **Passport-JWT** (kept) + **@simplewebauthn/server** + **passport-saml** + **openid-client** + **ldapts** | Best-in-class per protocol, all maintained         |
| Policy engine    | **Cedar** via `@cedar-policy/cedar-wasm`            | Typed, fast, AWS-supported                                           |
| Secrets / KMS    | **HashiCorp Vault** (or AWS KMS + Secrets Manager)  | Transit engine for JWT signing; per-tenant key partitions            |
| Cache / queue    | **Redis 7** + **BullMQ** (existing)                 | Refresh denylist, rate buckets, CSRF nonces, OCR queue               |
| Object storage   | **S3** with **Object Lock (compliance mode)**       | WORM for audit/document retention                                    |
| Antivirus        | **ClamAV** (sidecar) + **YARA** rules               | Free, well-maintained; YARA for financial-fraud-specific signatures  |
| PDF sanitizer    | **qpdf** + **pdfid.py**                             | Industry-standard CLIs; run in seccomp-restricted container          |
| Geo / risk       | **MaxMind GeoLite2** (in-process) + **IPinfo Lite** | Sub-ms lookups; license fits commercial use                          |
| WAF / edge       | **Cloudflare** (or AWS WAF + CloudFront)            | Bot management, rate limit, JA3 fingerprinting                       |
| Observability    | **OpenTelemetry → Tempo + Loki + Grafana**          | Trace JWT through request; correlate audit events to traces          |
| SIEM             | **Wazuh** or **Elastic Security**                   | Ingest audit logs + risk events for cross-tenant detection           |
| IdP federation   | Tenant-bring-your-own (Okta/ADFS/Ping/Azure AD)     | We adapt, not host                                                   |
| SCIM             | **scim2-server** node lib                           | Implements RFC 7644 endpoints for AD/Okta sync                       |

---

## 16. Sequence Diagrams

### 16.1 Login (local + WebAuthn step-up)

```
Browser           Gateway            AuthSvc          Vault           PG          Redis
   │                  │                  │              │             │             │
   ├── POST /auth/login (email, pw) ────►│                                          │
   │                  │  rateLimitCheck ────────────────────────────────────────────►│
   │                  ├──── lookup user ──────────────────►│             │             │
   │                  │◄──── user row ────────────────────│             │             │
   │                  ├── argon2.verify(pw + pepper) ────►│                          │
   │                  ├── HIBP k-anon check (async) ─────►│                          │
   │                  │◄──── ok (no breach blocker) ─────│                          │
   │                  ├── risk.preAuthScore() ────────────────────────────────────────►│
   │                  │◄──── score=18 ───────────────────────────────────────────────│
   │                  │  user has WebAuthn? yes → emit challenge                       │
   │                  ├── webauthn.generateAuthOptions ──►│                          │
   │                  ├── store challenge in StepUpChallenge ──►│ insert │             │
   │◄── 202 {challenge, allowCreds} ────────────────────────────────────────────────────│
   ├── navigator.credentials.get(...) (user taps key)     │                          │
   ├── POST /auth/webauthn/verify {assertion, ticket} ───►│                          │
   │                  ├── verify assertion w/ stored pubkey                            │
   │                  ├── mint access JWT (kid, sign via Vault) ──►│                  │
   │                  │◄── signed JWT ──────────────────────────│                    │
   │                  ├── create AuthSession (familyId, RT hash, deviceId) ──►│insert│
   │                  ├── set cookies (__Host-cf_at, __Host-cf_rt, __Host-cf_csrf)    │
   │◄── 204 + cookies ────────────────────────────────────────────────────────────────│
   ├── GET /me ──────────────────────────►│                                            │
   │                  ├── verify JWT (JWKS cache) ─────────────►│                    │
   │                  ├── deny-list check ──────────────────────────────────────────►│
   │                  ├── load user/perms ───────────────►│                          │
   │◄── 200 {profile, perms} ──────────────────────────────────────────────────────────│
```

### 16.2 High-value invoice approval

```
Browser              API           PolicyGuard     StepUpGuard     SigGuard      AuditChain      Vault
   │                  │                  │              │              │              │              │
   ├── POST /invoices/:id/approve ──────►│                                                          │
   │  X-CSRF-Token: …                    │                                                          │
   │                  ├── jwt verify, RLS bind, load invoice                                          │
   │                  ├── RolesGuard: has invoices.approve? ─► yes                                    │
   │                  ├── PolicyGuard.evaluate(Cedar) ───────►│                                      │
   │                  │   user.approvalLimit >= invoice.amount && state == 'verified' && risk<80     │
   │                  │◄── allow ─────────────────────────────│                                      │
   │                  ├── StepUpGuard: amount=1.2M >= 1M ─────────►│                                  │
   │                  │   require WebAuthn, last_strong_auth < 300s? NO                               │
   │◄── 401 {challenge, allowCreds, ticket=tx_…} ────────────────────────────────────────────────────│
   ├── webauthn.get + POST /auth/step-up {ticket, assertion} ────────────────────────────────────────│
   │                  ├── verify; update session.last_strong_auth_at; mint new JWT (lsa updated)     │
   │◄── 204 + new cookies ───────────────────────────────────────────────────────────────────────────│
   ├── POST /invoices/:id/approve  (retry)                                                            │
   │  X-Signature-Timestamp, X-Signature-Nonce, X-Signature                                           │
   │                  ├── SigGuard: HMAC ok, nonce not seen, skew < 60s ───►│                       │
   │                  │◄── allow ────────────────────────────────────────────│                       │
   │                  ├── domain: write ClaimApproval row                                              │
   │                  ├── canonical payload → sha256 → vault.sign(ed25519) ─────────────────────────►│
   │                  │◄── signature ─────────────────────────────────────────────────────────────────│
   │                  ├── write ApprovalSignature row                                                  │
   │                  ├── audit.append({action:'invoices.approved', prevHash, contentHash}) ─►│      │
   │                  ├── emit invoice.approved (BullMQ → payment workflow)                            │
   │◄── 200 {approval, signatureId} ───────────────────────────────────────────────────────────────────│
```

---

## 17. Production Deployment Security Checklist

### 17.1 Infrastructure

- [ ] TLS 1.3 only at edge; HSTS preloaded; OCSP stapling on
- [ ] Cloudflare (or AWS WAF) in front of all origins; bot fight + rate limit configured
- [ ] All app traffic over private VPC; DB never publicly addressable
- [ ] Egress allowlist (no outbound except OCR provider, KMS, Vault, S3, SMTP)
- [ ] Container images scanned (Trivy) on every push; CVE budget enforced in CI
- [ ] Base images pinned by digest, rebuilt nightly
- [ ] Pod security: non-root, read-only root FS, seccomp `RuntimeDefault`, NetworkPolicy default-deny
- [ ] Backups: RDS PITR 35d, daily snapshot to alt region, restore test quarterly (documented runbook)

### 17.2 Application

- [ ] `NODE_ENV=production`, source maps not served publicly
- [ ] All secrets from Vault/Secrets Manager; no plaintext env vars in compose/k8s manifests
- [ ] `AUTH_PEPPER`, JWT signing key, SAML cert all rotated within last 90 days
- [ ] Cookies: `Secure; HttpOnly; SameSite=Strict; Path=/; __Host- prefix`
- [ ] CSP `report-only` in staging for 1 week before enforce
- [ ] Trusted Types deployed on frontend; CI fails if `dangerouslySetInnerHTML` introduced
- [ ] Refresh token rotation tested for theft scenarios (replay → family revoked)
- [ ] WebAuthn flow tested on Chrome + Firefox + Safari + iOS + Android
- [ ] SAML/OIDC flows tested against ≥ 2 IdPs each
- [ ] Step-up MFA verified for every transition in §7.1
- [ ] Audit chain verification job runs nightly + alerts on break
- [ ] Risk engine baseline trained for ≥ 30 d before enforcing 70+ block band

### 17.3 Data

- [ ] RLS enabled on every tenant-owned table; app role lacks `BYPASSRLS`
- [ ] Tenant test: spin up two tenants, attempt cross-tenant fetch by ID — must 404
- [ ] PII tagged in schema; `pg_anonymize` test exists for staging seeds
- [ ] S3 Object Lock (compliance mode) enabled on documents + audit-export buckets
- [ ] KMS keys per tenant for document SSE; key deletion blocked by IAM SCP

### 17.4 Observability

- [ ] OTel traces include `tenant_id`, `user_id`, `session_id` (hashed) as span attrs
- [ ] Alerts: spike in 4xx/5xx, audit chain break, refresh-reuse events, risk-score-90 logins, WebAuthn failure rate > 5%, MFA-disabled requests
- [ ] On-call runbook covers: revoke-all-sessions, rotate-pepper, rotate-jwt-key, lockdown-tenant

### 17.5 Compliance

- [ ] DPIA on file, reviewed annually
- [ ] DPAs signed with all sub-processors (OCR, antivirus, geo, KMS host)
- [ ] Pen-test annually (independent firm); remediation tracked to closure
- [ ] Tabletop incident exercise quarterly
- [ ] Audit log retention ≥ 7 years (financial); document retention per tenant config

---

## 18. Implementation Roadmap (phased)

| Phase | Scope                                                                  | Weeks |
| ----- | ---------------------------------------------------------------------- | ----- |
| **0** | Audit + design sign-off (this document), threat model walkthrough      | 1     |
| **1** | Password hardening: Argon2id + pepper + HIBP + history; CSRF double-submit; tighter CSP/COEP; audit hash chain | 2–3 |
| **2** | Refresh-token rotation w/ family detection; device binding; concurrent-session limits; step-up MFA framework + decorator | 3 |
| **3** | WebAuthn enrollment & login; step-up wired on approval endpoints; approval signatures (Ed25519 via Vault) | 3 |
| **4** | RLS migration; tenant-prisma wrapper; per-tenant pool; cross-tenant test gate in CI | 2 |
| **5** | Cedar policy engine + PolicyGuard; ABAC for approvals/payments/exports | 3 |
| **6** | Document pipeline: ClamAV sidecar + qpdf sanitizer + watermarking + tile renderer (sandboxed) | 4 |
| **7** | Risk engine v1 (sync signals only) + adaptive step-up                  | 3 |
| **8** | SAML 2.0 + OIDC federation; SCIM provisioning; tenant IdP config UI    | 4 |
| **9** | Admin security dashboard (sessions, login feed, approval tracker, audit explorer, risk dashboard) | 3 |
| **10**| Risk engine v2 (behavioural baselines, ML anomaly), request signing on payment/export | 4 |
| **11**| Pentest → remediate → SOC 2 Type II readiness review                   | 6+    |

Total: ~9 months at one squad's velocity, parallelisable to ~5 months with two squads (split frontend/backend).

---

## Appendix A — Canonical JSON

Used wherever a payload is hashed or signed. Rules:

1. UTF-8 encoded.
2. Object keys sorted lexicographically at every level.
3. No insignificant whitespace.
4. Numbers in shortest exact decimal form (`5.00 → 5`; `5.10 → 5.1`).
5. Strings in NFC normalisation.
6. `null`, `true`, `false` lowercase.

Reference impl: `@stablelib/json-canonicalize` or RFC 8785 (JCS).

## Appendix B — Glossary

- **AAL** — Authenticator Assurance Level (NIST SP 800-63B). AAL2 = MFA, AAL3 = hardware-bound.
- **RLS** — Row-level security (Postgres).
- **JWKS** — JSON Web Key Set, served at `/.well-known/jwks.json`.
- **JA3** — TLS client fingerprint hash, useful for bot detection.
- **WORM** — Write-once-read-many (e.g., S3 Object Lock compliance mode).
- **SCIM** — System for Cross-domain Identity Management, RFC 7644.
- **Step-up MFA** — Re-authenticating with a stronger factor for a specific sensitive action within an existing session.
