import api from './api'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'currency' | 'boolean' | 'textarea'
export type FieldSource = 'manual' | 'extraction' | 'lookup'
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
  source: FieldSource
  extractionKey?: string | null
  lookupSourceId?: string | null
  lookupKeyField?: string | null
  lookupReturn?: string | null
  autoPopulate?: boolean
  isKey?: boolean
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
  fields: JobSetupField[]
  _count?: { knowledge: number }
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
  resolve: (id: string, values: Record<string, any>, onlyField?: string) =>
    api.post<ResolveResult>(`/job-setups/${id}/resolve`, { values, onlyField }).then((r) => r.data),
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
