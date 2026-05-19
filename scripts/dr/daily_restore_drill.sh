#!/usr/bin/env bash
# daily_restore_drill.sh — pull the latest pg_dump from object storage,
# restore it to a staging database, and run a basic smoke check.
# Designed to be executed by a CI/cron job; exits non-zero on any failure
# so the calling scheduler can alert on missed drills.
#
# Required env vars:
#   DR_BACKUP_BUCKET      — s3://bucket/path or gs://bucket/path
#   DR_STAGING_DATABASE_URL — postgres://user:pass@host/dbname
#   DR_BACKUP_PREFIX      — (optional) key prefix to filter backups, default "daily/"

set -euo pipefail

BACKUP_BUCKET="${DR_BACKUP_BUCKET:?DR_BACKUP_BUCKET must be set}"
STAGING_DB="${DR_STAGING_DATABASE_URL:?DR_STAGING_DATABASE_URL must be set}"
PREFIX="${DR_BACKUP_PREFIX:-daily/}"
WORKDIR="$(mktemp -d)"
DUMP_FILE="${WORKDIR}/latest.dump"
DRILL_START="$(date -u +%s)"

cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "DR drill starting — bucket=${BACKUP_BUCKET} prefix=${PREFIX}"

# 1. Discover and download the most recent backup object.
if [[ "${BACKUP_BUCKET}" == s3://* ]]; then
  LATEST_KEY=$(aws s3 ls "${BACKUP_BUCKET}/${PREFIX}" --recursive \
    | sort -k1,2 | tail -1 | awk '{print $NF}')
  aws s3 cp "s3://${LATEST_KEY}" "${DUMP_FILE}"
elif [[ "${BACKUP_BUCKET}" == gs://* ]]; then
  LATEST_KEY=$(gsutil ls -l "${BACKUP_BUCKET}/${PREFIX}**" \
    | sort -k2 | tail -2 | head -1 | awk '{print $NF}')
  gsutil cp "${LATEST_KEY}" "${DUMP_FILE}"
else
  log "ERROR: unsupported bucket scheme (expected s3:// or gs://)"
  exit 1
fi

log "Downloaded backup: ${LATEST_KEY} ($(du -sh "${DUMP_FILE}" | cut -f1))"

# 2. Restore to the staging database (drops all objects first).
log "Restoring to staging database…"
pg_restore --clean --if-exists --no-acl --no-owner \
  -d "${STAGING_DB}" "${DUMP_FILE}" 2>&1 | tail -20

log "Restore complete."

# 3. Smoke check — verify core tables exist and have rows.
SMOKE_RESULT=$(psql "${STAGING_DB}" -t -A -c "
  SELECT
    (SELECT COUNT(*) FROM users)   AS users,
    (SELECT COUNT(*) FROM claims)  AS claims,
    (SELECT COUNT(*) FROM providers) AS providers;
")
log "Smoke check: ${SMOKE_RESULT}"

USERS=$(echo "${SMOKE_RESULT}" | cut -d'|' -f1)
CLAIMS=$(echo "${SMOKE_RESULT}" | cut -d'|' -f2)

if [[ "${USERS}" -lt 1 ]] || [[ "${CLAIMS}" -lt 1 ]]; then
  log "SMOKE CHECK FAILED — users=${USERS} claims=${CLAIMS}"
  exit 2
fi

DRILL_END="$(date -u +%s)"
RTO_SECONDS=$(( DRILL_END - DRILL_START ))
log "DR drill PASSED — RTO=${RTO_SECONDS}s users=${USERS} claims=${CLAIMS}"

# 4. Persist measurement (used by rpo_rto_measure.sh).
cat >> "${DR_LOG_FILE:-/tmp/dr_measurements.log}" <<EOF
$(date -u +%Y-%m-%dT%H:%M:%SZ),restore_drill,rto_seconds=${RTO_SECONDS},users=${USERS},claims=${CLAIMS},backup=${LATEST_KEY}
EOF
