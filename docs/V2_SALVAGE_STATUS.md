# V2 Implementation — Salvage Status

**Snapshot taken:** 2026-05-19 ~11:30 EAT
**Trigger:** All 10 parallel agents tripped the daily usage limit. Reset at **2:50pm EAT**. This document captures what was completed, partial, and not started so the next batch can resume cleanly.

## Branch map

| Branch | Status | Contains |
| --- | --- | --- |
| `master` | clean, 1 commit ahead of origin | T2.1 fraud auto-retrain (commit `d014d95`) — already done |
| `v2-t1-ocr` | clean, 1 commit ahead | T1.1 Gemini prompt + structured JSON schema |
| `v2-t4-perf` | clean, 1 commit ahead | T4.1 N+1 elimination on workflow/SLA endpoints |
| `v2-b1-payouts` | clean, 1 commit ahead | B1 M-Pesa B2C + Airtel Money adapter scaffold |
| `v2-salvage` | 2 commits ahead | Bundled partial work — needs splitting into per-item commits |
| `worktree-agent-a889557464fab568f` | source of T1.1 cherry-pick | superseded; can be removed after worktree cleanup |
| `worktree-agent-a21c119d7050af80e` | source of B1 files | superseded; can be removed after worktree cleanup |

## Item-by-item status

### Part II — Fine-Tuning

| # | Status | Where | Notes |
| --- | --- | --- | --- |
| T1.1 Gemini prompt + JSON schema | DONE | `v2-t1-ocr` | committed |
| T1.2 Confidence-based fallback | TODO | — | not started |
| T1.3 Image preprocessing | TODO | — | not started |
| T1.4 Row-level confidence gating | TODO | — | not started |
| T1.5 Classifier retraining | TODO | — | not started |
| T2.1 Auto-retrain + drift detection | DONE | `master` | committed locally on master |
| T2.2 Per-provider thresholds | PARTIAL | `v2-salvage` | Prisma model present; service+endpoint missing |
| T2.3 Heuristic weight rebalance UI | TODO | — | not started |
| T2.4 Per-claim-type duplicate window | PARTIAL | `v2-salvage` | `ClaimTypeConfig` model present; detector wiring missing |
| T3.1 SLA value bands + business-hours | PARTIAL | `v2-salvage` | `public_holidays` table + migration present; SLA service edits missing |
| T3.2 Maker-checker routing | PARTIAL | `v2-salvage` | `User.activeStatus` + `seniorityTier` added; routing logic missing |
| T3.3 Notification digests + quiet hours | PARTIAL | `v2-salvage` | `notification_preferences` + `notifications_queue` tables present; dispatch worker missing |
| T3.4 Scorecard split (quality vs volume) | TODO | — | not started |
| T3.5 Scan-metering pacing alerts | PARTIAL | `v2-salvage` | `scan_pacing_alerts` + quota cols present; worker + UI missing |
| T4.1 N+1 elimination | DONE | `v2-t4-perf` | committed |
| T4.2 Hot-path indexes | TODO | — | not started |
| T4.3 Trigram indexes | TODO | — | not started |
| T4.4 Redis memoisation | TODO | — | not started |
| T4.5 Activity-log partitioning | TODO | — | not started |
| T4.6 Frontend bundle splitting | TODO | — | not started |
| T4.7 WebSocket heartbeat tuning | TODO | — | not started |

### Part I — Functional Requirements

| # | Status | Where | Notes |
| --- | --- | --- | --- |
| A1 Member mobile app | PARTIAL | `v2-salvage` | `mobile/` skeleton (nav + services, 8 files). No screens, no tests, no e-card UI |
| A2 WhatsApp adapter | TODO | — | not started |
| A3 Provider Portal v2 | TODO | — | not started |
| A4 NPS module | TODO | — | not started |
| B1 M-Pesa + Airtel adapters | PARTIAL | `v2-b1-payouts` | 4-file scaffold. Missing: migration, callbacks, reconciliation worker, .env entries |
| B2 ERP/GL connector | TODO | — | not started |
| B3 Bank statement ingestion | TODO | — | not started |
| B4 Co-pay calculator engine | TODO | — | not started |
| C1 Image-tamper detector | PARTIAL | `v2-salvage` | only `/score-image` endpoint declaration in ml-sidecar; no implementation |
| C2 RAG claim assistant | TODO | — | not started |
| C3 Auto-triage / green-lane | TODO | — | not started |
| C4 Clinical NLP | TODO | — | not started |
| C5 Swahili localisation | TODO | — | not started |
| D1 HL7/FHIR connector | TODO | — | not started |
| D2 Telemedicine | TODO | — | not started |
| D3 PBM module | TODO | — | not started |
| D4 Chronic-disease cohorts | TODO | — | not started |
| E1 Observability/OTel | TODO | — | not started |
| E2 DR automation | TODO | — | not started |
| E3 SSO (OIDC/SAML) | TODO | — | not started |
| E4 Feature flags | TODO | — | not started |
| E5 Multi-tenancy groundwork | TODO | — | not started |
| F1 Case management | TODO | — | not started |
| F2 Correspondence module | TODO | — | not started |
| F3 Bulk operations | TODO | — | not started |
| F4 Workflow designer (vertical slice) | TODO | — | not started |

**Totals:** 4 done · 8 partial · 35 not started

### Bonus (unplanned but salvaged)

- `searchable-pdf.service.ts` + `extractHocrPages` on OcrService — 250-line searchable-PDF text-layer service that one of the OCR-track agents wrote in addition to its assigned items. Lives on `v2-salvage`. Logical bedfellow for T1 work.

## Resume plan for 2:50pm reset

1. **Don't re-run the 4 DONE items.** Skip T1.1, T2.1, T4.1 (and merge the existing scaffold for B1 — it just needs finishing).
2. **For the 8 PARTIAL items**, re-spawn 4 agents (T2, T3, A1, C1) with prompts pointed at `v2-salvage` to finish what's there and split it into proper per-item commits.
3. **For the 35 TODO items**, re-spawn 6 agents (T1 remaining, T4 remaining, A2-A4, B2-B4, C2-C5, D1-D4, E1-E5, F1-F4) with worktrees off `master`.
4. **Tighten the prompts:** add a hard "DO NOT TOUCH the main checkout — work only inside your worktree" rule. The original prompts didn't say this and ~half the agents wrote to the main checkout.
5. **After agents commit**, merge their branches into `master` sequentially. Resolve conflicts where multiple branches touch the same prisma file.

## How to resume the conversation

When you come back at 2:50pm, ask the assistant to:
> "Resume v2 implementation per docs/V2_SALVAGE_STATUS.md — spawn agents only for the partial + not-started items, with the don't-touch-main-checkout rule."
