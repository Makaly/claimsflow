# Security Policy

ClaimsFlow processes sensitive patient and financial data on behalf of CIC
Insurance Group PLC. We take security reports seriously and aim to
acknowledge new disclosures within **two business days**.

## Supported versions

| Version | Supported       |
| ------- | --------------- |
| 1.2.x   | ✅ Yes          |
| 1.1.x   | ⚠️ Security only |
| < 1.1   | ❌ No           |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Send a private report to **`Developers.kenya@coseke.com`** with:

1. A clear description of the issue and its impact.
2. Steps to reproduce, ideally with a proof-of-concept.
3. The version, deployment environment, and any relevant log excerpts.
4. Your preferred name and contact for credit (optional).

We will:

- Acknowledge receipt within two business days.
- Confirm the vulnerability and assign a severity (CVSS v3.1).
- Share a remediation timeline. Critical issues are patched within seven
  days; high within 30; medium and low on the next minor release.
- Credit you in the release notes unless you ask us not to.

## Hardening checklist for operators

- Rotate `JWT_SECRET` whenever a `.env` file is leaked or shared.
- Rotate **all** API keys (AI Vision, Gemini, Twilio, Africa's Talking,
  SMTP) on any suspicion of disclosure — they cannot be revoked
  retroactively.
- Run the backend behind TLS termination only. The application sets HSTS
  via Helmet but expects an HTTPS-terminating proxy in production.
- Enable two-factor authentication for every administrator account.
- Restrict database and Redis network access to the application subnet.
- Keep the underlying base image patched (`alpine:latest` is rebuilt
  weekly in CI).

## What we consider in-scope

- Authentication and authorisation flaws.
- Server-side injection (SQL, command, prototype pollution, SSRF).
- Cross-site scripting and CSRF in the React app.
- Insecure direct object references on claim, appeal, or payment endpoints.
- Sensitive data exposure in logs, error messages, or responses.
- Cryptographic weaknesses in token, password reset, or 2FA flows.

## What we consider out-of-scope

- Self-XSS that requires the victim to paste content into DevTools.
- Missing best-practice headers on static assets behind a CDN.
- Reports from automated scanners without a working reproduction.
- Denial-of-service via brute application-level load.

Thank you for helping keep ClaimsFlow and its members safe.
