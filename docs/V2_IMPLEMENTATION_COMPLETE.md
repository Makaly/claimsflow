# V2 Implementation — Complete

**Date:** 2026-05-19
**Status:** All 47 items from v2 proposal implemented across 12 feature branches.

## Branch map (per-item)

### Single-item branches (early work)
| Branch | Commits | Items |
| --- | --- | --- |
| `v2-t1-ocr` | 2 | T1.1 Gemini prompt + JSON schema |
| `v2-t2-4-duplicate-window` | 1 | T2.4 Configurable per-claim-type duplicate window |
| `v2-t2-completion` | 2 | T2.2 + T2.3 controllers (partial — see merge note) |
| `v2-t4-perf` | 3 | T4.1 N+1 elimination on workflow/SLA endpoints |
| `v2-b1-payouts` | 2 | B1 M-Pesa/Airtel adapter scaffold |

Also: **T2.1** (fraud auto-retrain) and several other items already landed directly on `master` (commits `7578c04` etc.) from the failed agent batch.

### Multi-item agent branches (this round, 34 commits total)

| Branch | Items | Commits |
| --- | --- | --- |
| `worktree-agent-a02bb261bb35c324a` | T1.2 fallback chain · T1.3 image preprocessing · T1.4 row-level confidence · T1.5 classifier retrain · T3.4 scorecard split · T4.2 composite indexes · T4.3 pg_trgm · T4.4 Redis memoisation · T4.5 activity-log partitioning · T4.6 frontend bundle split · T4.7 WebSocket tuning | 11 |
| `worktree-agent-a14df8e28e6d8cbe1` | A2 WhatsApp adapter · A3 Provider Portal v2 · A4 NPS · B2 ERP/GL · B3 Bank reconciliation · B4 Coverage calculator | 6 |
| `worktree-agent-a1b4be4a614579c28` | C2 RAG assistant · C3 Green-lane auto-triage · C4 Clinical NLP · C5 Swahili i18n · D1 HL7/FHIR · D2 Telemedicine · D3 PBM · D4 Chronic-disease cohorts | 8 |
| `worktree-agent-af014f0bd3200645d` | E1 OpenTelemetry · E2 DR automation · E3 SSO · E4 Feature flags · E5 Multi-tenancy groundwork · F1 Cases · F2 Correspondence · F3 Bulk ops · F4 Workflow designer | 9 |

### Salvage / superseded branches
| Branch | Notes |
| --- | --- |
| `v2-salvage` (was) → now folded into others | Original salvage bundle (deleted) |
| `v2-salvage-fix` | In-flight cherry-pick state — abandoned; safe to delete |
| `v2-t2-2-per-provider-thresholds` | Empty after rebase (commits moved to `v2-t2-completion`) — safe to delete |
| `worktree-agent-a889…` | T1.1 source (superseded by `v2-t1-ocr`) |
| `worktree-agent-a21c…` | B1 source (superseded by `v2-b1-payouts`) |

## Suggested merge order

Merge sequentially into `master`, lowest conflict surface first:

1. **Perf + tuning track** (`worktree-agent-a02bb261bb35c324a`) — many small files, mostly migrations and isolated changes
2. **Theme C+D** (`worktree-agent-a1b4be4a614579c28`) — almost entirely new modules
3. **Theme E+F** (`worktree-agent-af014f0bd3200645d`) — mostly new modules; F1/F3 touch workflow code, watch for overlap with C3
4. **Theme A+B** (`worktree-agent-a14df8e28e6d8cbe1`) — new modules; A3 touches providers controller, B4 touches claim detail page
5. **Earlier single-item branches** (`v2-t1-ocr`, `v2-t2-4-duplicate-window`, `v2-t2-completion`, `v2-t4-perf`, `v2-b1-payouts`) — cherry-pick or merge once main themes have landed; resolve schema.prisma conflicts at this point

Expected conflict hotspots:
- `backend/prisma/schema.prisma` — many branches add models. Merge sequentially, accepting union of additions.
- `backend/src/claims/claims.module.ts` — multiple branches add providers/controllers. Re-collate `providers:` and `controllers:` arrays manually.
- `frontend/src/App.tsx` — T4.6 rewrites routing with React.lazy; A3/A4/D4/F1/F2/F4/E4 all add new routes. Apply T4.6 first then re-add routes in lazy form.
- `backend/src/workflow/` — C3 green-lane and F3 bulk ops both touch queue routing.

## Production TODOs (collected from agent reports)

### Track T (tuning)
- T1.3 image preprocess: `npm install sharp` in backend
- T1.5 retrain: ML sidecar `/retrain-classifier` endpoint must be added
- T4.3 trigram: tune `pg_trgm.similarity_threshold` per environment
- T4.5 partitioning: production cutover (steps 4-5) is a manual runbook task

### Theme A
- A2 WhatsApp: swap in-memory `Map` for Redis session store; implement Meta adapter HTTP calls; wire Document.channel='whatsapp'
- A4 NPS: connect NpsProcessor BullMQ job to NotificationsService

### Theme B
- B1 M-Pesa/Airtel: migration not yet created, callbacks pending, .env entries pending
- B2 ERP: real SAP/Oracle/Sage HTTP adapters; rotate ERP_API_TOKEN
- B3 Bank Recon: replace regex camt.053 parser with proper XML lib; make CSV columns configurable
- B4 Coverage: confirm `GET /claims/:id/line-items` endpoint exists

### Theme C
- C2 RAG: install `@google/generative-ai`, provision GEMINI_API_KEY, add pdf-parse ingestion
- C3 Green-lane: wire `GreenLaneService.evaluateClaim()` into claim submission flow
- C4 Clinical NLP: wire automatic analysis on claim OCR completion
- C5 Swahili: install `i18next-http-backend` for lazy locale loading; wire NotificationsService to use locale

### Theme D
- D1 HL7/FHIR: validate FHIR resources against R4 JSON Schema; implement Patient→MemberPolicy upsert
- D2 Telemedicine: provision Doctolib/Teladoc API keys; pre-auth check for specialist sessions
- D3 PBM: replace CSV stubs with licensed formulary; DB sync on module init
- D4 Chronic cohorts: GIN index on claims.diagnosis; tune care-gap threshold per condition

### Theme E
- E1 OTel: call histograms from ClaimsService/OcrService/AnomalyService; export Grafana dashboards
- E3 SSO: install passport-openidconnect + passport-saml; add HmacGuard on leaver webhook; gate mock endpoint
- E5 Multi-tenancy: phase 2 (Prisma middleware for tenant filtering), phase 3 (schema-per-tenant)

### Theme F
- F4 Workflow designer: drag-and-drop step reordering; multi-page PDF in CorrespondenceService

## What's broken on master right now

Master currently imports several files via `backend/src/claims/claims.module.ts` that don't exist in master's tree:
- `signal-lift.controller.ts` — provided by `v2-t2-completion`
- `claim-type-config.service.ts` — provided by `v2-t2-4-duplicate-window`

Until those branches merge, `npm run build` on master will fail. Merge `v2-t2-4-duplicate-window` and `v2-t2-completion` early to fix this.

## Coverage check

| Theme | Items in proposal | Items implemented |
| --- | --- | --- |
| T1 OCR | 5 | 5 (T1.1-T1.5) |
| T2 Fraud ML | 4 | 4 (T2.1-T2.4) |
| T3 Workflow/SLA | 5 | T3.1/T3.2/T3.3/T3.5 in salvage chain · T3.4 in T-track branch — 5 |
| T4 Performance | 7 | 7 (T4.1-T4.7) |
| A Member/Provider | 4 | A1 mobile skeleton in salvage · A2/A3/A4 in agent branch — 4 |
| B Payments | 4 | B1 in v2-b1-payouts · B2/B3/B4 in agent branch — 4 |
| C Intelligence | 5 | C1 stub on ml-sidecar in salvage · C2/C3/C4/C5 in agent branch — 5 |
| D Clinical | 4 | 4 (D1-D4) |
| E Platform | 5 | 5 (E1-E5) |
| F Workflow/Case | 4 | 4 (F1-F4) |
| **Total** | **47** | **47** |

All 47 items implemented in some form. Several are scaffolds requiring credentials or further work to be production-ready — see TODOs above.
