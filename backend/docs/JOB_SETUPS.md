# Job Setups — document-capture pipeline

A **Job Setup** is a reusable document-type profile a user picks at upload time.
It drives the whole capture pipeline for that document type:

```
Capture (scan)  →  Separate  →  Index  →  Validate  →  Output / Export
```

Each setup owns its own custom index fields, auto-populate lookups, and an
**isolated** learning model (learned values are keyed by `jobSetupId` and never
shared across setups).

Configure setups at **`/job-setups`** (admin / claims officer). The editor is
organized into tabs that mirror the pipeline stages.

---

## Editor tabs

| Tab | Configures | Stored on |
|-----|-----------|-----------|
| **General** | Name, document type, colour, active/learning toggles, batch & document **naming patterns** | `JobSetup` |
| **Capture** | DPI, colour mode, duplex, deskew, auto-crop, despeckle, blank-page drop, imprint text | `JobSetup.captureSettings` |
| **Separation** | How a multi-page upload splits into documents | `JobSetup.separationRules` |
| **Index Fields** | The custom fields, their source, validation, mask, default, double-key | `JobSetupField[]` |
| **OCR Zones** | Page regions bound to `ocrZone` fields (drag-to-draw on a sample page) | `JobSetupField.zone` |
| **Output** | Export targets (format, name pattern, subfolder) | `JobSetup.outputTargets` |
| **Assigned Users** | Users and providers allowed to see and use this setup | `JobSetupAssignment[]` |

---

## Index fields

Each field has a `source` that determines how it is populated:

| Source | Behaviour |
|--------|-----------|
| `manual` | Typed by the operator. |
| `extraction` | Filled from the OCR payload via `extractionKey` (e.g. `invoiceNumber`). |
| `lookup` | Resolved from a reference-data source (`lookupSourceId` + `lookupKeyField` → `lookupReturn`). |
| `system` | A runtime value — see system values below. |
| `barcode` | The page barcode captured at upload. |
| `ocrZone` | Read from a page region defined in the **OCR Zones** tab. |

### Validation

Validation is enforced both **client-side** (before submit, with inline errors —
`validateFieldValues` in `frontend/src/services/jobSetupService.ts`) and
**server-side** (`JobSetupService.validateValues`, exposed at
`POST /job-setups/:id/validate`). Rules per field:

- `required`
- `validation.regex` (or legacy `validationRegex`) with an optional `message`
- numeric/date `min` / `max`
- `minLength` / `maxLength`
- `inputMask` — `#` = digit, `A` = letter, `*` = any character, anything else is a
  literal (e.g. `###-##-####`).

`verifyDoubleKey` requires the operator to blind re-key the value to confirm it.

### System values

When `source = system`, `systemValue` is one of:

`date` · `time` · `datetime` · `batchName` · `batchCounter` · `docCounter` ·
`pageCount` · `sequence` · `operator`

Counter values (`batchCounter`, `docCounter`, `sequence`) are previewed during
auto-fill and committed atomically at publish via `JobSetupCounter`.

---

## OCR zones

For `ocrZone` fields, draw a box over a representative page in the **OCR Zones**
tab. Coordinates are stored as page percentages on `JobSetupField.zone`
(`{ page, xPercent, yPercent, widthPercent, heightPercent, searchPhrase? }`). At
extraction time `DocumentClassifierService.extractZones()` reads the regions
(single combined vision call) and writes the values into
`OcrExtraction.customFields`.

---

## Separation

`separationRules.method` selects how a multi-page upload is divided into separate
documents/claims (`DocumentSeparationService`):

| Method | Status |
|--------|--------|
| `none` | No split. |
| `fixedCount` | Every `pagesPerDoc` pages. |
| `blankPage` | A near-empty page separates documents. |
| `ocrPhrase` | A page containing `ocrPhrase` starts a new document. |
| `barcode` / `patchcode` | Reserved — require a per-page scan signal (not yet captured). |

Segments are materialized through the existing fan-out path (split → barcode →
sibling claim → re-OCR). `maxPages` caps any single document's length.

---

## Output / Export

`GET /batch-submissions/:id/export` (accepts a batch id **or** batch number) streams
a zip built from the setup's `outputTargets`:

- `csv` / `xml` / `json` — an index file of every claim's field values.
- `searchablePdf` — a searchable-PDF render of each document.

File names use the target's `namePattern` with tokens `{batchName}`, `{date}`,
`{docCounter}`, and `{field:KEY}`; `subfolderBy` groups output into per-value
folders. When no targets are configured, a single CSV index is produced.

---

## Capture settings

`captureSettings` (deskew, auto-crop, grayscale, despeckle, target DPI) are applied
to **image** uploads before extraction via the ML sidecar
(`ImagePreprocessorService`); they are a no-op for PDFs and when the sidecar is not
configured. Scanner-hardware options (duplex, page size, imprinter) are passed
through to the scan agent where supported.

---

## User assignment

By default every active setup is visible to all authenticated users. To restrict a setup to specific users or providers, open its **Assigned Users** tab and add one or more users via the searchable dropdown. Once at least one user is assigned, only those users (and users with the `admin` or `claims_officer` role) can see the setup.

**API endpoints** (admin / claims_officer only):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/job-setups/:id/assignments` | List assigned users |
| `PUT` | `/api/job-setups/:id/assignments` | Replace the full assignment list — body `{ userIds: string[] }` |

The `list` endpoint (`GET /api/job-setups`) automatically filters results based on the authenticated user's role and their assignment membership. Admin and claims_officer always receive the full list.

---

## Batch upload flow

When an operator starts a batch upload the UI enforces this order:

1. **Batch name** — optional label; a system number is auto-generated at publish if left blank.
2. **Select job setup** — required before files can be browsed or scanned.
3. **Browse / scan** — the dropzone and scanner panel unlock after a setup is chosen.

---

## Data model

`JobSetup`, `JobSetupField`, `JobSetupCounter`, `JobSetupKnowledge`, `JobSetupAssignment` —
see `backend/prisma/schema.prisma`. Migrations:

- `20260530000001_job_setups` — base feature.
- `20260609130000_add_jobsetup_capture_index_fields` — field validation, mask,
  system value, zone, double-key; setup naming; `JobSetupCounter`.
- `20260609131000_add_jobsetup_pipeline_config` — `captureSettings`,
  `separationRules`, `outputTargets`.
- `20260613000000_add_job_setup_assignments` — per-user access control via `job_setup_assignments`.

> Dev-database note: this project uses `prisma db push` for schema synchronisation in
> development. Do **not** use `prisma migrate dev` against an existing dev database
> — it diffs against a shadow schema and will request a destructive reset.
