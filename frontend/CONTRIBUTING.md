# Contributing to CIC Medical Claims Frontend

Thank you for your interest in contributing. This document covers the development workflow, conventions, and standards to follow when submitting changes.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Workflow](#workflow)
- [Commit Messages](#commit-messages)
- [Branch Naming](#branch-naming)
- [Code Style](#code-style)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Issues](#reporting-issues)

---

## Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/invoice_frontend.git
cd invoice_frontend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Set VITE_API_BASE_URL to your local backend

# Start the development server
npm run dev
```

The app runs at **http://localhost:3000**. The Vite dev server proxies `/api/*` requests to `http://localhost:4000` — start the backend before testing authenticated flows.

---

## Workflow

1. **Fork** the repository and clone your fork locally.
2. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. Make your changes following the conventions below.
4. Run the full check suite before committing:
   ```bash
   npm run lint
   npm run build
   ```
5. **Commit** using [Conventional Commits](#commit-messages).
6. Push your branch and open a **Pull Request** against `main`.
7. Fill in the PR template completely and link the relevant issue.

---

## Commit Messages

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(optional scope): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or user-facing enhancement |
| `fix` | Bug fix |
| `docs` | Documentation changes only |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Code restructuring with no behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Build process, tooling, dependency updates |
| `ci` | CI/CD configuration changes |
| `revert` | Reverts a previous commit |

### Examples

```
feat(claims): add status filter to claims list table
fix(auth): clear stored token on 401 response
docs(readme): add Docker deployment instructions
chore(deps): bump react to 18.3.1
ci: add npm audit step to CI pipeline
refactor(workflow): extract queue pagination into shared hook
```

### Breaking Changes

Add `!` after the type and include a `BREAKING CHANGE:` footer:

```
feat(auth)!: require 2FA for all admin accounts

BREAKING CHANGE: admin users without 2FA enabled will be redirected
to the setup flow on next login.
```

---

## Branch Naming

| Pattern | Example |
|---|---|
| `feat/<description>` | `feat/batch-upload-progress` |
| `fix/<description>` | `fix/login-redirect-loop` |
| `docs/<description>` | `docs/update-deployment-guide` |
| `chore/<description>` | `chore/upgrade-vite-5` |
| `refactor/<description>` | `refactor/claims-service-types` |

---

## Code Style

- All source files are **TypeScript** — avoid `any`; use `unknown` and narrow types explicitly.
- Import paths use the **`@/` alias** (mapped to `src/`). Never use deep relative paths like `../../../services`.
- **Component files:** `PascalCase.tsx` — one component per file where practical.
- **Non-component files:** `camelCase.ts`.
- Keep components focused. Extract complex logic into custom hooks (`src/hooks/`) or service functions (`src/services/`).
- All forms must use **React Hook Form + Zod** for validation.
- Styling is done via **Tailwind CSS** utility classes. Use the `cn()` helper (`src/lib/utils.ts`) for conditional class composition.
- Do not add `console.log` statements to committed code.

Run `npm run lint` before every commit. The CI pipeline will fail if there are lint errors.

---

## Pull Request Guidelines

- Keep PRs **small and focused** on a single concern. Large PRs are harder to review and slower to merge.
- Fill in the PR template completely, including the type of change and the testing checklist.
- Link the relevant GitHub issue (e.g. `Closes #42`).
- Ensure **`npm run build` and `npm run lint` both pass** before requesting review.
- Add screenshots or screen recordings for any UI changes.
- Do not merge your own PR — at least one review is required.

---

## Reporting Issues

Use the GitHub issue templates:

- **[Bug Report](.github/ISSUE_TEMPLATE/bug_report.md)** — for something that is broken or not working as expected.
- **[Feature Request](.github/ISSUE_TEMPLATE/feature_request.md)** — for new ideas or improvements.

Provide as much context as possible: browser, OS, Node version, steps to reproduce, and any relevant screenshots or error messages.

For security vulnerabilities, follow the process in [SECURITY.md](SECURITY.md) — **do not open a public issue**.
