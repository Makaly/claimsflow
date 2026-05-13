# Quarterly RBAC access review

**Owner:** Security Lead, with sign-off from line managers and the DPO.
**Cadence:** Quarterly (calendar quarter-end + 15 working days).
**Statutory basis:** KDPA s.41(2)(d) "access control"; GDPR Art. 32.
**Tracked in:** DPIA action A1 (see `docs/gdpr/dpia.md`).

The review answers four questions, in order:

1. Does every account in `users` still belong to a current employee or provider?
2. Does every account have the minimum role required for its function?
3. Have any privileged actions been taken by accounts that should not hold those privileges?
4. Are dormant accounts disabled?

## 1. Pre-review preparation

* Pull the current employee roster from HR (CSV) into `vendor-risk/quarterly-review/<quarter>-roster.csv`.
* Pull the current active-provider list from the Procurement system into `<quarter>-providers.csv`.
* Confirm the SQL below targets the production read-replica, not the writer.

## 2. Review queries

The following queries are run by the Security Lead on the production read-replica. Each query produces a CSV that is then reconciled against HR / Procurement.

### Q1 — All non-deleted accounts and their roles

```sql
SELECT u.id, u.email, u.name, u.role, p.name AS provider, u."lastLogin",
       u."isActive", u."deletedAt", u."createdAt"
FROM   users u
LEFT   JOIN providers p ON p.id = u."providerId"
WHERE  u."deletedAt" IS NULL
ORDER  BY u."lastLogin" NULLS FIRST;
```

### Q2 — Accounts holding privileged roles

```sql
SELECT u.id, u.email, u.name, ur."assignedAt", r.name AS role_name
FROM   users u
JOIN   user_roles ur ON ur."userId" = u.id
JOIN   roles r       ON r.id = ur."roleId"
WHERE  r.name IN ('admin', 'supervisor', 'security_admin', 'claims_officer')
  AND  u."deletedAt" IS NULL
ORDER  BY r.name, u.email;
```

### Q3 — Dormant accounts (no login in 90 days)

```sql
SELECT u.id, u.email, u.role, u."lastLogin",
       EXTRACT(DAY FROM (NOW() - u."lastLogin")) AS days_dormant
FROM   users u
WHERE  u."deletedAt" IS NULL
  AND  u."isActive" = true
  AND  (u."lastLogin" IS NULL OR u."lastLogin" < NOW() - INTERVAL '90 days')
ORDER  BY days_dormant DESC NULLS LAST;
```

### Q4 — Privileged actions in the quarter

```sql
SELECT a."createdAt", u.email, a.action, a.entity, a."entityId", a.status
FROM   activity_logs a
LEFT   JOIN users u ON u.id = a."userId"
WHERE  a."createdAt" >= date_trunc('quarter', NOW()) - INTERVAL '3 months'
  AND  a."createdAt" <  date_trunc('quarter', NOW())
  AND  a.action IN (
    'USER_DELETE', 'USER_ROLE_GRANT', 'USER_ROLE_REVOKE',
    'CLAIM_FORCE_APPROVE', 'PROVIDER_APPROVE', 'PROVIDER_REJECT',
    'GDPR_ACCOUNT_ERASE'
  )
ORDER  BY a."createdAt" DESC;
```

### Q5 — Cross-role anomalies

Accounts whose `role` column on `users` and whose row in `user_roles` are out of sync (legacy and RBAC tables should agree):

```sql
SELECT u.id, u.email, u.role AS legacy_role,
       string_agg(r.name, ',') AS rbac_roles
FROM   users u
LEFT   JOIN user_roles ur ON ur."userId" = u.id
LEFT   JOIN roles r        ON r.id = ur."roleId"
WHERE  u."deletedAt" IS NULL
GROUP  BY u.id, u.email, u.role
HAVING string_agg(r.name, ',') IS DISTINCT FROM u.role;
```

## 3. Reconciliation

For each row in Q1:

* Match `email` against the HR roster. **No match** &rarr; mark for off-boarding (open a ticket; disable within 5 working days).
* For provider users, match against the active-provider list. **No match** &rarr; mark for off-boarding.

For Q2, every privileged account must have a named owner who is *currently in role*. The line manager signs that the role assignment is still justified.

For Q3, dormant accounts are disabled (`isActive = false`) unless the line manager explicitly justifies retention (e.g. extended leave).

For Q4, every privileged action must have a corresponding ticket or change-control record. Unmatched actions trigger a separate investigation.

For Q5, any account whose legacy and RBAC roles disagree is fixed in the same review window — the system code reads both during the RBAC migration, so silent divergence is a regression.

## 4. Sign-off

The Security Lead files the review at `docs/gdpr/exercises/<quarter>-rbac-review.md` with:

* the four CSVs (Q1–Q5) attached;
* a one-page summary listing the accounts moved to off-boarding, the dormant accounts disabled, the privileged-action exceptions;
* sign-off lines for Security Lead, DPO, and the line manager of each privileged account holder.

## 5. Automation hooks

To shorten future reviews, the following are scheduled (DPIA action A1):

* A nightly cron writes the dormant-account list to a Slack channel so the cleanup becomes routine, not quarterly bursts.
* `activity_logs` is the source of truth for Q4 — the activity-logging interceptor at `backend/src/common/interceptors/activity-logging.interceptor.ts` must keep enumerating privileged action names as new ones are introduced.
