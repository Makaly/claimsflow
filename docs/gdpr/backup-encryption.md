# Backup encryption — verification statement

**Owner:** Platform Engineering, signed off by the DPO.
**Last verified:** 2026-05-13.
**Tracked in:** DPIA action A2 (see `docs/gdpr/dpia.md`).

## 1. Production database

ClaimsFlow runs on Render's managed PostgreSQL service (`render.yaml`).

### 1.1 Encryption at rest

Render publicly states that every managed PostgreSQL volume is encrypted at rest with AES-256, and that all backups (automated daily snapshots and on-demand) inherit this encryption.

Reference: https://docs.render.com/databases#data-encryption (verified 2026-05-13).

No application-level configuration is required to opt in — encryption at rest is the default and cannot be disabled. The volume keys are managed by Render's cloud provider (AWS KMS).

### 1.2 Encryption in transit

Connections to the production database are required to use TLS. The `DATABASE_URL` we deploy includes `sslmode=require`; any client that does not negotiate TLS is rejected.

### 1.3 Backup schedule

| Frequency | Retention | Storage |
|---|---|---|
| Continuous WAL | 7 days (point-in-time recovery window) | Same region as the database, encrypted |
| Daily snapshot | 7 days rolling | Same region, encrypted |
| On-demand snapshot | Operator-defined | Same region, encrypted |

The 7-day window matches the lower bound of our recovery-point objective; longer retention requires a separate logical export (see section 2).

## 2. Off-site logical exports

For statutory retention (Insurance Act 2017 s.83: 7 years) we run a monthly logical export:

1. `pg_dump --no-owner --format=custom --file=cf-YYYYMM.dump` against the read-replica.
2. Encrypt the dump with `age` using the recipient public key in `vendor-risk/backup-recipients.txt` (the corresponding private key is held in the offline key escrow at CIC Plaza).
3. Upload the encrypted artefact to the long-term object store with a 7-year object-lock.

The escrow private key is never present on a network-attached system. Restore from a logical export therefore requires a two-person procedure (DPO + CISO present), which is documented in the disaster-recovery runbook.

## 3. Field-level encryption

Independently of the volume-level protection above, ClaimsFlow encrypts special-category fields at the application layer before they reach the database:

* Implementation: `backend/src/common/services/field-encryption.ts` (AES-256-GCM, versioned ciphertext, per-row IV).
* Key: `DATA_ENCRYPTION_KEY` in the deployment secret store (Render-generated on first deploy; rotation procedure in section 4).
* Wired up via Prisma middleware in `backend/src/prisma/prisma.service.ts`, so the protection applies regardless of which service writes the row.

This means a backup snapshot, even if it leaked, would not contain plaintext diagnosis or treatment fields.

## 4. Key rotation

The `DATA_ENCRYPTION_KEY` is rotated:

* on a fixed annual cadence (next: 2027-05-13);
* on suspected compromise;
* on offboarding of any individual who handled the key.

Rotation is **not** a hot swap — both old and new keys are needed during the migration. The procedure is:

1. Deploy a release that accepts a second variable `DATA_ENCRYPTION_KEY_PREVIOUS` and tries it on decrypt-failure.
2. Run a backfill job that reads every encrypted row, decrypts with the previous key, and re-encrypts with the current key.
3. Confirm there are no remaining rows in the previous-key format by sampling the ciphertext prefix.
4. Remove `DATA_ENCRYPTION_KEY_PREVIOUS` and redeploy.

Each step is recorded in the change-control system, and the rotation date is added to section 4 of this document.

## 5. Restore drill

The restore procedure is exercised twice a year (one Render snapshot restore, one off-site logical-export restore) so the team is fluent before a real incident. Results are filed at `docs/gdpr/exercises/<date>-restore-drill.md`.

## 6. Open follow-up

* **2026-09-30** &mdash; commission an independent attestation from Render's security team that the AES-256 at-rest claim is unchanged after their recent platform migration. Owner: Platform Engineer.
