# Disaster Recovery Tabletop Runbook — Q3 2026

**Owner:** Platform & SRE team  
**Review date:** 2026-07-15  
**Participants:** Backend lead, DBA, DevOps, CISO, CTO

---

## Scenario 1 — Full database loss

**Trigger:** Production Postgres cluster is unrecoverable (hardware failure, accidental DROP, ransomware).

| Step | Action | Owner | SLO |
|------|--------|-------|-----|
| 1 | Page on-call DBA and Platform lead | PagerDuty | < 5 min |
| 2 | Confirm backup availability in `DR_BACKUP_BUCKET` | DBA | < 10 min |
| 3 | Provision new Postgres instance (same region) | DevOps | < 20 min |
| 4 | Set `DR_STAGING_DATABASE_URL` to new instance | DevOps | < 25 min |
| 5 | Run `daily_restore_drill.sh` against new instance | DBA | < 60 min |
| 6 | Point `DATABASE_URL` in backend env to new instance and restart | DevOps | < 70 min |
| 7 | Run smoke tests (curl /api/health; check claims table count) | Backend | < 75 min |
| 8 | Communicate status to stakeholders | CISO | < 80 min |

**RTO target:** 90 minutes  
**RPO target:** 24 hours (daily backup cadence; upgrade to WAL streaming for < 1 h RPO)

---

## Scenario 2 — Region failure

**Trigger:** Primary cloud region is unavailable for > 15 minutes.

| Step | Action | Owner | SLO |
|------|--------|-------|-----|
| 1 | Confirm region outage via cloud-provider status page | DevOps | < 5 min |
| 2 | Activate DR region environment (pre-provisioned standby) | DevOps | < 15 min |
| 3 | Update DNS / load-balancer to route to DR region | DevOps | < 20 min |
| 4 | Verify latest cross-region backup is restored and healthy | DBA | < 40 min |
| 5 | Enable read-write mode on DR Postgres replica | DBA | < 45 min |
| 6 | Run smoke tests | Backend | < 55 min |
| 7 | Notify users of potential data gap (RPO window) | CISO | < 60 min |

**RTO target:** 60 minutes  
**RPO target:** 1 hour (requires cross-region streaming replication — TODO: configure)

---

## Scenario 3 — API key / secret leak

**Trigger:** A credential appears in a git commit, log line, or security alert.

| Step | Action | Owner | SLO |
|------|--------|-------|-----|
| 1 | Identify the leaked credential and its service | CISO | < 15 min |
| 2 | Rotate the credential in the issuing service | DevOps | < 30 min |
| 3 | Update secret in deployment environment and restart services | DevOps | < 45 min |
| 4 | Scan git history (`gitleaks`) and rewrite if needed | Backend | < 60 min |
| 5 | Audit access logs for the affected credential's usage window | CISO | < 120 min |
| 6 | File incident report (GDPR Art. 33 / KDPA s.43 — 72 h window) | CISO | < 72 h |

**Note:** Per the 2026-05-12 security audit — CRITICAL: rotate all API keys immediately.

---

## Post-tabletop checklist

- [ ] Record RTO/RPO actuals in `dr_measurements` table via `rpo_rto_measure.sh`
- [ ] Update runbook with any gaps discovered during the exercise
- [ ] File action items in the engineering backlog
- [ ] Schedule next tabletop (Q4 2026)
