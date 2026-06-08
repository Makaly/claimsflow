# Security Policy

ClaimsFlow processes sensitive patient and financial data on behalf of CIC
Insurance Group PLC. We take security reports seriously and aim to
acknowledge new disclosures within **two business days**.

## Supported versions

| Version | Supported        |
| ------- | ---------------- |
| 2.0.x   | ✅ Yes           |
| 1.9.x   | ⚠️ Security only  |
| < 1.9   | ❌ No            |

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
- Set `JWT_SECRET` to at least 32 random characters (`openssl rand -hex 64`
  is recommended). The backend refuses to start in production if it detects
  a known-insecure placeholder value.
- Rotate **all** API keys (AI Vision, Gemini, Twilio, Africa's Talking,
  SMTP, `ML_SIDECAR_API_KEY`, `SSO_WEBHOOK_SECRET`) on any suspicion of
  disclosure — they cannot be revoked retroactively.
- Run the backend behind TLS termination only. The application sets HSTS
  via Helmet but expects an HTTPS-terminating proxy in production.
- Enable two-factor authentication for every administrator account.
- Restrict database and Redis network access to the application subnet.
  In Docker Compose, both services bind to `127.0.0.1` by default.
- Keep the underlying base image patched (`alpine:latest` is rebuilt
  weekly in CI).
- In Kubernetes, apply `k8s/networkpolicy.yaml` to enforce default-deny
  ingress within the namespace.
- Admin-configured lookup source URLs are validated against an SSRF
  allowlist; do not disable `assertSafeOutboundUrl` in deployment.

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
