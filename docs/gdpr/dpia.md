# Data Protection Impact Assessment

**System:** ClaimsFlow medical claims platform
**Controller:** CIC Insurance Group PLC
**DPO:** dpo@cic.co.ke
**Assessment date:** 2026-05-13
**Statutory basis:** Kenya Data Protection Act 2019 s.31; GDPR Art. 35

A DPIA is mandatory for ClaimsFlow because the platform performs *large-scale processing of special category health data* and *automated decision-making with significant effects* (claim fraud flagging) — both of the criteria that trigger the obligation under KDPA s.31(2).

## 1. Description of the processing

ClaimsFlow ingests medical claims from contracted healthcare providers, OCRs the supporting documents (invoices, ICD-coded diagnoses, prescriptions), runs anomaly and fraud rules against the extracted data, then routes the claim through a maker/checker workflow ending in payment or rejection.

Personal data processed:

* Identification — member number, name, KRA PIN, ID number, date of birth.
* Special category — diagnosis (ICD-10), treatment, medication, lab results.
* Financial — invoice line items, totals, banking details for payment.
* Contact — email, phone, postal address.
* Workforce — CIC staff and provider user identification, role, login telemetry.

Volumes: ~120,000 active members and ~2,500 providers; up to 4,000 claims per business day at peak.

## 2. Necessity and proportionality

| Test | Assessment |
|---|---|
| Is the processing necessary for the stated purpose? | Yes — the controller cannot adjudicate a claim without a diagnosis and invoice. |
| Is there a less intrusive alternative? | No — manual processing without OCR/anomaly scoring would extend turnaround times beyond what the contract and the Insurance (Health Policy Holders Protection) Regulations require. |
| Is the data minimised? | Reduced from the legacy mainframe schema: removed three free-text PII fields and one ID copy upload step. Documented in `docs/gdpr/ropa.md`. |
| Are subjects informed? | Yes — privacy notice at `/privacy` and consent recorded at registration (`ConsentRecord` table). |

## 3. Risk assessment

| # | Risk | Likelihood | Impact | Inherent | Treatment | Residual |
|---|---|---|---|---|---|---|
| R1 | Unauthorised access to a member's medical record | Medium | High | High | RBAC + audit logging + HTTPS + HSTS + HttpOnly cookies; quarterly access review | Low |
| R2 | Account takeover via credential stuffing | Medium | High | High | Rate limiting (10/min on auth), bcrypt(10), lockout after 5 failures, 2FA available | Low |
| R3 | OCR pipeline leaks PII to third-party model providers | Medium | High | High | Pre-OCR redaction of national ID where not required; SCCs with Google/Anthropic; explicit consent at member onboarding; field-level encryption of stored OCR `diagnosis` | Low |
| R4 | Automated fraud flag leads to denial without human review | Low | High | Medium | All flags require a human checker decision; `DecisionReviewRequest` endpoint lets subjects challenge; reviewer note required | Low |
| R5 | Subject is unable to exercise rights (access, erasure) | Medium | Medium | Medium | `GET /api/gdpr/export`, `DELETE /api/gdpr/account`, withdrawable consent in Profile UI | Low |
| R6 | Excessive retention of closed claims | Medium | Low | Low | Retention purge cron (`reports.service.ts`) with `claim_retention_days` config | Low |
| R7 | PII written to application logs | High | Medium | High | `pii-redaction.ts` applied to all notification/email log lines; activity-log interceptor masks password/token/secret | Low |
| R8 | Cross-border transfer to US-based sub-processors | High | Medium | Medium | SCCs in each sub-processor DPA; data minimisation before transfer | Medium |
| R9 | Breach not reported within statutory window | Low | High | Medium | `docs/gdpr/breach-notification-sop.md` mandates ODPC notification within 72 hours | Low |

## 4. Consultation

* **Information security:** Reviewed by the in-house security team — see `ClaimsFlow_Security_Audit_Report_v2.pdf` (all 16 findings remediated, 19/20 pen-tests pass).
* **Office of the Data Protection Commissioner:** Prior consultation under KDPA s.31(4) is not required because residual risk is rated Low/Medium with no item in the High band.
* **Data subject representatives:** Provider Advisory Council and Member Ombudsman consulted on consent and erasure flows.

## 5. Action items

| ID | Item | Owner | Due | Status |
|---|---|---|---|---|
| A1 | Quarterly RBAC access review against `users` and `user_roles` | Security Lead | 2026-06-30 | **Procedure published** &mdash; `docs/gdpr/rbac-review-procedure.md`; first run in the 2026-Q2 window |
| A2 | Verify Render Postgres backup encryption-at-rest in writing | Platform Engineer | 2026-06-30 | **Closed** &mdash; statement in `docs/gdpr/backup-encryption.md` |
| A3 | Add field-level encryption for `diagnosis` and `treatment` | Backend Lead | 2026-09-30 | **Closed early** &mdash; AES-256-GCM via Prisma middleware (`backend/src/common/services/field-encryption.ts`, `backend/src/prisma/prisma.service.ts`); applied to `Claim.diagnosis`, `Claim.treatment`, `OcrExtraction.diagnosis` |
| A4 | Annual review of this DPIA | DPO | 2027-05-13 | Scheduled |

## 6. Sign-off

| Role | Name | Date |
|---|---|---|
| Data Protection Officer | _to be signed_ | _to be signed_ |
| Chief Information Security Officer | _to be signed_ | _to be signed_ |
| Head of Claims | _to be signed_ | _to be signed_ |
