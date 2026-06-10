import api from './api'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'currency' | 'boolean' | 'textarea'
export type FieldSource = 'manual' | 'extraction' | 'lookup' | 'system' | 'barcode' | 'ocrZone'
export type SystemValue =
  | 'date' | 'time' | 'datetime' | 'batchName' | 'batchCounter' | 'docCounter'
  | 'pageCount' | 'sequence' | 'operator'

export const SYSTEM_VALUE_LABELS: Record<SystemValue, string> = {
  date: 'Current date', time: 'Current time', datetime: 'Date + time',
  batchName: 'Batch name', batchCounter: 'Batch counter', docCounter: 'Document counter',
  pageCount: 'Page count', sequence: 'Sequence number', operator: 'Operator name',
}

export interface FieldValidation {
  regex?: string
  message?: string
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
}

/** A rectangular OCR zone bound to a field (percentage coords, 0–100). */
export interface FieldZone {
  page?: number
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  searchPhrase?: string
  engine?: string
}
export type SourceType =
  | 'member_policy'
  | 'provider'
  | 'drug_formulary'
  | 'diagnosis'
  | 'eoxegen_eligibility'
  | 'excel'
  | 'csv'
  | 'rest_api'

export interface JobSetupField {
  id?: string
  key: string
  label: string
  type: FieldType
  required: boolean
  sortOrder?: number
  placeholder?: string | null
  defaultValue?: string | null
  options?: { value: string; label: string }[]
  validationRegex?: string | null
  validation?: FieldValidation | null
  inputMask?: string | null
  source: FieldSource
  extractionKey?: string | null
  systemValue?: SystemValue | null
  zone?: FieldZone | null
  lookupSourceId?: string | null
  lookupKeyField?: string | null
  lookupReturn?: string | null
  autoPopulate?: boolean
  isKey?: boolean
  verifyDoubleKey?: boolean
}

export interface JobSetup {
  id: string
  name: string
  slug: string
  description?: string | null
  documentType?: string | null
  templateId?: string | null
  icon?: string | null
  color?: string | null
  isActive: boolean
  learningEnabled: boolean
  autoPopulateFromHistory: boolean
  sortOrder: number
  naming?: { batchPattern?: string; documentPattern?: string } | null
  captureSettings?: CaptureSettings | null
  separationRules?: SeparationRules | null
  outputTargets?: OutputTarget[] | null
  fields: JobSetupField[]
  _count?: { knowledge: number }
}

export interface CaptureSettings {
  dpi?: number
  colorMode?: 'bw' | 'gray' | 'color'
  duplex?: boolean
  pageSize?: string
  deskew?: boolean
  despeckle?: boolean
  autoCrop?: boolean
  blankPageRemoval?: { enabled?: boolean; threshold?: number }
  borderCrop?: boolean
  holeFill?: boolean
  imprintText?: string
}

export type SeparationMethod =
  | 'none' | 'fixedCount' | 'blankPage' | 'barcode' | 'patchcode' | 'ocrPhrase'

export interface SeparationRules {
  method: SeparationMethod
  pagesPerDoc?: number
  barcodePrefix?: string
  ocrPhrase?: string
  maxPages?: number
}

export type OutputFormat = 'csv' | 'xml' | 'json' | 'searchablePdf'

export interface OutputTarget {
  id: string
  type: OutputFormat
  namePattern?: string
  subfolderBy?: string
  destination?: string
  fields?: string[]
}

export interface FieldError {
  field: string
  label: string
  message: string
}

export interface LookupSource {
  id: string
  name: string
  slug: string
  type: SourceType
  description?: string | null
  isActive: boolean
  config: Record<string, any>
  fileName?: string | null
  keyColumn?: string | null
  columns: { name: string; label: string }[]
  rowCount: number
  lastSyncAt?: string | null
}

export interface ResolveResult {
  values: Record<string, any>
  filled: Record<string, { value: any; via: 'lookup' | 'history'; source?: string }>
  warnings: string[]
}

// ── Built-in lookup source presets ─────────────────────────────────────────────

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  member_policy: 'Member / Policy (DB)',
  provider: 'Provider / Branch (DB)',
  drug_formulary: 'Drug Formulary (DB)',
  diagnosis: 'Diagnosis / Conditions (DB)',
  eoxegen_eligibility: 'eOxegen Eligibility (API)',
  excel: 'Excel upload (.xlsx)',
  csv: 'CSV upload (.csv)',
  rest_api: 'External REST API',
}

/** Columns a built-in DB/API source returns — used to populate the
 *  "return column" dropdown when binding a field to a lookup. */
export const BUILTIN_SOURCE_COLUMNS: Partial<Record<SourceType, string[]>> = {
  member_policy: [
    'memberNumber', 'memberName', 'planCode', 'planName', 'policyStartDate', 'policyEndDate',
    'isActive', 'inpatientLimit', 'outpatientLimit', 'dentalLimit', 'opticalLimit',
    'maternityLimit', 'inpatientBalance', 'outpatientBalance', 'copayPercent',
  ],
  provider: ['providerId', 'providerName', 'type', 'licenseNumber', 'city', 'region', 'canSubmitClaims', 'status'],
  drug_formulary: ['drugCode', 'brandName', 'genericName', 'formularyTier', 'covered', 'genericAlt', 'copayAmount'],
  diagnosis: ['code', 'name'],
  eoxegen_eligibility: ['eligible', 'notes', 'planName', 'memberName'],
}

// ── API helpers ────────────────────────────────────────────────────────────────

export const jobSetupApi = {
  list: (activeOnly = false) =>
    api.get<JobSetup[]>(`/job-setups${activeOnly ? '?active=true' : ''}`).then((r) => r.data),
  get: (id: string) => api.get<JobSetup>(`/job-setups/${id}`).then((r) => r.data),
  create: (body: Partial<JobSetup>) => api.post<JobSetup>('/job-setups', body).then((r) => r.data),
  update: (id: string, body: Partial<JobSetup>) =>
    api.patch<JobSetup>(`/job-setups/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/job-setups/${id}`).then((r) => r.data),
  clone: (id: string) => api.post(`/job-setups/${id}/clone`).then((r) => r.data),
  resolve: (id: string, values: Record<string, any>, onlyField?: string, context?: Record<string, any>) =>
    api.post<ResolveResult>(`/job-setups/${id}/resolve`, { values, onlyField, context }).then((r) => r.data),
  validate: (id: string, values: Record<string, any>) =>
    api.post<{ valid: boolean; errors: FieldError[] }>(`/job-setups/${id}/validate`, { values }).then((r) => r.data),
  learn: (id: string, values: Record<string, any>) =>
    api.post(`/job-setups/${id}/learn`, { values }).then((r) => r.data),
  suggest: (id: string, field: string, prefix = '') =>
    api
      .get<{ value: string; frequency: number }[]>(
        `/job-setups/${id}/suggest?field=${encodeURIComponent(field)}&prefix=${encodeURIComponent(prefix)}`,
      )
      .then((r) => r.data),
  knowledgeStats: (id: string) =>
    api
      .get<{ fieldKey: string; distinctValues: number; totalObservations: number }[]>(
        `/job-setups/${id}/knowledge/stats`,
      )
      .then((r) => r.data),
  resetKnowledge: (id: string) => api.delete(`/job-setups/${id}/knowledge`).then((r) => r.data),
}

export const lookupApi = {
  listSources: (activeOnly = false) =>
    api.get<LookupSource[]>(`/lookups/sources${activeOnly ? '?active=true' : ''}`).then((r) => r.data),
  getSource: (id: string) => api.get<LookupSource>(`/lookups/sources/${id}`).then((r) => r.data),
  createSource: (body: Partial<LookupSource>) =>
    api.post<LookupSource>('/lookups/sources', body).then((r) => r.data),
  updateSource: (id: string, body: Partial<LookupSource>) =>
    api.patch<LookupSource>(`/lookups/sources/${id}`, body).then((r) => r.data),
  deleteSource: (id: string) => api.delete(`/lookups/sources/${id}`).then((r) => r.data),
  uploadFile: (id: string, file: File, keyColumn?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (keyColumn) fd.append('keyColumn', keyColumn)
    return api
      .post(`/lookups/sources/${id}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data)
  },
  preview: (id: string, take = 10) =>
    api.get(`/lookups/sources/${id}/preview?take=${take}`).then((r) => r.data),
  query: (sourceId: string, key: string) =>
    api
      .get(`/lookups/query?sourceId=${encodeURIComponent(sourceId)}&key=${encodeURIComponent(key)}`)
      .then((r) => r.data),
}

// ── Client-side validation (mirrors backend JobSetupService.validateValues) ─────
// Same rules run here (before submit) and on the server (on publish). # = digit,
// A = letter, * = any in a mask; everything else is a literal.
function matchesMask(val: string, mask: string): boolean {
  if (val.length !== mask.length) return false
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i]
    const c = val[i]
    if (m === '#' && !/[0-9]/.test(c)) return false
    if (m === 'A' && !/[A-Za-z]/.test(c)) return false
    if (m === '*') continue
    if (m !== '#' && m !== 'A' && m !== '*' && c !== m) return false
  }
  return true
}

export function validateFieldValues(
  fields: JobSetupField[],
  values: Record<string, any>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === ''
  for (const f of fields) {
    const raw = values?.[f.key]
    const label = f.label || f.key
    if (isEmpty(raw)) {
      if (f.required) errors[f.key] = `${label} is required`
      continue
    }
    const val = String(raw)
    const rules = f.validation ?? {}
    if (f.type === 'number' || f.type === 'currency') {
      const num = Number(val.replace(/[^0-9.\-]/g, ''))
      if (Number.isNaN(num)) { errors[f.key] = `${label} must be a number`; continue }
      if (rules.min != null && num < Number(rules.min)) errors[f.key] = `${label} must be ≥ ${rules.min}`
      else if (rules.max != null && num > Number(rules.max)) errors[f.key] = `${label} must be ≤ ${rules.max}`
    }
    if (f.type === 'date' && Number.isNaN(Date.parse(val))) { errors[f.key] = `${label} is not a valid date`; continue }
    if (rules.minLength != null && val.length < Number(rules.minLength))
      errors[f.key] = `${label} must be at least ${rules.minLength} characters`
    else if (rules.maxLength != null && val.length > Number(rules.maxLength))
      errors[f.key] = `${label} must be at most ${rules.maxLength} characters`
    const pattern = rules.regex ?? f.validationRegex ?? null
    if (pattern && !errors[f.key]) {
      try {
        if (!new RegExp(pattern).test(val)) errors[f.key] = rules.message || `${label} is invalid`
      } catch { /* ignore bad regex */ }
    }
    if (f.inputMask && !errors[f.key] && !matchesMask(val, f.inputMask))
      errors[f.key] = `${label} must match ${f.inputMask}`
  }
  return errors
}
