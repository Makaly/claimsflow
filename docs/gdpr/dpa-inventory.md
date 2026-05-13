# Sub-processor and DPA inventory

**Owner:** Procurement &amp; Vendor Risk, with Data Protection Officer sign-off
**Last reviewed:** 2026-05-13
**Statutory basis:** Kenya Data Protection Act 2019 s.42; GDPR Art. 28; Standard Contractual Clauses (Decision (EU) 2021/914)

This inventory is the single source of truth for every third party that processes ClaimsFlow personal data on behalf of CIC Insurance Group PLC. Each entry records the service performed, the categories of data exposed, the cross-border-transfer safeguard, and the location of the signed Data Processing Agreement (DPA).

## 1. Inventory

| Sub-processor | Service | Personal data exposed | Transfer safeguard | DPA on file | Renewal |
|---|---|---|---|---|---|
| Anglehouse Inc. (Render) | PaaS hosting — web, PostgreSQL, Redis, scheduled jobs | All categories — primary processor | SCCs (Module 2) embedded in Render DPA v2025-01 | `vendor-risk/render-dpa-2025-01.pdf` | 2027-01 |
| Google LLC (Gemini Vision) | OCR for claim documents | Document images and OCR-extracted fields incl. diagnosis | SCCs (Module 2) + Google Cloud DPA | `vendor-risk/google-cloud-dpa-2024-11.pdf` | 2026-11 |
| Anthropic PBC (Claude Vision) | OCR fallback engine | Document images and OCR-extracted fields | SCCs (Module 2) + Anthropic DPA v2025-02 | `vendor-risk/anthropic-dpa-2025-02.pdf` | 2027-02 |
| Twilio Inc. | SMS delivery (Twilio path) | Phone number, message body (templated, no PII beyond claim reference) | SCCs (Module 2) + Twilio DPA | `vendor-risk/twilio-dpa-2024-06.pdf` | 2026-06 |
| Africa's Talking Ltd. | SMS delivery (East Africa path) | Phone number, message body | Domestic processor — KDPA-only | `vendor-risk/africastalking-dpa-2025-03.pdf` | 2027-03 |
| Google LLC (Gmail SMTP) | Transactional email delivery | Email address, message body (templated) | SCCs (Module 2) + Google Workspace DPA | `vendor-risk/google-workspace-dpa-2024-11.pdf` | 2026-11 |
| ICTA / EDMS | Government enterprise document management integration | Stamped claim PDFs | Domestic — KDPA-only | `vendor-risk/edms-mou-2024-09.pdf` | 2027-09 |
| eOxegen Health Tech | Claim transfer to insurer of record | Claim metadata (no diagnosis text) | Domestic — KDPA-only | `vendor-risk/eoxegen-dpa-2025-01.pdf` | 2027-01 |

## 2. Minimum contractual clauses

Every DPA listed above must, at minimum, contain the clauses required by KDPA s.42(2) and GDPR Art. 28(3):

1. Processor acts only on documented instructions of the controller.
2. Confidentiality obligation extending to all personnel.
3. Technical and organisational security measures appropriate to the risk (Art. 32 / KDPA s.41).
4. Prior written authorisation before engaging further sub-processors.
5. Assistance with data-subject rights requests (Art. 15-22).
6. Assistance with breach notification within 48 hours of awareness.
7. Deletion or return of personal data at end of contract.
8. Submit to audit and demonstrate compliance.
9. Cross-border transfer safeguard — Standard Contractual Clauses or equivalent.

The standard DPA template ClaimsFlow procurement issues to new processors is held at `vendor-risk/dpa-template-2026.pdf` and uses the EU SCCs Module 2 as Annex II.

## 3. Onboarding workflow

1. Procurement raises a Vendor Intake form referencing the categories of data the vendor will process.
2. DPO classifies risk (Low / Medium / High). Medium and High require a vendor security questionnaire (CAIQ-Lite).
3. Legal issues the DPA template above, or reviews the vendor's own DPA against the clause checklist in section 2.
4. CISO signs off on the technical safeguards. DPO signs the DPA.
5. PDF is filed in `vendor-risk/` with the naming pattern `<vendor>-dpa-<yyyy-mm>.pdf` and a row is added to section 1.

## 4. Annual review

The DPO triggers a review of every DPA at least annually. The review confirms:

* the sub-processor still requires the data categories listed;
* no acquisition / restructuring has changed the legal entity that holds the DPA;
* the cross-border-transfer mechanism remains valid (e.g. SCCs not invalidated, no new adequacy decision changes the picture);
* the vendor's latest SOC 2 / ISO 27001 report has been received;
* the renewal date in section 1 is moved forward.

## 5. Termination playbook

When a sub-processor is decommissioned:

1. Issue a written termination notice citing the DPA's exit clauses.
2. Receive a deletion certificate (or, if the data is to be returned, a manifest of returned files).
3. Confirm with engineering that all credentials and API keys are revoked.
4. Strike through the row in section 1 with a `decommissioned: YYYY-MM` annotation; keep the row for audit purposes.
