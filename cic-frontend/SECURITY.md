# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Active support |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in this project, please disclose it responsibly by emailing the maintainer directly at the address listed on the GitHub profile. Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any relevant proof-of-concept code or screenshots
- Your suggested fix, if you have one

You can expect an acknowledgement within **48 hours** and a status update within **7 days**. If the vulnerability is confirmed, a patched release will be published as quickly as possible.

Please do **not** disclose the issue publicly until a fix has been released.

---

## Security Considerations

### Authentication
- All API requests require a valid JWT Bearer token
- Tokens are stored in `localStorage` and cleared on logout or 401 response
- TOTP two-factor authentication is available for all user accounts
- Password reset requires email verification

### Frontend Security
- All environment variables exposed to the browser use the `VITE_` prefix — never put secrets in `.env` files that are bundled
- User input is validated with Zod schemas before submission
- The Axios interceptor automatically clears credentials and redirects on session expiry

### Dependency Security
- The CI pipeline runs `npm audit --audit-level=high` on every build
- Dependencies should be kept up to date; use `npm audit` to check for known vulnerabilities
- Review `package-lock.json` changes in pull requests

### Reporting Dependencies
If a vulnerability is in a third-party dependency rather than this codebase, please also report it upstream to the dependency maintainer.
