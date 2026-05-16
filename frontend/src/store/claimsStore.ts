import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ClaimRecord {
  id: string
  barcode: string
  claimNumber: string
  memberNumber: string
  memberName: string
  patientName: string
  patientId?: string
  provider: { name: string }
  invoiceAmount: number
  invoiceNumber?: string
  invoiceDate?: string
  serviceDate?: string
  status: string
  workflowStage: string
  priority: string
  ocrStatus: string
  diagnosis?: string
  diagnosisCode?: string
  procedureCode?: string
  treatment?: string
  notes?: string
  submittedAt: string
  documents: { id?: string; name: string; size: number; type: string; url?: string; documentType?: string; ocrStatus?: string }[]
  aiExtracted?: boolean
  batchId?: string
  batchNumber?: string       // Human-readable: BTH-2026-00001
  uploadedBy?: string        // Email of the user who uploaded
  batchType?: 'single' | 'batch'
  aiConfidence?: number
  fraudSignals?: { level: 'critical' | 'warning'; title: string; detail: string; detectedAt: string }[]
  eligibilityStatus?: string | null
  eligibilityNotes?: string | null
  eligibilityCheckedAt?: string | null
}

// ---- System Barcode Generator ----
// Format: C + YYYYMMDDHHMMSS + sequential counter (resets daily)
// Example: C20260411143201
let _barcodeDate = ''
let _barcodeSeq = 0

export function generateSystemBarcode(): string {
  const now = new Date()
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const timeStr = String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')

  if (dateStr !== _barcodeDate) {
    _barcodeDate = dateStr
    _barcodeSeq = 0
  }
  _barcodeSeq++

  return `C${dateStr}${timeStr}${String(_barcodeSeq).padStart(2, '0')}`
}

// Helper to stamp barcode if not already present
function stampBarcode(claim: ClaimRecord): ClaimRecord {
  if (claim.barcode) return claim
  return { ...claim, barcode: generateSystemBarcode() }
}

// Initial demo data with pre-stamped barcodes
const initialClaims: ClaimRecord[] = [
  { id: '1', barcode: 'C2026041009000001', claimNumber: 'CLM-2026-00142', memberNumber: 'MBR-001234', memberName: 'John Kamau', patientName: 'John Kamau', provider: { name: 'Nairobi Hospital' }, invoiceAmount: 45000, status: 'submitted', workflowStage: 'initial_review', priority: 'normal', ocrStatus: 'completed', submittedAt: '2026-04-10T09:00:00Z', documents: [{ name: 'invoice_kamau.pdf', size: 245000, type: 'application/pdf' }] },
  { id: '2', barcode: 'C2026040914000002', claimNumber: 'CLM-2026-00141', memberNumber: 'MBR-001235', memberName: 'Mary Wanjiku', patientName: 'Mary Wanjiku', provider: { name: 'Aga Khan University Hospital' }, invoiceAmount: 78000, status: 'under_review', workflowStage: 'maker_checker_review', priority: 'high', ocrStatus: 'completed', submittedAt: '2026-04-09T14:00:00Z', documents: [{ name: 'invoice_wanjiku.pdf', size: 180000, type: 'application/pdf' }, { name: 'lab_results.pdf', size: 420000, type: 'application/pdf' }] },
  { id: '3', barcode: 'C2026040908300003', claimNumber: 'CLM-2026-00140', memberNumber: 'MBR-001236', memberName: 'Peter Ochieng', patientName: 'Peter Ochieng', provider: { name: 'MP Shah Hospital' }, invoiceAmount: 23000, status: 'approved', workflowStage: 'completed', priority: 'normal', ocrStatus: 'completed', submittedAt: '2026-04-09T08:30:00Z', documents: [{ name: 'invoice_ochieng.pdf', size: 156000, type: 'application/pdf' }] },
  { id: '4', barcode: 'C2026040816000004', claimNumber: 'CLM-2026-00139', memberNumber: 'MBR-001237', memberName: 'Grace Muthoni', patientName: 'Grace Muthoni', provider: { name: 'Karen Hospital' }, invoiceAmount: 156000, status: 'rejected', workflowStage: 'completed', priority: 'urgent', ocrStatus: 'completed', submittedAt: '2026-04-08T16:00:00Z', documents: [{ name: 'invoice_muthoni.pdf', size: 312000, type: 'application/pdf' }] },
  { id: '5', barcode: 'C2026040811000005', claimNumber: 'CLM-2026-00138', memberNumber: 'MBR-001238', memberName: 'David Kipkoech', patientName: 'David Kipkoech', provider: { name: "Gertrude Children's Hospital" }, invoiceAmount: 34000, status: 'approved', workflowStage: 'completed', priority: 'low', ocrStatus: 'completed', submittedAt: '2026-04-08T11:00:00Z', documents: [] },
  { id: '6', barcode: 'C2026040710000006', claimNumber: 'CLM-2026-00137', memberNumber: 'MBR-001239', memberName: 'Sarah Njeri', patientName: 'Sarah Njeri', provider: { name: 'Kenyatta National Hospital' }, invoiceAmount: 89000, status: 'under_review', workflowStage: 'claims_officer_review', priority: 'high', ocrStatus: 'manual_review', submittedAt: '2026-04-07T10:00:00Z', documents: [{ name: 'invoice.pdf', size: 200000, type: 'application/pdf' }, { name: 'prescription.jpg', size: 890000, type: 'image/jpeg' }] },
  { id: '7', barcode: 'C2026040709000007', claimNumber: 'CLM-2026-00136', memberNumber: 'MBR-001240', memberName: 'James Mwangi', patientName: 'James Mwangi', provider: { name: "Nairobi Women's Hospital" }, invoiceAmount: 67000, status: 'incomplete', workflowStage: 'initial_review', priority: 'normal', ocrStatus: 'failed', submittedAt: '2026-04-07T09:00:00Z', documents: [] },
  { id: '8', barcode: 'C2026040615000008', claimNumber: 'CLM-2026-00135', memberNumber: 'MBR-001241', memberName: 'Lucy Akinyi', patientName: 'Lucy Akinyi', provider: { name: 'Avenue Hospital' }, invoiceAmount: 12000, status: 'paid', workflowStage: 'completed', priority: 'low', ocrStatus: 'completed', submittedAt: '2026-04-06T15:00:00Z', documents: [{ name: 'invoice_akinyi.pdf', size: 134000, type: 'application/pdf' }] },
]

// Map a backend Claim object to the frontend ClaimRecord shape
function mapBackendClaim(c: any): ClaimRecord {
  return {
    id: c.id,
    barcode: c.barcode || generateSystemBarcode(),
    claimNumber: c.claimNumber || '',
    memberNumber: c.memberNumber || '',
    memberName: c.memberName || '',
    patientName: c.patientName || c.memberName || '',
    patientId: c.patientId,
    provider: { name: c.provider?.name || c.providerName || 'Unknown' },
    invoiceAmount: c.invoiceAmount ?? 0,
    invoiceNumber: c.invoiceNumber,
    invoiceDate: c.invoiceDate,
    serviceDate: c.dateOfService || c.serviceDate,
    status: c.status || 'submitted',
    workflowStage: c.workflowStage || 'initial_review',
    priority: c.priority || 'normal',
    ocrStatus: c.ocrStatus || 'pending',
    diagnosis: c.diagnosis,
    diagnosisCode: c.diagnosisCode,
    procedureCode: c.procedureCode,
    treatment: c.treatment,
    notes: c.notes,
    submittedAt: c.submittedAt || c.createdAt,
    documents: (c.documents || []).map((d: any) => ({
      id: d.id,
      name: d.originalName || d.name || '',
      size: d.fileSize || d.size || 0,
      type: d.mimeType || d.mimetype || d.type || 'application/pdf',
      url: d.id ? `/api/documents/${d.id}/preview` : (d.url || ''),
      documentType: d.documentType ?? undefined,
      ocrStatus: d.ocrStatus ?? undefined,
    })),
    aiExtracted: c.aiExtracted ?? false,
    batchId: c.batchId,
    batchNumber: c.batch?.batchNumber || c.batchNumber,
    uploadedBy: c.uploadedBy,
    batchType: (c.batchId || c.batchNumber || c.batch?.batchNumber) ? 'batch' : 'single',
    aiConfidence: c.ocrConfidence,
    fraudSignals: Array.isArray(c.fraudSignals) && c.fraudSignals.length > 0 ? c.fraudSignals : undefined,
    eligibilityStatus: c.eligibilityStatus ?? null,
    eligibilityNotes: c.eligibilityNotes ?? null,
    eligibilityCheckedAt: c.eligibilityCheckedAt ?? null,
  }
}

interface ClaimsState {
  claims: ClaimRecord[]
  serverLoaded: boolean
  addClaim: (claim: Omit<ClaimRecord, 'barcode'> & { barcode?: string }) => void
  addClaims: (claims: (Omit<ClaimRecord, 'barcode'> & { barcode?: string })[]) => void
  updateClaim: (id: string, updates: Partial<ClaimRecord>) => void
  deleteClaim: (id: string) => Promise<void>
  deleteClaims: (ids: string[]) => Promise<void>
  fetchFromServer: () => Promise<void>
}

// Best-effort server delete: swallows errors so local state still updates
// when backend is unavailable (demo mode) but reports any failures in console.
async function deleteOnServer(ids: string[]): Promise<Set<string>> {
  const token = localStorage.getItem('token')
  if (!token) return new Set(ids) // no auth: treat all as local-only
  const deleted = new Set<string>()
  await Promise.all(ids.map(async (id) => {
    // Skip ephemeral/demo IDs that never reached the server (not UUIDs)
    const looksLikeServerId = /^[0-9a-f-]{10,}$/i.test(id)
    if (!looksLikeServerId) { deleted.add(id); return }
    try {
      const res = await fetch(`/api/claims/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok || res.status === 404) deleted.add(id)
      else console.warn(`Failed to delete claim ${id}: HTTP ${res.status}`)
    } catch (err) {
      console.warn(`Network error deleting claim ${id}`, err)
    }
  }))
  return deleted
}

function dedupById(list: ClaimRecord[]): ClaimRecord[] {
  const seen = new Set<string>()
  return list.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
}

export const useClaimsStore = create<ClaimsState>()(
  persist(
    (set, get) => ({
      claims: dedupById(initialClaims),
      serverLoaded: false,

      addClaim: (claim) => set((state) => {
        const stamped = stampBarcode(claim as ClaimRecord)
        return { claims: [stamped, ...state.claims.filter(c => c.id !== stamped.id)] }
      }),

      addClaims: (newClaims) => set((state) => {
        const stamped = newClaims.map(c => stampBarcode(c as ClaimRecord))
        const newIds = new Set(stamped.map(c => c.id))
        return { claims: [...stamped, ...state.claims.filter(c => !newIds.has(c.id))] }
      }),

      updateClaim: (id, updates) => set((state) => ({
        claims: state.claims.map((c) => c.id === id ? { ...c, ...updates } : c),
      })),

      deleteClaim: (id) => deleteOnServer([id]).then(deleted =>
        set((state) => ({ claims: state.claims.filter((c) => !deleted.has(c.id)) }))
      ),

      deleteClaims: (ids) => deleteOnServer(ids).then(deleted =>
        set((state) => ({ claims: state.claims.filter((c) => !deleted.has(c.id)) }))
      ),

      fetchFromServer: async () => {
        const token = localStorage.getItem('token')
        if (!token) return
        try {
          const res = await fetch('/api/claims?limit=500', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json()
            const list: any[] = Array.isArray(data) ? data : Array.isArray(data.claims) ? data.claims : []
            // Replace unconditionally on a successful fetch — an empty response is
            // a legitimate "no claims for this user," not a failure. Preserving the
            // prior cache would leak another user's claims after a session switch.
            set({ claims: list.map(mapBackendClaim), serverLoaded: true })
          }
        } catch { /* keep local */ }
      },
    }),
    {
      name: 'cic-claims-storage',
      partialize: (state) => ({ claims: state.claims, serverLoaded: state.serverLoaded }),
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted as object),
        claims: dedupById((persisted as any)?.claims ?? current.claims),
      }),
    }
  )
)
