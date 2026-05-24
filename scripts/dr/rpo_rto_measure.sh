#!/usr/bin/env bash
# rpo_rto_measure.sh — calculate RPO and RTO from the most recent drill log
# and emit a JSON result suitable for ingestion by the monthly cron that writes
# to the dr_measurements Postgres table.
#
# RPO = age of the backup file at the time of restore (data loss window).
# RTO = elapsed time from drill start to smoke-check pass.
#
# Required env vars:
#   DR_BACKUP_BUCKET      — same as daily_restore_drill.sh
#   DR_STAGING_DATABASE_URL
#   DR_LOG_FILE           — path to the CSV log written by the drill script

set -euo pipefail

LOG_FILE="${DR_LOG_FILE:-/tmp/dr_measurements.log}"
STAGING_DB="${DR_STAGING_DATABASE_URL:?DR_STAGING_DATABASE_URL must be set}"

if [[ ! -f "${LOG_FILE}" ]]; then
  echo '{"error":"no drill log found","path":"'"${LOG_FILE}"'"}' >&2
  exit 1
fi

LAST_LINE=$(tail -1 "${LOG_FILE}")
TIMESTAMP=$(echo "${LAST_LINE}" | cut -d',' -f1)
RTO_SECONDS=$(echo "${LAST_LINE}" | grep -oP 'rto_seconds=\K\d+')
BACKUP_KEY=$(echo "${LAST_LINE}" | grep -oP 'backup=\K\S+')

# Derive RPO from backup object's last-modified timestamp.
if [[ "${DR_BACKUP_BUCKET}" == s3://* ]]; then
  BACKUP_MTIME=$(aws s3 ls "s3://${BACKUP_KEY}" | awk '{print $1" "$2}')
elif [[ "${DR_BACKUP_BUCKET}" == gs://* ]]; then
  BACKUP_MTIME=$(gsutil stat "gs://${BACKUP_KEY}" 2>/dev/null \
    | grep 'Update time' | awk -F': ' '{print $2}')
else
  BACKUP_MTIME="unknown"
fi

DRILL_EPOCH=$(date -d "${TIMESTAMP}" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "${TIMESTAMP}" +%s)
BACKUP_EPOCH=$(date -d "${BACKUP_MTIME}" +%s 2>/dev/null || echo 0)
RPO_SECONDS=$(( DRILL_EPOCH - BACKUP_EPOCH ))

RESULT=$(cat <<JSON
{
  "measured_at": "${TIMESTAMP}",
  "rto_seconds": ${RTO_SECONDS},
  "rpo_seconds": ${RPO_SECONDS},
  "backup_key": "${BACKUP_KEY}",
  "rto_hours": $(echo "scale=2; ${RTO_SECONDS}/3600" | bc),
  "rpo_hours": $(echo "scale=2; ${RPO_SECONDS}/3600" | bc)
}
JSON
)

echo "${RESULT}"

# Write into the dr_measurements table via psql.
psql "${STAGING_DB}" -c "
  INSERT INTO dr_measurements (measured_at, rto_seconds, rpo_seconds, backup_key, raw_json)
  VALUES (
    '${TIMESTAMP}'::timestamptz,
    ${RTO_SECONDS},
    ${RPO_SECONDS},
    '${BACKUP_KEY}',
    '${RESULT}'::jsonb
  )
  ON CONFLICT DO NOTHING;
"
