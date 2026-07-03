import { useState, useEffect } from 'react'
import {
  Briefcase, Search, Loader2, FileText, DollarSign, Clock,
  CheckCircle, XCircle, RotateCcw, Send, AlertOctagon,
  AlertTriangle, Plus, Trash2, MessageSquare, X,
  ChevronRight, Building2, User, Calendar, Hash, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination } from '@/components/Pagination'
import BulkActionsBar from '@/components/BulkActionsBar'
import { InlinePdfViewer, type OcrAnnotation } from '@/components/InlinePdfViewer'
import { formatCurrency, formatDate, getPriorityColor } from '@/lib/utils'
import api from '@/services/api'

function claimNumSubseq(claimNumber: string, query: string): boolean {
  const hay = claimNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
  const ndl = query.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!ndl) return true
  if (hay.includes(ndl)) return true
  let hi = 0
  for (let ni = 0; ni < ndl.length; ni++) {
    while (hi < hay.length && hay[hi] !== ndl[ni]) hi++
    if (hi >= hay.length) return false
    hi++
  }
  return true
}

type ActionType = 'approve' | 'reject' | 'return_maker_checker' | 'return_provider' | 'escalate_fraud' | null

interface FraudSignal { level: 'critical' | 'warning' | 'info'; title: string; detail: string }
interface OfficerDoc  { id?: string; name: string; documentType?: string; mimetype?: string }

interface OfficerClaim {
  id: string
  claimNumber: string
  memberName: string
  memberNumber?: string
  provider?: { name: string }
  invoiceAmount: number
  priority: string
  fraudSignals: FraudSignal[]
  fraudVerdict?: string | null
  makerCheckerApprovedBy?: string
  makerCheckerApprovedAt?: string
  makerCheckerComments?: string
  assignedToName?: string
  documents: OfficerDoc[]
  submittedAt: string
}

const MISSING_DOC_OPTIONS = [
  'Discharge Summary', 'Lab Results', 'X-Ray/Scan Report', "Doctor's Report",
  'Pre-Authorization Letter', 'Original Invoice', 'Prescription', 'Referral Letter',
  'Member ID Card Copy', 'Inpatient Records', 'Outpatient Records', 'Post-Op Report',
]

const ACTION_CONFIG = {
  approve: {
    label: 'Approve → Payment',
    shortLabel: 'Approve',
    icon: CheckCircle,
    activeClass: 'ring-2 ring-emerald-500 bg-emerald-600 text-white',
    idleClass: 'border border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10',
    btnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    notesLabel: 'Approval notes', required: false,
    notesPlaceholder: 'Final approval notes — saved to the audit trail and emailed to the provider…',
    notesHint: 'Triggers PDF watermarking, EDMS archiving, and payment settlement. Provider notified by email.',
  },
  return_maker_checker: {
    label: 'Return to Maker-Checker',
    shortLabel: 'Return',
    icon: RotateCcw,
    activeClass: 'ring-2 ring-sky-500 bg-sky-600 text-white',
    idleClass: 'border border-sky-600/40 text-sky-400 hover:bg-sky-600/10',
    btnClass: 'bg-sky-600 hover:bg-sky-700 text-white',
    notesLabel: 'Return reason', required: true,
    notesPlaceholder: 'Explain what the maker-checker team needs to re-verify or correct…',
    notesHint: 'The maker-checker team will be notified. Invoice moves back to their queue.',
  },
  return_provider: {
    label: 'Return to Provider',
    shortLabel: 'To Provider',
    icon: Send,
    activeClass: 'ring-2 ring-amber-500 bg-amber-600 text-white',
    idleClass: 'border border-amber-600/40 text-amber-400 hover:bg-amber-600/10',
    btnClass: 'bg-amber-600 hover:bg-amber-700 text-white',
    notesLabel: 'Message to provider', required: true,
    notesPlaceholder: 'Explain what must be corrected or supplied before resubmission…',
    notesHint: 'Emailed directly to the provider. Invoice returns to initial review.',
  },
  reject: {
    label: 'Reject Invoice',
    shortLabel: 'Reject',
    icon: XCircle,
    activeClass: 'ring-2 ring-red-500 bg-red-600 text-white',
    idleClass: 'border border-red-600/40 text-red-400 hover:bg-red-600/10',
    btnClass: 'bg-red-600 hover:bg-red-700 text-white',
    notesLabel: 'Rejection reason', required: true,
    notesPlaceholder: 'Provide a clear, factual rejection reason. The provider will see this…',
    notesHint: 'The provider, maker-checker, and you will receive an email. Permanently recorded.',
  },
  escalate_fraud: {
    label: 'Escalate to Fraud',
    shortLabel: 'Escalate',
    icon: AlertOctagon,
    activeClass: 'ring-2 ring-rose-700 bg-rose-800 text-white',
    idleClass: 'border border-rose-700/40 text-rose-400 hover:bg-rose-800/10',
    btnClass: 'bg-rose-800 hover:bg-rose-900 text-white',
    notesLabel: 'Fraud escalation reason', required: true,
    notesPlaceholder: 'Describe the fraud indicators. The fraud officer will receive this with the claim…',
    notesHint: 'Fraud team notified immediately. Invoice placed on fraud hold.',
  },
} as const

const SIGNAL_STYLE = {
  critical: { bg: 'bg-red-950/30 border-red-700', text: 'text-red-300', label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-950/30 border-amber-700', text: 'text-amber-300', label: 'WARNING' },
  info:     { bg: 'bg-brand-950/30 border-brand-700', text: 'text-brand-300', label: 'INFO' },
}

export default function ClaimsOfficerQueue() {
  const [claims, setClaims] = useState<OfficerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState<OfficerClaim | null>(null)
  const [actionType, setActionType] = useState<ActionType>(null)
  const [comments, setComments] = useState('')
  const [missingDocs, setMissingDocs] = useState<string[]>([])
  const [customDoc, setCustomDoc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [activeDocIdx, setActiveDocIdx] = useState(0)
  const [ocrFields, setOcrFields] = useState<OcrAnnotation[]>([])
  // 'mine' = claims assigned to me; 'all' = full team pool (claims assigned to
  // any claims officer at this stage). Lets an officer pick up a colleague's work.
  const [scope, setScope] = useState<'mine' | 'all'>('mine')

  const loadClaims = async () => {
    try {
      const { data } = await api.get(`/workflow/claims/claims_officer_review${scope === 'all' ? '?scope=all' : ''}`)
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []
      const enriched = await Promise.all(list.map(async (c: any) => {
        let makerCheckerApprovedBy: string | undefined
        let makerCheckerApprovedAt: string | undefined
        let makerCheckerComments: string | undefined
        try {
          const { data: approvals } = await api.get(`/workflow/approval-history/${c.id}`)
          const arr: any[] = Array.isArray(approvals) ? approvals : []
          const last = [...arr].reverse().find(a => a.level === 'maker_checker' && a.decision === 'approved')
          if (last) {
            makerCheckerApprovedBy = last.approver?.name || last.approver?.email
            makerCheckerApprovedAt = last.createdAt
            makerCheckerComments   = last.comments || undefined
          }
        } catch { /* optional */ }
        return {
          id: c.id,
          claimNumber: c.claimNumber,
          memberName: c.memberName || c.patientName || '—',
          memberNumber: c.memberNumber,
          provider: c.provider ? { name: c.provider.name } : undefined,
          invoiceAmount: c.invoiceAmount || 0,
          priority: c.priority || 'normal',
          fraudSignals: Array.isArray(c.fraudSignals) ? c.fraudSignals : [],
          fraudVerdict: c.fraudVerdict ?? null,
          makerCheckerApprovedBy, makerCheckerApprovedAt, makerCheckerComments,
          assignedToName: c.assignedUser?.name || c.assignedUser?.email || undefined,
          documents: (c.documents || []).map((d: any) => ({
            id: d.id, name: d.originalName || d.filename || '', documentType: d.documentType, mimetype: d.mimetype,
          })),
          submittedAt: c.submittedAt,
        }
      }))
      setClaims(enriched)
    } catch { /* keep existing */ }
    finally { setLoading(false) }
  }

  useEffect(() => { setLoading(true); loadClaims() }, [scope])

  useEffect(() => {
    if (!selectedClaim) return
    const doc = selectedClaim.documents[activeDocIdx]
    if (!doc?.id) { setDocBytes(null); return }
    let cancelled = false
    setDocLoading(true); setDocBytes(null)
    ;(async () => {
      try {
        const res = await api.get(`/documents/${doc.id}/preview`, { responseType: 'arraybuffer' })
        if (!cancelled) setDocBytes(new Uint8Array(res.data))
      } catch { if (!cancelled) setDocBytes(null) }
      finally { if (!cancelled) setDocLoading(false) }
    })()
    return () => { cancelled = true }
  }, [selectedClaim, activeDocIdx])

  useEffect(() => {
    if (!selectedClaim) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get(`/claims/${selectedClaim.id}/ocr-fields`)
        if (!cancelled) setOcrFields(data?.fields ?? [])
      } catch { if (!cancelled) setOcrFields([]) }
    })()
    return () => { cancelled = true }
  }, [selectedClaim?.id])

  const openClaim = (claim: OfficerClaim) => {
    setSelectedClaim(claim); setActiveDocIdx(0); setActionType(null)
    setComments(''); setMissingDocs([]); setCustomDoc(''); setActionError(null)
    setOcrFields([]); setDocBytes(null); setOpen(true)
  }

  const closeClaim = () => {
    setOpen(false); setSelectedClaim(null); setActionType(null)
    setComments(''); setMissingDocs([]); setDocBytes(null); setOcrFields([]); setActionError(null)
  }

  const selectAction = (type: ActionType) => {
    setActionType(prev => prev === type ? null : type)
    setComments(''); setMissingDocs([]); setActionError(null)
  }

  const toggleMissingDoc = (doc: string) =>
    setMissingDocs(prev => prev.includes(doc) ? prev.filter(d => d !== doc) : [...prev, doc])

  const addCustomDoc = () => {
    if (customDoc.trim() && !missingDocs.includes(customDoc.trim())) {
      setMissingDocs(prev => [...prev, customDoc.trim()]); setCustomDoc('')
    }
  }

  const handleSubmit = async () => {
    if (!selectedClaim || !actionType) return
    setSubmitting(true); setActionError(null)
    try {
      const endpoints: Record<string, string> = {
        approve:              '/workflow/claims-officer/approve',
        reject:               '/workflow/claims-officer/reject',
        return_maker_checker: '/workflow/claims-officer/return-to-maker-checker',
        return_provider:      '/workflow/claims-officer/return-to-provider',
        escalate_fraud:       '/workflow/claims-officer/escalate-to-fraud',
      }
      const bodies: Record<string, object> = {
        approve:              { claimId: selectedClaim.id, comments },
        reject:               { claimId: selectedClaim.id, reason: comments },
        return_maker_checker: { claimId: selectedClaim.id, reason: comments },
        return_provider:      { claimId: selectedClaim.id, reason: comments, missingDocuments: missingDocs },
        escalate_fraud:       { claimId: selectedClaim.id, reason: comments },
      }
      await api.post(endpoints[actionType], bodies[actionType])
      setClaims(prev => prev.filter(c => c.id !== selectedClaim.id))
      closeClaim()
    } catch (err: any) {
      const d = err?.response?.data
      setActionError(
        err?.response?.status === 403
          ? `Not authorised: ${d?.message || err?.message}`
          : d?.message || d?.error || err?.message || 'Network error — please try again',
      )
    } finally { setSubmitting(false) }
  }

  const filtered = claims.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return claimNumSubseq(c.claimNumber, search) ||
      c.memberName.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q)
  })

  const stats = {
    total:      claims.length,
    highValue:  claims.filter(c => c.invoiceAmount > 100000).length,
    urgent:     claims.filter(c => c.priority === 'urgent').length,
    totalValue: claims.reduce((s, c) => s + c.invoiceAmount, 0),
  }

  const cfg      = actionType ? ACTION_CONFIG[actionType] : null
  const canSubmit = actionType && (!ACTION_CONFIG[actionType].required || comments.trim().length > 0) && !submitting
  const activeDoc = selectedClaim?.documents[activeDocIdx]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Claims Officer Queue</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Final approval, rejection, or escalation for verified invoices
          </p>
        </div>
        <Badge variant="outline" className="text-base px-4 py-2 gap-2">
          <Briefcase className="h-4 w-4" /> {stats.total} Pending
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { icon: FileText,   color: 'text-brand-500',    label: 'Awaiting Decision', value: stats.total },
          { icon: DollarSign, color: 'text-amber-500',   label: 'High Value (>100K)', value: stats.highValue },
          { icon: Clock,      color: 'text-red-500',     label: 'Urgent',             value: stats.urgent },
          { icon: DollarSign, color: 'text-emerald-500', label: 'Total Value',        value: formatCurrency(stats.totalValue) },
        ].map(({ icon: Icon, color, label, value }) => (
          <Card key={label}><CardContent className="p-4 flex items-center gap-3">
            <Icon className={`h-8 w-8 opacity-70 ${color}`} />
            <div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search invoices, members, providers…" value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            {/* Scope toggle: my queue vs the whole claims-officer pool */}
            <div className="inline-flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs font-medium shrink-0">
              <button
                onClick={() => setScope('mine')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  scope === 'mine' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                Assigned to me
              </button>
              <button
                onClick={() => setScope('all')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  scope === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                All officers
              </button>
            </div>
          </div>

          {bulkSelected.size > 0 && (
            <div className="mb-3">
              <BulkActionsBar selectedIds={Array.from(bulkSelected)} onClear={() => setBulkSelected(new Set())}
                onDone={() => { setBulkSelected(new Set()); loadClaims() }} queueType="claims_officer" />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading queue…
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={filtered.length > 0 && filtered.every(c => bulkSelected.has(c.id))}
                        onCheckedChange={checked => {
                          if (checked) setBulkSelected(new Set(filtered.map(c => c.id)))
                          else setBulkSelected(new Set())
                        }}
                      />
                    </TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Verified by</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="w-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No invoices awaiting your decision
                      </TableCell>
                    </TableRow>
                  ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(claim => (
                    <TableRow key={claim.id}
                      className={`cursor-pointer transition-colors ${bulkSelected.has(claim.id) ? 'bg-brand-50/10' : 'hover:bg-muted/40'}`}
                      onClick={() => openClaim(claim)}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox checked={bulkSelected.has(claim.id)}
                          onCheckedChange={checked => {
                            setBulkSelected(prev => { const n = new Set(prev); if (checked) n.add(claim.id); else n.delete(claim.id); return n })
                          }} />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">{claim.claimNumber}</TableCell>
                      <TableCell>
                        <p className="font-medium leading-tight">{claim.memberName}</p>
                        {claim.memberNumber && <p className="text-[10px] text-muted-foreground mt-0.5">{claim.memberNumber}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{claim.provider?.name || '—'}</TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold tabular-nums">{formatCurrency(claim.invoiceAmount)}</p>
                        {claim.invoiceAmount > 100000 && <p className="text-[10px] text-amber-500 text-right">High value</p>}
                      </TableCell>
                      <TableCell>
                        <Badge className={getPriorityColor(claim.priority)} variant="secondary">{claim.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        {claim.makerCheckerApprovedBy
                          ? <p className="text-xs font-medium">{claim.makerCheckerApprovedBy}</p>
                          : <span className="text-[10px] text-muted-foreground">—</span>}
                        {scope === 'all' && claim.assignedToName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">→ {claim.assignedToName}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(claim.submittedAt)}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={filtered.length}
                onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Invoice Decision Panel ── */}
      <Dialog open={open} onOpenChange={() => closeClaim()}>
        <DialogContent hideClose className="max-w-[min(1500px,98vw)] w-[min(1500px,98vw)] h-[96vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl">
          {selectedClaim && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b bg-gradient-to-r from-background to-muted/30 shrink-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="font-mono text-base font-black tracking-tight text-primary shrink-0">{selectedClaim.claimNumber}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary">{selectedClaim.priority}</Badge>
                    {selectedClaim.invoiceAmount > 100000 && (
                      <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px] font-semibold">High value</Badge>
                    )}
                    {selectedClaim.fraudVerdict === 'cleared' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                        Fraud cleared
                      </span>
                    )}
                    {selectedClaim.fraudSignals.filter(s => s.level === 'critical').length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-400">
                        <ShieldAlert className="h-3 w-3" />{selectedClaim.fraudSignals.filter(s => s.level === 'critical').length} Critical
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm hidden lg:block truncate">
                    {selectedClaim.memberName}{selectedClaim.memberNumber ? ` · ${selectedClaim.memberNumber}` : ''} · {selectedClaim.provider?.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <span className="font-bold text-base text-emerald-500 tabular-nums">{formatCurrency(selectedClaim.invoiceAmount)}</span>
                  <button onClick={closeClaim} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px] overflow-hidden">

                {/* LEFT — Document viewer */}
                <div className="min-h-0 flex flex-col bg-[#111] border-r border-white/10">
                  {selectedClaim.documents.length > 1 && (
                    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/8 bg-[#0a0a0a] shrink-0 overflow-x-auto">
                      {selectedClaim.documents.map((doc, i) => (
                        <button key={doc.id || i} onClick={() => setActiveDocIdx(i)}
                          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-all ${
                            i === activeDocIdx ? 'bg-white/12 text-white border border-white/15' : 'text-white/40 hover:bg-white/6 hover:text-white/70'
                          }`}>
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="max-w-[200px] truncate">{doc.name}</span>
                          {doc.documentType && <span className="text-[9px] px-1 py-0.5 rounded bg-white/8 text-white/50">{doc.documentType.replace(/_/g, ' ')}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex-1 min-h-0">
                    {selectedClaim.documents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30"><FileText className="h-14 w-14" /><p className="text-sm font-medium">No documents attached</p></div>
                    ) : docLoading ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40"><Loader2 className="h-6 w-6 animate-spin" /><p className="text-sm">Loading {activeDoc?.name}…</p></div>
                    ) : docBytes ? (
                      <InlinePdfViewer key={`${selectedClaim.id}-${activeDocIdx}`} bytes={docBytes} url={null} claimId={selectedClaim.id} annotations={ocrFields} fraudSignalCount={selectedClaim.fraudSignals.length} />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30"><AlertTriangle className="h-10 w-10" /><p className="text-sm font-medium">Could not load preview</p></div>
                    )}
                  </div>
                </div>

                {/* RIGHT — Details + decision actions */}
                <div className="min-h-0 overflow-y-auto flex flex-col bg-background">

                  {/* Metadata */}
                  <div className="px-4 pt-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-3 border-b">
                    {[
                      { icon: Hash,       label: 'Invoice #', value: selectedClaim.claimNumber, className: 'font-mono text-xs font-semibold text-primary' },
                      { icon: DollarSign, label: 'Amount',    value: formatCurrency(selectedClaim.invoiceAmount), className: 'font-bold text-emerald-500' },
                      { icon: User,       label: 'Member',    value: selectedClaim.memberName, className: 'text-sm font-medium' },
                      { icon: Building2,  label: 'Provider',  value: selectedClaim.provider?.name || '—', className: 'text-sm' },
                      { icon: Calendar,   label: 'Submitted', value: formatDate(selectedClaim.submittedAt), className: 'text-sm text-muted-foreground' },
                      { icon: FileText,   label: 'Documents', value: `${selectedClaim.documents.length} attached`, className: 'text-sm text-muted-foreground' },
                    ].map(({ icon: Icon, label, value, className }) => (
                      <div key={label}>
                        <div className="flex items-center gap-1.5 mb-0.5"><Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" /><span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">{label}</span></div>
                        <p className={`leading-snug truncate ${className}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex-1 px-4 py-3 space-y-3">

                    {/* Fraud cleared notice */}
                    {selectedClaim.fraudVerdict === 'cleared' && (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                        Fraud investigation completed — verdict: <strong>cleared</strong>. Invoice re-routed here for final approval.
                      </div>
                    )}

                    {/* Fraud signals */}
                    {selectedClaim.fraudSignals.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase px-1">
                            {selectedClaim.fraudSignals.length} Warning Signal{selectedClaim.fraudSignals.length !== 1 ? 's' : ''}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                        <div className="space-y-2">
                          {selectedClaim.fraudSignals.map((sig, i) => {
                            const s = SIGNAL_STYLE[sig.level]
                            return (
                              <div key={i} className={`rounded-lg border p-3 ${s.bg}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 ${
                                    sig.level === 'critical' ? 'bg-red-500/30 text-red-300' : sig.level === 'warning' ? 'bg-amber-500/30 text-amber-300' : 'bg-brand-500/30 text-brand-300'
                                  }`}><AlertTriangle className="h-2.5 w-2.5" />{s.label}</span>
                                  <span className={`text-xs font-semibold ${s.text}`}>{sig.title}</span>
                                </div>
                                <p className={`text-[11px] leading-relaxed ${s.text} opacity-75`}>{sig.detail}</p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Maker-checker notes */}
                    {selectedClaim.makerCheckerComments && (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                          Maker-Checker Notes{selectedClaim.makerCheckerApprovedBy ? ` — ${selectedClaim.makerCheckerApprovedBy}` : ''}
                          {selectedClaim.makerCheckerApprovedAt ? ` · ${formatDate(selectedClaim.makerCheckerApprovedAt)}` : ''}
                        </p>
                        <p className="text-sm leading-relaxed">{selectedClaim.makerCheckerComments}</p>
                      </div>
                    )}

                    {/* Action form */}
                    {actionType && cfg && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-150">
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase px-1">{cfg.notesLabel}</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>

                        {actionType === 'return_provider' && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto rounded-lg border bg-muted/10 p-1.5">
                              {MISSING_DOC_OPTIONS.map(doc => (
                                <button key={doc} onClick={() => toggleMissingDoc(doc)}
                                  className={`text-left text-[10px] rounded-md px-2 py-1.5 transition-all ${
                                    missingDocs.includes(doc) ? 'bg-amber-500/25 text-amber-300 font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                                  }`}>
                                  {missingDocs.includes(doc) ? '✓ ' : ''}{doc}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-1.5">
                              <input className="flex h-7 w-full rounded-md border border-input bg-background px-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex-1"
                                placeholder="Other document…" value={customDoc}
                                onChange={e => setCustomDoc(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addCustomDoc()} />
                              <Button size="sm" variant="outline" onClick={addCustomDoc} disabled={!customDoc.trim()} className="h-7 px-2">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            {missingDocs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {missingDocs.map(d => (
                                  <Badge key={d} variant="secondary" className="gap-1 text-[9px] pr-1">
                                    {d}<button onClick={() => setMissingDocs(prev => prev.filter(x => x !== d))}><Trash2 className="h-2.5 w-2.5" /></button>
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <Textarea placeholder={cfg.notesPlaceholder} value={comments}
                          onChange={e => setComments(e.target.value.slice(0, 2000))}
                          rows={4} className="resize-none text-xs" />
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground flex-1">
                            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />{cfg.notesHint}
                          </p>
                          <span className={`text-[10px] tabular-nums shrink-0 ${comments.length > 1800 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {comments.length}/2000
                          </span>
                        </div>

                        {actionError && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 px-3 py-2 text-xs">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{actionError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Action bar ── */}
                  <div className="shrink-0 border-t bg-muted/20 p-3 space-y-2">
                    <div className="grid grid-cols-5 gap-1.5">
                      {(Object.keys(ACTION_CONFIG) as (keyof typeof ACTION_CONFIG)[]).map(type => {
                        const { shortLabel, icon: Icon, activeClass, idleClass } = ACTION_CONFIG[type]
                        const isActive = actionType === type
                        return (
                          <button key={type} onClick={() => selectAction(type)}
                            className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 px-1 text-center transition-all text-[10px] leading-tight font-semibold ${isActive ? activeClass : idleClass}`}>
                            <Icon style={{ width: '1.125rem', height: '1.125rem' }} />
                            <span className="leading-none">{shortLabel}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex gap-2">
                      {actionType ? (
                        <>
                          <Button variant="ghost" size="sm" className="flex-none text-muted-foreground" onClick={() => selectAction(null)}>Cancel</Button>
                          <Button size="sm" className={`flex-1 font-semibold ${cfg?.btnClass ?? ''}`} onClick={handleSubmit} disabled={!canSubmit}>
                            {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            {cfg && !submitting && <cfg.icon className="mr-2 h-3.5 w-3.5" />}
                            {actionType === 'approve'              && 'Approve → Payment'}
                            {actionType === 'reject'               && 'Reject Invoice'}
                            {actionType === 'return_maker_checker' && 'Return to Maker-Checker'}
                            {actionType === 'return_provider'      && `Return to Provider${missingDocs.length > 0 ? ` (${missingDocs.length})` : ''}`}
                            {actionType === 'escalate_fraud'       && 'Escalate to Fraud Team'}
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full font-medium" onClick={closeClaim}>
                          <X className="mr-2 h-3.5 w-3.5" /> Close
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
