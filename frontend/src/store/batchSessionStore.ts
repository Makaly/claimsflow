import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SessionStep = 'upload' | 'ai_extracting' | 'manual_processing' | 'review' | 'publishing' | 'complete'

export interface SessionClaim {
  id: string
  barcode: string
  fileName: string
  fileSize: number
  fileUrl: string        // may be stale blob after page reload — handled in UI
  fileType: string
  claimNumber: string
  patientName: string
  patientId: string
  memberNumber: string
  providerName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  serviceDate: string
  diagnosis: string
  diagnosisCode: string
  procedureCode: string
  treatment: string
  aiConfidence: number
  aiVerified: boolean
  status: 'extracting' | 'extracted' | 'verified' | 'published' | 'error'
  splitFrom?: string
  invoiceIndex?: number
  totalInvoicesInPdf?: number
  pageRange?: string
  documentPages?: Array<{ pageNumber: number; category: string; categoryLabel: string; confidence: number; summary: string }>
}

// ── Lightweight metadata stored in localStorage (no claims array) ──
interface BatchSessionMeta {
  sessionId: string
  step: SessionStep
  provider: string
  totalFiles: number
  extractedCount: number
  publishProgress: number
  batchNumber: string
  startedAt: string
  updatedAt: string
}

// ── Claims stored in localStorage with 48-hour TTL ──
// Previously used sessionStorage (lost on tab close). Switched to localStorage
// so manual OCR corrections survive browser close/reopen within the same day.
const CLAIMS_KEY = (sid: string) => `cic-claims-${sid}`
const CLAIMS_TTL_MS = 48 * 60 * 60 * 1000  // 48 hours

export function saveClaims(sessionId: string, claims: SessionClaim[]) {
  try {
    const slim = claims.map(({ fileUrl: _, documentPages: __, ...rest }) =>
      ({ ...rest, fileUrl: '' })
    )
    localStorage.setItem(CLAIMS_KEY(sessionId), JSON.stringify({ data: slim, savedAt: Date.now() }))
  } catch { /* quota — non-fatal */ }
}

export function loadClaims(sessionId: string): SessionClaim[] {
  try {
    const raw = localStorage.getItem(CLAIMS_KEY(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Support legacy sessionStorage shape (plain array) and new TTL-wrapped shape
    if (Array.isArray(parsed)) return parsed as SessionClaim[]
    if (Date.now() - parsed.savedAt > CLAIMS_TTL_MS) {
      localStorage.removeItem(CLAIMS_KEY(sessionId))
      return []
    }
    return parsed.data as SessionClaim[]
  } catch { return [] }
}

export function dropClaims(sessionId: string) {
  try {
    localStorage.removeItem(CLAIMS_KEY(sessionId))
    sessionStorage.removeItem(CLAIMS_KEY(sessionId))  // clear legacy entry if present
  } catch { /* ignore */ }
}

// ── Store interface ──
interface BatchSessionStore {
  session: BatchSessionMeta | null
  upsertSession: (patch: Partial<BatchSessionMeta>) => void
  clearSession: () => void
}

// One-time cleanup: evict any previously-oversized localStorage entry
try {
  const raw = localStorage.getItem('cic-batch-session')
  if (raw && raw.length > 100_000) localStorage.removeItem('cic-batch-session')
} catch { /* ignore */ }

export const useBatchSessionStore = create<BatchSessionStore>()(
  persist(
    (set, get) => ({
      session: null,

      upsertSession: (patch) => {
        const now = new Date().toISOString()
        const existing = get().session
        if (existing) {
          set({ session: { ...existing, ...patch, updatedAt: now } })
        } else {
          set({
            session: {
              sessionId: `ses-${Date.now()}`,
              step: 'upload',
              provider: '',
              totalFiles: 0,
              extractedCount: 0,
              publishProgress: 0,
              batchNumber: '',
              startedAt: now,
              updatedAt: now,
              ...patch,
            },
          })
        }
      },

      clearSession: () => {
        const sid = get().session?.sessionId
        if (sid) dropClaims(sid)
        set({ session: null })
      },
    }),
    { name: 'cic-batch-session' },
  ),
)
