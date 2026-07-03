#!/usr/bin/env bash
#
# commit-licensing.sh — stage the licensing work into a clean, conventional
# commit history on a feature branch, then push and (optionally) open + merge a
# pull request.
#
# Safe by design:
#   • stages only explicit licensing paths — never `git add -A` at the root
#   • refuses to run if a secret file (.env / *.pem) would be committed
#   • removes the stray scratch notebook before staging
#   • each commit is guarded — it is skipped if nothing was staged for it
#
# Usage:
#   bash scripts/commit-licensing.sh              # commit + push + PR (prompts before merge)
#   SKIP_BUILD=1 bash scripts/commit-licensing.sh # skip the prisma generate + build check
#   NO_PUSH=1   bash scripts/commit-licensing.sh  # commit only, no push/PR
#
set -euo pipefail

BRANCH="feat/licensing"
BASE="master"

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
echo "▶ repo: $REPO"

# ── Preflight ────────────────────────────────────────────────────────────────
# 1. Drop the scratch notebook (not gitignored, must never be committed).
rm -f backend/_seed_runner.ipynb

# 2. Confirm secrets are ignored.
if ! git check-ignore -q .env; then
  echo "✗ .env is NOT ignored — aborting. Add it to .gitignore before committing." >&2
  exit 1
fi
echo "✓ .env is gitignored"

# 3. Optional: ensure the tree builds (regenerate the Prisma client first).
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "▶ regenerating Prisma client + building backend (SKIP_BUILD=1 to skip)…"
  ( cd backend && npx prisma generate && npm run build )
  echo "✓ backend builds"
fi

# ── Helpers ──────────────────────────────────────────────────────────────────
# Stage a path only if it exists in the working tree or is already tracked.
# `add -A -- <path>` correctly stages additions, modifications AND deletions.
stage() {
  local p
  for p in "$@"; do
    if [ -e "$p" ] || git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
      git add -A -- "$p"
    fi
  done
}

# Commit only if something is staged.
commit() {
  local msg="$1"
  if git diff --cached --quiet; then
    echo "  (nothing staged — skipping: $msg)"
  else
    git commit -m "$msg"
    echo "✓ $msg"
  fi
}

# Hard stop if any secret slipped into the index.
assert_no_secrets() {
  if git diff --cached --name-only | grep -E '(^|/)\.env($|\.)|\.pem$' >/dev/null; then
    echo "✗ a secret file is staged — aborting before commit." >&2
    git diff --cached --name-only | grep -E '(^|/)\.env($|\.)|\.pem$' >&2
    exit 1
  fi
}

# ── Branch ───────────────────────────────────────────────────────────────────
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git switch "$BRANCH"
else
  git switch -c "$BRANCH"
fi
echo "▶ on branch: $BRANCH"

# ── Commit 1: subscription licensing (backend core, schema, migrations, rewire)
stage backend/src/licensing \
      backend/prisma/schema.prisma \
      backend/prisma/migrations/20260622120000_add_licensing_e6 \
      backend/prisma/migrations/20260622140000_license_model_e7 \
      backend/src/scripts/license.ts \
      backend/src/scripts/seed-license.ts \
      backend/src/app.module.ts \
      backend/src/claims/claims.controller.ts \
      backend/src/claims/claims.module.ts \
      backend/src/ocr/ocr.controller.ts \
      backend/src/ocr/ocr.module.ts \
      backend/src/entitlements
assert_no_secrets
commit "feat(licensing): subscription tiers, signed-token verification, metering and lifecycle"

# ── Commit 2: installation phone-home licensing ──────────────────────────────
stage backend/src/license-server \
      backend/src/installation \
      backend/prisma/migrations/20260622160000_installation_licensing_e8
assert_no_secrets
commit "feat(licensing): installation activation keys and heartbeat-lease lockout"

# ── Commit 3: admin web pages ────────────────────────────────────────────────
stage frontend/src/pages/UsageLicense.tsx \
      frontend/src/pages/InstallationLicense.tsx \
      frontend/src/App.tsx \
      frontend/src/components/Sidebar.tsx \
      frontend/vite.config.ts
assert_no_secrets
commit "feat(web): Usage & License and Installation & Licence admin pages"

# ── Commit 4: documentation ──────────────────────────────────────────────────
stage docs/LICENSING.md CHANGELOG.md README.md
assert_no_secrets
commit "docs(licensing): document subscription and installation licensing"

echo
echo "▶ commits on $BRANCH:"
git --no-pager log --oneline "$BASE..$BRANCH" || git --no-pager log --oneline -5

# ── Push + PR ────────────────────────────────────────────────────────────────
if [ "${NO_PUSH:-0}" = "1" ]; then
  echo "▶ NO_PUSH=1 — stopping before push."
  exit 0
fi

git push -u origin "$BRANCH"
echo "✓ pushed $BRANCH"

if command -v gh >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" \
    --title "Licensing: subscription tiers + installation phone-home activation" \
    --body $'Adds two complementary licensing models:\n\n- **Subscription licensing** — Core/Professional/Enterprise tiers, Ed25519 signed-token activation, per-feature gating, metered usage (report/enforce), full lifecycle (trial → active → expired → read-only, plus paused), branded PDF certificate, lifecycle emails, pause/resume with day-credit, and per-seat billing invoices.\n- **Installation licensing** — central license server, online activation keys, short-lived signed heartbeat leases, and full lockout after ~7 days offline.\n\nDocs: docs/LICENSING.md · Changelog updated.' \
    || echo "  (PR may already exist — continuing)"

  read -r -p "Merge the PR into $BASE now? [y/N] " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    gh pr merge "$BRANCH" --merge --delete-branch
    echo "✓ merged into $BASE"
  else
    echo "▶ left the PR open for review."
  fi
else
  echo "▶ gh CLI not found — open a PR manually:"
  echo "    $BRANCH → $BASE"
fi
