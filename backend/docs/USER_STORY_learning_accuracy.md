# User Story — System Learns From Uploaded Invoices and Gets More Accurate Over Time

## Story

> **As a** claims officer who indexes many invoices under a Job Setup,
> **I want** the system to learn from every invoice I confirm,
> **so that** over time it pre-fills and suggests the right values on its own,
> requiring fewer corrections from me — i.e. it becomes self-sufficient and more
> accurate the longer it is used.

## Background — how "learning" actually works

Learning is **frequency-based and isolated per Job Setup** (see
`src/job-setup/job-setup-knowledge.service.ts`):

- Every time a draft claim is **published**, the confirmed field values are
  recorded (`record()`), incrementing a per-value `frequency` counter keyed by
  `(jobSetupId, fieldKey, valueNorm)`.
- Suggestions (`suggest()`) and auto-fill (`topValue()`) read that store ranked
  by `frequency` then recency.
- Knowledge is **scoped by `jobSetupId`** — what is learned under "Invoice" is
  never read while indexing under another setup. There is no global pool.
- `learningEnabled` on the setup gates whether anything is recorded.

So "more accurate over time" means: **as observation counts grow, the system's
top suggestion / auto-fill increasingly matches what the user would have typed,
and the number of manual corrections per invoice trends down.**

## Acceptance Criteria

1. **It records on confirm.** Publishing a draft increases `frequency` for each
   confirmed, non-empty field value under that setup (and only that setup).
2. **It suggests what it has seen.** Type-ahead returns previously confirmed
   values for the field, highest-frequency first.
3. **It auto-fills the dominant value.** The most frequently confirmed value is
   offered as the default on a new invoice for that field.
4. **It stays isolated.** Values learned under Setup A never appear as
   suggestions/auto-fill under Setup B.
5. **It improves measurably.** Across a stream of similar invoices, the
   correction rate (fields the user had to change vs. fields accepted as-is)
   decreases as cumulative observations increase.
6. **It respects the toggle & reset.** With `learningEnabled=false` nothing is
   recorded; `reset()` clears a setup's knowledge and accuracy returns to a
   cold-start baseline.

## How We Test It

### Test 1 — Cold start → warm (single field convergence)
1. Create a fresh setup with `learningEnabled=true`; confirm its knowledge is empty (`stats()` returns nothing for the field).
2. Publish invoice #1 with `provider = "Aga Khan Hospital"`.
3. Assert `suggest(setup, "provider", "aga")` now returns that value with `frequency = 1`.
4. Publish 4 more invoices with the same provider.
5. Assert `topValue(setup, "provider") === "Aga Khan Hospital"` and `frequency = 5`.
6. **Pass:** the value the user repeatedly confirms becomes the auto-fill default.

### Test 2 — Ranking reflects real-world frequency
1. Publish "Provider A" ×7 and "Provider B" ×2 under the same field.
2. Assert `suggest()` returns A before B (frequency-ordered), and `topValue()` is A.
3. **Pass:** the most common value wins, even when alternatives exist.

### Test 3 — Accuracy-improves-over-time (the core metric)
1. Prepare an ordered stream of N (e.g. 50) realistic invoices for one setup,
   each with a known "ground-truth" value per field.
2. For each invoice, **before** confirming, capture the system's suggestion/auto-fill
   (`topValue`) for each field and compare to ground truth → record a hit/miss.
3. Then confirm the invoice (feeding `record()`), and move to the next.
4. Compute a rolling accuracy = hits / fields over a sliding window (e.g. last 10).
5. **Pass:** rolling accuracy curve is **monotonically non-decreasing in trend**
   and exceeds a target (e.g. ≥85%) by the end of the stream — and average
   corrections-per-invoice trends downward. (This is the "self-sufficient in the
   long run" proof.)

### Test 4 — Isolation between setups
1. Teach Setup A `scheme = "Corporate"`.
2. Query suggestions for `scheme` under Setup B.
3. **Pass:** Setup B returns nothing learned from A; setups never cross-contaminate.

### Test 5 — Toggle off and reset
1. With `learningEnabled=false`, publish an invoice → assert `record()` returns `{ recorded: 0 }` and `stats()` is unchanged.
2. Re-enable, learn some values, then `reset(setup)` → assert `stats()` is empty and accuracy falls back to cold-start.

### Test 6 — Normalization robustness
1. Confirm `"Aga Khan  Hospital"`, `"aga khan hospital"`, `" AGA KHAN HOSPITAL "` across invoices.
2. **Pass:** these collapse to one `valueNorm` (one knowledge row, `frequency = 3`),
   not three competing entries — so casing/whitespace noise doesn't dilute learning.

## Definition of Done

- Automated test (seeded stream) demonstrates the rolling-accuracy curve in
  Test 3 rising to the target threshold and corrections-per-invoice falling.
- Isolation (Test 4) and toggle/reset (Test 5) pass.
- A `stats()`-backed admin view shows, per setup, distinct values and total
  observations — so the team can watch a setup "mature" in production.

## Out of Scope / Notes

- This story covers the **per-setup index learning** loop. OCR/vision extraction
  quality and the ML sidecar (anomaly + image quality) are measured separately.
- "Accuracy" here is index-field correctness against confirmed user values, not a
  claims-fraud or billing-audit metric.
