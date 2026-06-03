import { useState, useEffect } from 'react'
import {
  UserCog, Search, Loader2, FileText, DollarSign, Clock,
  CheckCircle, XCircle, RotateCcw, Send, AlertOctagon,
  MessageSquare, Mail, AlertTriangle, Plus, Trash2, X,
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
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Pagination } from '@/components/Pagination'
import BulkActionsBar from '@/components/BulkActionsBar'
import { Checkbox } from '@/components/ui/checkbox'
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

type ActionType = 'approve' | 'reject' | 'return_maker' | 'return_provider' | 'escalate_fraud' | null

interface FraudSignal { level: 'critical' | 'warning' | 'info'; title: string; detail: string }
interface CheckerDoc  { id?: string; name: string; documentType?: string; mimetype?: string }

interface CheckerClaim {
  id: string
  claimNumber: string
  memberName: string
  memberNumber?: string
  provider?: { name: string }
  invoiceAmount: number
  priority: string
  fraudSignals: FraudSignal[]
  ocrConfidence?: number
  makerApprovedBy?: string
  makerApprovedAt?: string
  makerComments?: string
  documents: CheckerDoc[]
  submittedAt: string
}

const MISSING_DOC_OPTIONS = [
  'Discharge Summary', 'Lab Results', 'X-Ray/Scan Report', "Doctor's Report",
  'Pre-Authorization Letter', 'Original Invoice', 'Prescription', 'Referral Letter',
  'Member ID Card Copy', 'Inpatient Records', 'Outpatient Records', 'Post-Op Report',
]

const ACTION_CONFIG = {
  approve: {
    label: 'Approve → Claims Officer',
    shortLabel: 'Approve',
    icon: CheckCircle,
    activeClass: 'ring-2 ring-emerald-500 bg-emerald-600 text-white',
    idleClass: 'border border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10',
    btnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    notesLabel: 'Verification notes', required: false,
    notesPlaceholder: 'QA notes — confirmed amounts, merged documents, checks performed…',
    notesHint: 'Routes to the Claims Officer queue. Notes saved to audit trail.',
  },
  return_maker: {
    label: 'Return for Revision',
    shortLabel: 'Return',
    icon: RotateCcw,
    activeClass: 'ring-2 ring-sky-500 bg-sky-600 text-white',
    idleClass: 'border border-sky-600/40 text-sky-400 hover:bg-sky-600/10',
    btnClass: 'bg-sky-600 hover:bg-sky-700 text-white',
    notesLabel: 'Revision reason', required: true,
    notesPlaceholder: 'Explain what needs to be re-checked or corrected…',
    notesHint: 'Invoice stays in the queue. Assignee is notified.',
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
    label: 'Reject Claim',
    shortLabel: 'Reject',
    icon: XCircle,
    activeClass: 'ring-2 ring-red-500 bg-red-600 text-white',
    idleClass: 'border border-red-600/40 text-red-400 hover:bg-red-600/10',
    btnClass: 'bg-red-600 hover:bg-red-700 text-white',
    notesLabel: 'Rejection reason', required: true,
    notesPlaceholder: 'Provide a clear, factual rejection reason. The provider will see this…',
    notesHint: 'Provider and you will receive an email. Permanently recorded.',
  },
  escalate_fraud: {
    label: 'Escalate to Fraud',
    shortLabel: 'Escalate',
    icon: AlertOctagon,
    activeClass: 'ring-2 ring-rose-700 bg-rose-800 text-white',
    idleClass: 'border border-rose-700/40 text-rose-400 hover:bg-rose-800/10',
    btnClass: 'bg-rose-800 hover:bg-rose-900 text-white',
    notesLabel: 'Escalation reason', required: true,
    notesPlaceholder: 'Describe the fraud indicators that prompted this escalation…',
    notesHint: 'Fraud team notified immediately. Invoice placed on hold.',
  },
} as const

const SIGNAL_STYLE = {
  critical: { bg: 'bg-red-950/30 border-red-700', text: 'text-red-300', dot: 'bg-red-500', label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-950/30 border-amber-700', text: 'text-amber-300', dot: 'bg-amber-500', label: 'WARNING' },
  info:     { bg: 'bg-blue-950/30 border-blue-700', text: 'text-blue-300', dot: 'bg-blue-400', label: 'INFO' },
}

export default function CheckerQueue() {
  const [claims, setClaims] = useState<CheckerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState<CheckerClaim | null>(null)
  const [actionType, setActionType] = useState<ActionType>(null)
  const [comments, setComments] = useState('')
  const [missingDocs, setMissingDocs] = useState<string[]>([])
  const [customDoc, setCustomDoc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  // Document bytes for the InlinePdfViewer
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [activeDocIdx, setActiveDocIdx] = useState(0)
  const [ocrFields, setOcrFields] = useState<OcrAnnotation[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/workflow/claims/maker_checker_review')
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []
        const enriched = await Promise.all(list.map(async (c: any) => {
          let makerApprovedBy: string | undefined
          let makerApprovedAt: string | undefined
          let makerComments: string | undefined
          try {
            const { data: approvals } = await api.get(`/workflow/approval-history/${c.id}`)
            const arr: any[] = Array.isArray(approvals) ? approvals : []
            const last = [...arr].reverse().find(a => a.level === 'maker' && a.decision === 'approved')
            if (last) {
              makerApprovedBy = last.approver?.name || last.approver?.email
              makerApprovedAt = last.createdAt
              makerComments   = last.comments || undefined
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
            ocrConfidence: c.ocrConfidence,
            makerApprovedBy, makerApprovedAt, makerComments,
            documents: (c.documents || []).map((d: any) => ({
              id: d.id,
              name: d.originalName || d.filename || '',
              documentType: d.documentType,
              mimetype: d.mimetype,
            })),
            submittedAt: c.submittedAt,
          }
        }))
        setClaims(enriched)
      } catch { /* keep existing data */ }
      finally { setLoading(false) }
    }
    load()
  }, [])

  // Load document bytes when a claim is opened or the active tab changes
  useEffect(() => {
    if (!selectedClaim) return
    const doc = selectedClaim.documents[activeDocIdx]
    if (!doc?.id) { setDocBytes(null); return }
    let cancelled = false
    setDocLoading(true)
    setDocBytes(null)
    ;(async () => {
      try {
        const res = await api.get(`/documents/${doc.id}/preview`, { responseType: 'arraybuffer' })
        if (!cancelled) setDocBytes(new Uint8Array(res.data))
      } catch { if (!cancelled) setDocBytes(null) }
      finally { if (!cancelled) setDocLoading(false) }
    })()
    return () => { cancelled = true }
  }, [selectedClaim, activeDocIdx])

  // Load OCR fields when a claim is opened
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

  const openClaim = (claim: CheckerClaim) => {
    setSelectedClaim(claim)
    setActiveDocIdx(0)
    setActionType(null)
    setComments('')
    setMissingDocs([])
    setCustomDoc('')
    setActionError(null)
    setOcrFields([])
    setOpen(true)
  }

  const closeClaim = () => {
    setOpen(false)
    setSelectedClaim(null)
    setActionType(null)
    setComments('')
    setMissingDocs([])
    setDocBytes(null)
    setOcrFields([])
    setActionError(null)
  }

  const selectAction = (type: ActionType) => {
    setActionType(prev => prev === type ? null : type)
    setComments('')
    setMissingDocs([])
    setActionError(null)
  }

  const toggleMissingDoc = (doc: string) =>
    setMissingDocs(prev => prev.includes(doc) ? prev.filter(d => d !== doc) : [...prev, doc])

  const addCustomDoc = () => {
    if (customDoc.trim() && !missingDocs.includes(customDoc.trim())) {
      setMissingDocs(prev => [...prev, customDoc.trim()])
      setCustomDoc('')
    }
  }

  const handleSubmit = async () => {
    if (!selectedClaim || !actionType) return
    setSubmitting(true)
    setActionError(null)
    try {
      const endpoints: Record<string, string> = {
        approve:         '/workflow/checker/approve',
        reject:          '/workflow/checker/reject',
        return_maker:    '/workflow/checker/return',
        return_provider: '/workflow/checker/return-to-provider',
        escalate_fraud:  `/claims/${selectedClaim.id}/fraud/escalate`,
      }
      const bodies: Record<string, object> = {
        approve:         { claimId: selectedClaim.id, comments },
        reject:          { claimId: selectedClaim.id, reason: comments },
        return_maker:    { claimId: selectedClaim.id, reason: comments },
        return_provider: { claimId: selectedClaim.id, reason: comments, missingDocuments: missingDocs },
        escalate_fraud:  { reason: comments },
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

  const cfg       = actionType ? ACTION_CONFIG[actionType] : null
  const canSubmit = actionType && (!ACTION_CONFIG[actionType].required || comments.trim().length > 0) && !submitting
  const activeDoc = selectedClaim?.documents[activeDocIdx]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maker-Checker Queue</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Verify and QA invoices before forwarding to the claims officer
          </p>
        </div>
        <Badge variant="outline" className="text-base px-4 py-2 gap-2">
          <UserCog className="h-4 w-4" /> {stats.total} Pending
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { icon: FileText,    color: 'text-blue-500',    label: 'Pending Review',    value: stats.total },
          { icon: DollarSign,  color: 'text-amber-500',   label: 'High Value (>100K)', value: stats.highValue },
          { icon: Clock,       color: 'text-red-500',     label: 'Urgent',            value: stats.urgent },
          { icon: DollarSign,  color: 'text-emerald-500', label: 'Total Value',       value: formatCurrency(stats.totalValue) },
        ].map(({ icon: Icon, color, label, value }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`h-8 w-8 opacity-70 ${color}`} />
              <div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Queue table */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search claims, members, providers…" value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>

          {bulkSelected.size > 0 && (
            <div className="mb-3">
              <BulkActionsBar selectedIds={Array.from(bulkSelected)} onClear={() => setBulkSelected(new Set())}
                onDone={() => { setBulkSelected(new Set()); window.location.reload() }} queueType="maker_checker" />
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
                    <TableHead>Claim #</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="w-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No claims in the queue
                      </TableCell>
                    </TableRow>
                  ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(claim => {
                    const critCount = claim.fraudSignals.filter(s => s.level === 'critical').length
                    const warnCount = claim.fraudSignals.filter(s => s.level === 'warning').length
                    return (
                      <TableRow key={claim.id}
                        className={`cursor-pointer transition-colors ${bulkSelected.has(claim.id) ? 'bg-blue-50/10' : 'hover:bg-muted/40'}`}
                        onClick={() => openClaim(claim)}>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox checked={bulkSelected.has(claim.id)}
                            onCheckedChange={checked => {
                              setBulkSelected(prev => { const n = new Set(prev); if (checked) n.add(claim.id); else n.delete(claim.id); return n })
                            }} />
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          {claim.claimNumber}
                        </TableCell>
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
                          {claim.fraudSignals.length > 0 ? (
                            <div className="flex items-center gap-1">
                              {critCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-400">
                                  <AlertTriangle className="h-3 w-3" />{critCount}
                                </span>
                              )}
                              {warnCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-400">
                                  <AlertTriangle className="h-3 w-3" />{warnCount}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(claim.submittedAt)}</TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={filtered.length}
                onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Claim Review Panel ── */}
      <Dialog open={open} onOpenChange={() => closeClaim()}>
        <DialogContent className="max-w-[min(1500px,98vw)] w-[min(1500px,98vw)] h-[96vh] p-0 gap-0 overflow-hidden flex flex-col">
          {selectedClaim && (
            <>
              {/* Header */}
              <div className="flex items-start justify-between px-5 py-3 border-b bg-card shrink-0">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-lg font-black tracking-tight text-primary">{selectedClaim.claimNumber}</span>
                    <Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary">{selectedClaim.priority}</Badge>
                    {selectedClaim.invoiceAmount > 100000 && (
                      <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">High value</Badge>
                    )}
                    {selectedClaim.fraudSignals.filter(s => s.level === 'critical').length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
                        <ShieldAlert className="h-3 w-3" />
                        {selectedClaim.fraudSignals.filter(s => s.level === 'critical').length} Critical Signal{selectedClaim.fraudSignals.filter(s => s.level === 'critical').length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {selectedClaim.memberName}{selectedClaim.memberNumber ? ` · ${selectedClaim.memberNumber}` : ''} · {selectedClaim.provider?.name} ·{' '}
                    <span className="font-semibold text-foreground">{formatCurrency(selectedClaim.invoiceAmount)}</span>
                  </p>
                </div>
                <button onClick={closeClaim} className="rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-4">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body: 3-column layout */}
              <div className="flex-1 min-h-0 grid grid-cols-[1fr_340px] overflow-hidden">

                {/* LEFT — Document viewer */}
                <div className="min-h-0 flex flex-col border-r bg-neutral-950">
                  {/* Document tabs */}
                  {selectedClaim.documents.length > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-neutral-900 shrink-0 overflow-x-auto">
                      {selectedClaim.documents.map((doc, i) => (
                        <button key={doc.id || i} onClick={() => setActiveDocIdx(i)}
                          className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                            i === activeDocIdx ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/8 hover:text-white/80'
                          }`}>
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="max-w-[180px] truncate">{doc.name}</span>
                          {doc.documentType && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 border-white/20 text-white/60">
                              {doc.documentType.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Viewer area */}
                  <div className="flex-1 min-h-0">
                    {selectedClaim.documents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-white/40">
                        <FileText className="h-12 w-12" />
                        <p className="text-sm">No documents attached</p>
                      </div>
                    ) : docLoading ? (
                      <div className="flex items-center justify-center h-full gap-2 text-white/40">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Loading {activeDoc?.name}…</span>
                      </div>
                    ) : docBytes ? (
                      <InlinePdfViewer
                        key={`${selectedClaim.id}-${activeDocIdx}`}
                        bytes={docBytes}
                        url={null}
                        claimId={selectedClaim.id}
                        annotations={ocrFields}
                        fraudSignalCount={selectedClaim.fraudSignals.length}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-white/40">
                        <AlertTriangle className="h-8 w-8" />
                        <p className="text-sm">Could not load preview</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT — Details, signals, action bar */}
                <div className="min-h-0 overflow-y-auto flex flex-col bg-card">

                  <div className="p-4 space-y-4 flex-1">
                    {/* Claim metadata */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
                      {[
                        { icon: Hash,       label: 'Claim #',   value: selectedClaim.claimNumber, mono: true },
                        { icon: DollarSign, label: 'Amount',    value: formatCurrency(selectedClaim.invoiceAmount), bold: true },
                        { icon: User,       label: 'Member',    value: selectedClaim.memberName },
                        { icon: Building2,  label: 'Provider',  value: selectedClaim.provider?.name || '—' },
                        { icon: Calendar,   label: 'Submitted', value: formatDate(selectedClaim.submittedAt) },
                        { icon: FileText,   label: 'Documents', value: `${selectedClaim.documents.length} attached` },
                      ].map(({ icon: Icon, label, value, mono, bold }) => (
                        <div key={label} className="flex items-start gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                            <p className={`text-sm leading-snug ${mono ? 'font-mono text-xs' : ''} ${bold ? 'font-bold text-base' : ''}`}>{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Fraud signals */}
                    {selectedClaim.fraudSignals.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 text-red-400" />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {selectedClaim.fraudSignals.filter(s => s.level === 'critical').length > 0
                              ? `${selectedClaim.fraudSignals.filter(s => s.level === 'critical').length} Critical`
                              : ''
                            }
                            {selectedClaim.fraudSignals.filter(s => s.level === 'critical').length > 0 && selectedClaim.fraudSignals.filter(s => s.level === 'warning').length > 0 ? ' · ' : ''}
                            {selectedClaim.fraudSignals.filter(s => s.level === 'warning').length > 0
                              ? `${selectedClaim.fraudSignals.filter(s => s.level === 'warning').length} Warning`
                              : ''
                            }
                            {' '}Signal{selectedClaim.fraudSignals.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        {selectedClaim.fraudSignals.map((sig, i) => {
                          const s = SIGNAL_STYLE[sig.level]
                          return (
                            <div key={i} className={`rounded-lg border-l-4 p-2.5 space-y-0.5 ${s.bg}`}>
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} />
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${s.text} opacity-70`}>{s.label}</span>
                                <span className={`text-xs font-semibold ${s.text}`}>{sig.title}</span>
                              </div>
                              <p className={`text-[11px] leading-relaxed ${s.text} opacity-80`}>{sig.detail}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Maker notes */}
                    {selectedClaim.makerComments && (
                      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Prior notes{selectedClaim.makerApprovedBy ? ` — ${selectedClaim.makerApprovedBy}` : ''}
                          {selectedClaim.makerApprovedAt ? ` · ${formatDate(selectedClaim.makerApprovedAt)}` : ''}
                        </p>
                        <p className="text-sm leading-relaxed">{selectedClaim.makerComments}</p>
                      </div>
                    )}

                    {/* Action form */}
                    {actionType && cfg && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
                        <div className="h-px bg-border" />
                        {actionType === 'return_provider' && (
                          <div className="space-y-2">
                            <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Missing / Required Documents
                            </Label>
                            <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto">
                              {MISSING_DOC_OPTIONS.map(doc => (
                                <button key={doc} onClick={() => toggleMissingDoc(doc)}
                                  className={`text-left text-[10px] rounded border px-2 py-1.5 transition-all ${
                                    missingDocs.includes(doc)
                                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                      : 'border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                  }`}>
                                  {missingDocs.includes(doc) ? '✓ ' : ''}{doc}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-1.5">
                              <Input placeholder="Other document…" value={customDoc}
                                onChange={e => setCustomDoc(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addCustomDoc()}
                                className="h-7 text-xs flex-1" />
                              <Button size="sm" variant="outline" onClick={addCustomDoc} disabled={!customDoc.trim()} className="h-7 px-2">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            {missingDocs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {missingDocs.map(d => (
                                  <Badge key={d} variant="secondary" className="gap-1 text-[9px] pr-1">
                                    {d}
                                    <button onClick={() => setMissingDocs(prev => prev.filter(x => x !== d))}>
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {cfg.notesLabel}
                              {!cfg.required && <span className="ml-1 text-[9px] normal-case font-normal border border-border rounded px-1">optional</span>}
                            </Label>
                            <span className={`text-[10px] tabular-nums ${comments.length > 1800 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                              {comments.length}/2000
                            </span>
                          </div>
                          <Textarea placeholder={cfg.notesPlaceholder} value={comments}
                            onChange={e => setComments(e.target.value.slice(0, 2000))}
                            rows={3} className="resize-none text-xs" />
                          <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                            <Mail className="h-3 w-3 mt-0.5 shrink-0" />{cfg.notesHint}
                          </p>
                        </div>

                        {actionError && (
                          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 px-3 py-2 text-xs">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{actionError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action bar — always visible at bottom */}
                  <div className="shrink-0 border-t bg-card p-3 space-y-2.5">
                    <div className="grid grid-cols-5 gap-1">
                      {(Object.keys(ACTION_CONFIG) as (keyof typeof ACTION_CONFIG)[]).map(type => {
                        const { shortLabel, icon: Icon, activeClass, idleClass } = ACTION_CONFIG[type]
                        const isActive = actionType === type
                        return (
                          <button key={type} onClick={() => selectAction(type)}
                            className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition-all text-[10px] leading-tight font-medium ${isActive ? activeClass : idleClass}`}>
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{shortLabel}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex gap-2">
                      {actionType ? (
                        <>
                          <Button variant="ghost" size="sm" className="flex-none" onClick={() => selectAction(null)}>Cancel</Button>
                          <Button size="sm" className={`flex-1 ${cfg?.btnClass ?? ''}`} onClick={handleSubmit} disabled={!canSubmit}>
                            {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            {cfg && <cfg.icon className="mr-2 h-3.5 w-3.5" />}
                            {actionType === 'approve'         && 'Approve → Claims Officer'}
                            {actionType === 'reject'          && 'Reject Claim'}
                            {actionType === 'return_maker'    && 'Return for Revision'}
                            {actionType === 'return_provider' && `Return to Provider${missingDocs.length > 0 ? ` (${missingDocs.length})` : ''}`}
                            {actionType === 'escalate_fraud'  && 'Escalate to Fraud Team'}
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full" onClick={closeClaim}>Close</Button>
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
