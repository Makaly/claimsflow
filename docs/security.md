# Security

The full security policy is in [`SECURITY.md`](https://github.com/cic-insurance/claims/blob/master/SECURITY.md).

## Highlights

- All inbound traffic terminates at the API gateway with `helmet` security headers and a strict CSP.
- Authentication uses HTTP-only, `SameSite=Strict` JWT cookies — no tokens in `localStorage`.
- Login lockout after 5 failed attempts, with a 15-minute cooldown.
- Passwords hashed with bcrypt (cost 10).
- Rate limiting via `@nestjs/throttler` — global 120 req/min, auth endpoints 10 req/min.
- File uploads validated via magic-byte sniffing (`pdf`, `png`, `jpg` only).

## Automated security checks in CI

| Check               | Tool                          | Stage         |
| ------------------- | ----------------------------- | ------------- |
| Static analysis     | CodeQL (`.github/workflows/codeql.yml`) | scheduled + PR |
| Dep vulns           | `npm audit`                   | every PR      |
| Secret scanning     | gitleaks                      | every PR      |
| Container image scan| Trivy                         | every PR      |
| Dynamic baseline    | OWASP ZAP baseline scan       | nightly       |

## Reporting a vulnerability

Email <security@cic.co.ke>. We aim to acknowledge reports within 48 hours.
