# Appeals workflow

The appeals module lets a provider formally contest a **rejected** or
**fraud-confirmed** invoice. It runs as a three-party conversation between the
provider, a claims officer, and a fraud officer, ending in a binding decision
that either reinstates the invoice or upholds the original outcome.

The feature is split between `backend/src/appeals` (NestJS module) and
`frontend/src/pages/Appeals.tsx` (the workspace UI).

## Lifecycle

```
filed ──▶ pending ──▶ under_review ──▶ finalised (upheld | dismissed)
```

| Status         | Meaning                                                        |
| -------------- | ------------------------------------------------------------- |
| `pending`      | Filed, awaiting a reviewer to pick it up.                      |
| `under_review` | A reviewer has engaged (status change or first thread reply). |
| `finalised`    | A decision has been recorded; the thread becomes read-only.   |

| Outcome     | Effect                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `upheld`    | Fraud verdict cleared, invoice reinstated and routed to `claims_officer_review`.    |
| `dismissed` | Original decision stands.                                                           |

## Eligibility & filing windows

Only invoices in an appealable state can be contested, and only within a
statutory window measured from the decision date:

| Source claim status | Window  |
| ------------------- | ------- |
| `rejected`          | 30 days |
| `fraud_confirmed`   | 60 days |

A claim may only have **one active appeal** (`pending` or `under_review`) at a
time. These rules are enforced server-side in `AppealsService.fileAppeal`.

## Roles

| Role                              | Capabilities                                               |
| --------------------------------- | --------------------------------------------------------- |
| `provider_admin` / `provider_user`| File appeals (own provider), post messages & attachments. |
| `claims_officer`                  | All of the above + move to review + adjudicate.            |
| `fraud_officer`                   | Read appeals, join the thread (no adjudication).           |
| `admin`                           | Full access.                                               |

Provider accounts are automatically scoped to their own provider's appeals.

## SLA & aging

Open appeals are tracked against a **14-day resolution target**. The UI surfaces
the age of each appeal as a badge — `Nd open`, `Nd left` (at risk, within 4 days
of the target), or `Nd overdue` — and an "SLA Overdue" counter. The same
threshold powers the `overdue` figure in the analytics endpoint.

## API

All routes are under `/api/appeals` and require a valid session. Provider roles
are scoped to their own provider automatically.

| Method & path                       | Roles                                   | Purpose                                            |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `POST /appeals`                     | provider\*, claims_officer, admin       | File a new appeal.                                  |
| `GET /appeals`                      | all staff + provider\*                   | List appeals. Supports `status`, `outcome`, `search`, `dateFrom`, `dateTo`, `sortBy`, `sortOrder`, `limit`, `offset`. |
| `GET /appeals/analytics`            | all staff + provider\*                   | Aggregate stats (status/outcome split, upheld rate, avg resolution, overdue count, monthly trend, by-provider). |
| `PATCH /appeals/:id/status`         | claims_officer, admin                    | Move an appeal to `under_review`.                   |
| `PATCH /appeals/:id/adjudicate`     | claims_officer, admin                    | Record the final `upheld` / `dismissed` decision.  |
| `GET /appeals/:id/messages`         | all staff + provider\*                   | Fetch the discussion thread.                       |
| `POST /appeals/:id/messages`        | all staff + provider\*                   | Post a message (with optional `attachments[]`).    |
| `POST /appeals/attachments/upload`  | all staff + provider\*                   | Upload a supporting file (multipart).              |
| `GET /appeals/attachments/:file`    | all staff + provider\*                   | Stream a previously uploaded attachment.           |

List responses include `messageCount`, `lastMessageAt`, and `lastMessageBy` per
appeal so the client can render unread indicators.

## Workspace UI

`Appeals.tsx` provides two tabs:

- **Queue** — searchable, filterable, sortable, paginated table with SLA badges,
  unread dots, summary cards, a "File Appeal" dialog, and CSV export.
- **Analytics** — KPI cards and charts (status breakdown, outcome split, monthly
  trend, by-provider) rendered with Recharts.

Selecting a row opens a slide-over detail panel with the linked claim summary
(and a deep link to the full claim via `/claims?open=<claimNumber>`), the appeal
metadata, a progress timeline, the three-party thread with attachments, and —
for staff — inline review/adjudication controls.

## Demo data

Two SQL seeds under `backend/prisma` populate a working demo:

- `seed-appeals.sql` — appeals across every status and outcome, plus a sample
  discussion thread.
- `seed-appealable-claims.sql` — rejected and fraud-confirmed claims that are
  eligible to be appealed, so the filing flow can be exercised end-to-end.

Apply with `psql "$DATABASE_URL" -f backend/prisma/<file>.sql`.
