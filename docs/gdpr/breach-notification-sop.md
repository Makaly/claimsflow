# Personal Data Breach Notification — Standard Operating Procedure

**Statutory basis:** Kenya Data Protection Act 2019 s.43; GDPR Art. 33-34.
**Document owner:** Data Protection Officer (dpo@cic.co.ke).
**Last reviewed:** 2026-05-13.

## 1. Purpose

This SOP defines how ClaimsFlow personnel must detect, contain, investigate, document and report a personal data breach so the controller meets its 72-hour notification obligation to the Office of the Data Protection Commissioner ("**ODPC**") and, where required, to affected data subjects.

## 2. Definition

A *personal data breach* is any security incident that leads to:

* accidental or unlawful destruction, loss or alteration of personal data;
* unauthorised disclosure of, or access to, personal data.

Examples in the ClaimsFlow context include: leaked database snapshot, compromised admin account, stolen laptop with cached claim data, lost backup tape, accidental email of a claim PDF to the wrong member, sub-processor security advisory.

## 3. Roles

| Role | Responsibility |
|---|---|
| First responder | Anyone who notices the incident — they must log it within 15 minutes on the incident channel. |
| Incident Commander (IC) | Backend Lead or on-call engineer. Coordinates technical response. |
| Data Protection Officer (DPO) | Owns the regulator-facing process. Decides whether the breach meets the notification threshold. |
| Communications lead | Owns subject-facing communications. |
| Executive sponsor | Chief Risk Officer. |

## 4. Workflow

### 4.1 Detect (T+0)

Anyone observing one of the following must raise the alarm:

* unfamiliar account with elevated privileges;
* sustained 5xx spike on `/api/auth/*` or `/api/claims/*`;
* successful login from an unexpected country (visible in `activity_logs.ipAddress`);
* an alert from a sub-processor's security advisory channel;
* a complaint from a member, provider or regulator alleging unauthorised disclosure.

### 4.2 Contain (T+0 → T+1h)

The IC initiates the standard containment runbook:

1. Rotate the affected credentials/tokens (JWT secret, API keys, SMTP, DB password).
2. Disable any suspect user account (`PATCH /api/users/:id` with `isActive=false`).
3. Snapshot evidence — copy logs, database dumps, OS process list — to a write-once incident bucket.
4. If the breach is ongoing, take the application offline rather than allow continued exposure.

### 4.3 Assess (T+1h → T+24h)

The DPO chairs a triage call to determine:

* Scope — which data subjects, which categories of data, how many records.
* Risk to subjects — physical, financial, reputational, psychological.
* Whether the breach involves special category data (health, biometric, genetic). If yes the threshold for notification is automatically met.

### 4.4 Notify ODPC (≤T+72h)

If the breach is *likely to result in a risk to the rights and freedoms of natural persons*, the DPO files a notification with the ODPC using the form available at https://www.odpc.go.ke. The notification must include:

* nature of the breach and categories/numbers of subjects and records;
* contact details of the DPO;
* likely consequences;
* measures taken or proposed to mitigate.

If the full assessment is not complete at the 72-hour mark, the DPO submits an *initial notification* and follows up with phased updates per KDPA s.43(3).

### 4.5 Notify subjects (without undue delay)

Where the breach is likely to result in a *high* risk to the rights and freedoms of subjects (KDPA s.43(4)), the Communications Lead issues a direct notification (email, SMS, in-app banner) containing:

* a plain-language description;
* DPO contact details;
* likely consequences;
* the steps subjects can take to protect themselves;
* the remedies the controller is offering.

Direct notification can be replaced with a public communication if the data subjects cannot reasonably be reached.

### 4.6 Record (within 7 days of closure)

Every incident — notifiable or not — is recorded in `docs/gdpr/breach-register.md` (private register) with: detection time, containment time, categories of data, number of subjects, risk assessment, notification decision and lessons learned.

### 4.7 Review (within 30 days)

The DPO chairs a blameless post-mortem. Output:

* root cause;
* control gaps;
* change requests (added as `A`-numbered actions in the DPIA);
* sign-off by the Executive Sponsor.

## 5. Escalation contacts

| | |
|---|---|
| Incident channel | #incident-response (Slack / Teams) |
| DPO | dpo@cic.co.ke / +254 (0)20 282 3000 |
| ODPC complaints portal | https://complaints.odpc.go.ke/ |
| Render security | security@render.com |
| Google Cloud security | https://cloud.google.com/support/contact |
| Anthropic security | security@anthropic.com |

## 6. Annexes

* Notification template — `docs/gdpr/templates/odpc-notification.md`.
* Subject notification template — `docs/gdpr/templates/subject-notification.md`.
* Tabletop exercise log — run twice a year, results filed alongside the DPIA review.
