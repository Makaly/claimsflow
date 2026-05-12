# Contributing

Thank you for your interest in contributing to the CIC Medical Claims Automation backend.

## Branch Conventions

| Prefix | Purpose | Example |
|---|---|---|
| `feat/` | New feature | `feat/provider-onboarding` |
| `fix/` | Bug fix | `fix/jwt-expiry-handling` |
| `refactor/` | Code improvement without behaviour change | `refactor/claims-service` |
| `docs/` | Documentation only | `docs/api-endpoints` |
| `test/` | Adding or updating tests | `test/auth-guards` |
| `chore/` | Build scripts, dependencies | `chore/upgrade-nestjs` |

Always branch off `main` and keep branches short-lived.

## Commit Style

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Examples:**

```
feat(claims): add batch status endpoint
fix(ocr): handle empty invoice pages gracefully
docs(readme): add Docker usage instructions
chore(deps): upgrade prisma to v5.8
```

## Pull Request Checklist

- [ ] Branch is up to date with `main`
- [ ] Code lints without errors (`npm run lint`)
- [ ] All existing tests pass (`npm run test`)
- [ ] New behaviour is covered by tests
- [ ] `.env.example` updated if new environment variables are added
- [ ] Prisma migration included if schema changed
- [ ] PR description explains *what* changed and *why*

## Code Style

- Use the project Prettier and ESLint configs — run `npm run lint` before committing
- Prefer `async/await` over raw Promises
- Keep service methods focused; extract helpers to `common/services` when reused across modules
- Validate all external input with `class-validator` DTOs
- Never commit secrets or credentials — use `.env` (already git-ignored)

## Local Development

See [README.md](README.md) for environment setup and database migration instructions.
