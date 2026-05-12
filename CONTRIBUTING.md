# Contributing to ClaimsFlow

Thank you for taking the time to contribute. The guidelines below keep the
codebase consistent, the history readable, and reviews quick.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold its terms.

## Getting set up

```bash
git clone https://github.com/Makaly/claimsflow.git
cd claimsflow
# Backend
cd backend && cp .env.example .env && npm install
npx prisma migrate deploy && npx prisma db seed
npm run start:dev
# Frontend (new shell)
cd ../frontend && npm install && npm run dev
```

See the [README](README.md) for a deeper tour.

## Branching model

We use a lightweight trunk-based flow:

- `master` is always deployable.
- Feature work happens on short-lived branches off `master`.
- Branch names use the pattern `type/short-description`, e.g.
  `feat/appeals-adjudication`, `fix/jwt-cookie-expiry`,
  `chore/upgrade-prisma`.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <subject>

<body — optional, wrap at 72>

<footer — optional: BREAKING CHANGE, Refs, Closes>
```

| Type       | When to use                                                |
| ---------- | ---------------------------------------------------------- |
| `feat`     | A new feature visible to a user or downstream consumer     |
| `fix`      | A bug fix                                                  |
| `perf`     | A change that improves performance                         |
| `refactor` | A code change that neither fixes a bug nor adds a feature  |
| `docs`     | Documentation only                                         |
| `test`     | Adding or correcting tests                                 |
| `build`    | Build system, packaging, dependency bumps                  |
| `ci`       | Changes to CI configuration or scripts                     |
| `chore`    | Routine maintenance with no behavioural impact             |
| `style`    | Formatting only (whitespace, semicolons, etc.)             |

Examples:

```
feat(appeals): adjudicate appeal and persist outcome
fix(auth): guard JSON.parse against corrupt localStorage
docs(readme): document required environment variables
```

Keep each commit focused on one logical change. Squash noisy fixups before
opening a PR.

## Pull request checklist

- [ ] Branch is up to date with `master`.
- [ ] Commit messages follow the convention above.
- [ ] `npm run lint` passes in any package you touched.
- [ ] `npm run build` succeeds.
- [ ] New behaviour is covered by tests where practical.
- [ ] User-facing changes are documented in `CHANGELOG.md` under
      `[Unreleased]`.
- [ ] No secrets, `.env` files, or production data are committed.

Open the PR against `master`. Link the relevant issue with `Closes #N` or
`Refs #N`. Smaller PRs (under ~400 lines of diff) get reviewed faster.

## Code style

### TypeScript

- Prefer named exports.
- Avoid `any` — reach for `unknown` and narrow.
- Validate request payloads with `class-validator` DTOs on the backend and
  Zod on the frontend.
- Keep service methods small and unit-testable; controllers should be thin.

### React

- Functional components only, with hooks.
- Lift shared state into a Zustand store; do not prop-drill more than two
  levels.
- Co-locate Tailwind classes with the component; extract a variant helper
  if the same combination appears more than twice.

### Database

- All schema changes ship as Prisma migrations.
- Migrations must be additive and idempotent — use `IF NOT EXISTS` and
  `IF EXISTS` guards so they replay safely.

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) and include
reproduction steps, expected vs. actual behaviour, and environment details.

## Requesting features

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md)
describing the user problem first, then the proposed solution.

## Security disclosures

Please **do not** open a public issue. Follow [SECURITY.md](SECURITY.md).

Thanks again — every contribution helps.
