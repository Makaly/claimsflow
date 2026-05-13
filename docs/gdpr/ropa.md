# Records of Processing Activities (RoPA)

**Controller:** CIC Insurance Group PLC
**Platform:** ClaimsFlow medical claims platform
**Document owner:** Data Protection Officer (dpo@cic.co.ke)
**Last reviewed:** 2026-05-13
**Statutory basis:** Kenya Data Protection Act 2019 s.30; GDPR Art. 30

## 1. Controller and DPO

| | |
|---|---|
| Data controller | CIC Insurance Group PLC, CIC Plaza, Mara Road, Upper Hill, Nairobi |
| ODPC registration | ODPC.ENT.0123456 |
| Data Protection Officer | dpo@cic.co.ke / +254 (0)20 282 3000 |
| Representative in the EU | Not applicable (no establishment in the EU; controller falls under KDPA) |

## 2. Processing activities

### 2.1 Member medical claim adjudication

| Item | Value |
|---|---|
| Purpose | Receive, validate, adjudicate and pay medical insurance claims |
| Categories of subject | Insured members, providers, provider staff, CIC employees |
| Categories of data | Identification (name, member number, ID), contact (email, phone, address), special category — health (diagnosis, treatment, prescriptions, ICD codes), financial (invoice amounts, banking) |
| Lawful basis | Performance of the insurance contract (KDPA s.30(b); GDPR Art. 6(1)(b)); explicit consent for health data (KDPA s.44(1)(a); GDPR Art. 9(2)(a)); compliance with the Insurance Act 2017 (GDPR Art. 6(1)(c)) |
| Recipients | Internal claims, fraud and finance teams; service providers; reinsurers; auditors |
| Retention | Claim records: 7 years from closure (Insurance Act 2017 s.83). Anonymised analytics aggregates: indefinite. |
| International transfers | Render (cloud hosting — US); Google (Gemini Vision OCR — US); Anthropic (Claude Vision — US). All under Standard Contractual Clauses + supplementary measures. |
| Technical & organisational measures | Field-level access control; ThrottlerGuard; Helmet + HSTS; HttpOnly JWT cookies; bcrypt with 10 salt rounds; audit log of every read/write; daily retention purge; pseudonymisation for analytics. |

### 2.2 Provider onboarding and KYC

| Item | Value |
|---|---|
| Purpose | Verify the eligibility of medical service providers; meet AML/CFT obligations |
| Subjects | Provider organisations, owners, contact persons |
| Data | KRA PIN, owner ID number, license number, business registration documents |
| Lawful basis | Legitimate interest (vendor due diligence); compliance with the Insurance Act and AML/CFT regulations |
| Retention | Active provider + 5 years after deactivation |
| Recipients | Internal procurement, compliance, audit |

### 2.3 Automated fraud detection (Art. 22 / KDPA s.35)

| Item | Value |
|---|---|
| Purpose | Detect anomalous billing patterns, duplicate invoices and identity mismatches |
| Subjects | Members and providers named on submitted claims |
| Data | Claim metadata (amount, ICD code, frequency, invoice number), OCR-extracted fields |
| Lawful basis | Legitimate interests of the controller (fraud prevention) and legal obligations under the Insurance Act |
| Logic | Anomaly score 0–1 from `anomaly-scoring.service.ts`; rule-based signals from `fraud-signals.ts`. Output is a recommendation; no claim is rejected solely on the basis of the automated score — a human checker always reviews flagged claims. |
| Subject rights | Right to request a human review via `POST /api/gdpr/decision-review` (DecisionReviewRequest model) |
| Retention | Fraud signals attached to the claim follow the claim retention period |

### 2.4 Authentication and account management

| Item | Value |
|---|---|
| Purpose | Authenticate users, enforce role-based access, audit sensitive actions |
| Subjects | CIC staff, provider users |
| Data | Email, hashed password (bcrypt, 10 rounds), 2FA secret, last-login, failed-attempt counters |
| Lawful basis | Performance of the employment / provider engagement contract |
| Retention | Active account + 1 year. Erased accounts: row preserved with anonymised PII for as long as referenced claims are retained. |

### 2.5 Service operations (logs, notifications, support)

| Item | Value |
|---|---|
| Purpose | Send transactional email/SMS, record audit trail, troubleshoot incidents |
| Subjects | All platform users |
| Data | Notification metadata (channel, redacted recipient, status), activity log (action, entity, IP, user-agent), application logs (with PII redacted via `pii-redaction.ts`) |
| Lawful basis | Legitimate interest in operating the service securely; legal obligation to keep an audit trail |
| Retention | `log_retention_days` SystemConfig key (default 730 days). Notifications: 365 days. |

## 3. Sub-processors

| Sub-processor | Service | Location | Safeguard |
|---|---|---|---|
| Render (Anglehouse Inc.) | PaaS hosting (web, Postgres, Redis) | United States | SCCs in the Render DPA |
| Google LLC | Gemini Vision OCR | United States | SCCs in Google Cloud DPA |
| Anthropic, PBC | Claude Vision OCR fallback | United States | SCCs in Anthropic DPA |
| Twilio Inc. | SMS delivery (optional) | United States | SCCs in Twilio DPA |
| Africa's Talking | SMS delivery (Kenya) | Kenya | Domestic processor agreement |
| Google LLC (Gmail SMTP) | Transactional email | United States | SCCs |

All sub-processors are bound by a written data processing agreement that reflects the Art. 28 GDPR / KDPA s.42 controller-processor requirements.

## 4. Review cycle

This RoPA is reviewed at least annually and within 30 days of any of:

* introducing a new sub-processor;
* adding a new processing purpose;
* a personal-data breach affecting more than 100 data subjects;
* changes to KDPA or Office of the Data Protection Commissioner guidance.
