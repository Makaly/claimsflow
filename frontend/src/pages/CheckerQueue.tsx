import { useState, useEffect } from 'react'
import {
  UserCog, Eye, CheckCircle, XCircle, RotateCcw,
  Search, AlertTriangle, Send, Plus, Trash2, Loader2,
  FileText, DollarSign, Clock, MessageSquare, Mail, AlertOctagon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate, getPriorityColor } from '@/lib/utils'

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
import { Pagination } from '@/components/Pagination'
import InlineDocumentPreview from '@/components/InlineDocumentPreview'
import BulkActionsBar from '@/components/BulkActionsBar'
import { Checkbox } from '@/components/ui/checkbox'

type ActionType = 'approve' | 'reject' | 'return_maker' | 'return_provider' | 'view' | 'escalate_fraud' | null

interface CheckerClaim {
  id: string
  claimNumber: string
  memberName: string
  memberNumber?: string
  provider?: { name: string }
  invoiceAmount: number
  priority: string
  makerApprovedBy?: string
  makerApprovedAt?: string
  makerComments?: string
  documents?: Array<{ id?: string; name: string; documentType?: string; mimetype?: string }>
  submittedAt: string
}

const MISSING_DOC_OPTIONS = [
  'Discharge Summary', 'Lab Results', 'X-Ray/Scan Report', 'Doctor\'s Report',
  'Pre-Authorization Letter', 'Original Invoice', 'Prescription', 'Referral Letter',
  'Member ID Card Copy', 'Inpatient Records', 'Outpatient Records', 'Post-Op Report',
]

const DEMO_CLAIMS: CheckerClaim[] = [
  {
    id: 'c1', claimNumber: 'CLM-2026-00138', memberName: 'David Kipkoech',
    memberNumber: 'MBR-003821', provider: { name: 'Gertrude Hospital' },
    invoiceAmount: 34000, priority: 'normal',
    makerApprovedBy: 'Jane Mwangi', makerApprovedAt: '2026-04-09T10:00:00Z',
    makerComments: 'All documents verified. Invoice matches OCR extraction.',
    documents: [{ name: 'invoice.pdf' }, { name: 'lab_results.pdf' }, { name: 'discharge.pdf' }],
    submittedAt: '2026-04-08T09:00:00Z',
  },
  {
    id: 'c2', claimNumber: 'CLM-2026-00134', memberName: 'Alice Nyambura',
    memberNumber: 'MBR-007412', provider: { name: 'Nairobi Hospital' },
    invoiceAmount: 120000, priority: 'high',
    makerApprovedBy: 'Peter Omondi', makerApprovedAt: '2026-04-08T15:00:00Z',
    makerComments: 'High value claim. All supporting documents present.',
    documents: [{ name: 'invoice.pdf' }, { name: 'pre_auth.pdf' }],
    submittedAt: '2026-04-07T14:00:00Z',
  },
  {
    id: 'c3', claimNumber: 'CLM-2026-00131', memberName: 'Joseph Otieno',
    memberNumber: 'MBR-009283', provider: { name: 'Avenue Hospital' },
    invoiceAmount: 56000, priority: 'normal',
    makerApprovedBy: 'Sarah Wambui', makerApprovedAt: '2026-04-08T11:00:00Z',
    makerComments: 'Standard claim. Lab results and invoice verified.',
    documents: [{ name: 'invoice.pdf' }, { name: 'lab.pdf' }],
    submittedAt: '2026-04-07T10:00:00Z',
  },
  {
    id: 'c4', claimNumber: 'CLM-2026-00128', memberName: 'Faith Wangari',
    memberNumber: 'MBR-004567', provider: { name: 'MP Shah Hospital' },
    invoiceAmount: 210000, priority: 'urgent',
    makerApprovedBy: 'James Kimani', makerApprovedAt: '2026-04-07T16:00:00Z',
    makerComments: 'Surgery claim. Pre-authorization confirmed. Urgent processing needed.',
    documents: [{ name: 'invoice.pdf' }, { name: 'op_report.pdf' }],
    submittedAt: '2026-04-06T15:00:00Z',
  },
]

export default function CheckerQueue() {
  const [claims, setClaims] = useState<CheckerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedClaim, setSelectedClaim] = useState<CheckerClaim | null>(null)
  const [actionType, setActionType] = useState<ActionType>(null)
  const [comments, setComments] = useState('')
  const [missingDocs, setMissingDocs] = useState<string[]>([])
  const [customDoc, setCustomDoc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('token')
        const headers = { Authorization: `Bearer ${token}` }
        const res = await fetch('/api/workflow/claims/checker_review', { headers })
        if (!res.ok) { setClaims([]); return }
        const data = await res.json()
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []

        // For each claim, load its approval history and pull the most recent maker decision
        // so the checker sees the real maker comments from DB (not the hardcoded demo text).
        const enriched = await Promise.all(list.map(async (c: any) => {
          let makerApprovedBy: string | undefined
          let makerApprovedAt: string | undefined
          let makerComments: string | undefined
          try {
            const hRes = await fetch(`/api/workflow/approval-history/${c.id}`, { headers })
            if (hRes.ok) {
              const approvals: any[] = await hRes.json()
              const lastMaker = [...approvals].reverse().find(a => a.level === 'maker' && a.decision === 'approved')
              if (lastMaker) {
                makerApprovedBy = lastMaker.approver?.name || lastMaker.approver?.email
                makerApprovedAt = lastMaker.createdAt
                makerComments = lastMaker.comments || undefined
              }
            }
          } catch { /* tolerate missing history */ }

          return {
            id: c.id,
            claimNumber: c.claimNumber,
            memberName: c.memberName || c.patientName || '—',
            memberNumber: c.memberNumber,
            provider: c.provider ? { name: c.provider.name } : undefined,
            invoiceAmount: c.invoiceAmount || 0,
            priority: c.priority || 'normal',
            makerApprovedBy,
            makerApprovedAt,
            makerComments,
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
      } catch {
        setClaims([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = claims.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return claimNumSubseq(c.claimNumber, search) ||
      c.memberName.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q)
  })

  const openAction = (claim: CheckerClaim, type: ActionType) => {
    setSelectedClaim(claim)
    setActionType(type)
    setComments('')
    setMissingDocs([])
    setCustomDoc('')
    setActionError(null)
  }

  const closeAction = () => {
    setActionType(null)
    setSelectedClaim(null)
    setComments('')
    setMissingDocs([])
    setActionError(null)
  }

  const toggleMissingDoc = (doc: string) => {
    setMissingDocs(prev =>
      prev.includes(doc) ? prev.filter(d => d !== doc) : [...prev, doc]
    )
  }

  const addCustomDoc = () => {
    if (customDoc.trim() && !missingDocs.includes(customDoc.trim())) {
      setMissingDocs(prev => [...prev, customDoc.trim()])
      setCustomDoc('')
    }
  }

  const handleSubmit = async () => {
    if (!selectedClaim || !actionType || actionType === 'view') return
    setSubmitting(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('token')
      const endpoints: Record<string, string> = {
        approve: '/api/workflow/checker/approve',
        reject: '/api/workflow/checker/reject',
        return_maker: '/api/workflow/checker/return',
        return_provider: '/api/workflow/checker/return-to-provider',
        escalate_fraud: `/api/claims/${selectedClaim.id}/fraud/escalate`,
      }
      const bodies: Record<string, object> = {
        approve: { claimId: selectedClaim.id, comments },
        reject: { claimId: selectedClaim.id, reason: comments },
        return_maker: { claimId: selectedClaim.id, reason: comments },
        return_provider: { claimId: selectedClaim.id, reason: comments, missingDocuments: missingDocs },
        escalate_fraud: { reason: comments },
      }
      const res = await fetch(endpoints[actionType], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(bodies[actionType]),
      })
      if (!res.ok) {
        let msg = `Request failed (${res.status})`
        try {
          const body = await res.json()
          msg = body?.message || body?.error || msg
        } catch { /* non-JSON body */ }
        setActionError(
          res.status === 403
            ? `You are not authorised to action this claim. ${msg}`
            : msg,
        )
        setSubmitting(false)
        return
      }
      setClaims(prev => prev.filter(c => c.id !== selectedClaim.id))
      setSubmitting(false)
      closeAction()
    } catch (err: any) {
      setActionError(err?.message || 'Network error — please try again')
      setSubmitting(false)
    }
  }

  const stats = {
    total: claims.length,
    highValue: claims.filter(c => c.invoiceAmount > 100000).length,
    urgent: claims.filter(c => c.priority === 'urgent').length,
    totalValue: claims.reduce((s, c) => s + c.invoiceAmount, 0),
  }

  const actionTitle = {
    approve: 'Approve Claim',
    reject: 'Reject Claim',
    return_maker: 'Return to Maker',
    return_provider: 'Return to Provider',
    escalate_fraud: 'Escalate to Fraud Team',
    view: 'Claim Details',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Checker Queue</h1>
          <p className="text-muted-foreground">Second-level review of maker-approved claims</p>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-2">
          <UserCog className="mr-2 h-4 w-4" /> {stats.total} Pending
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <FileText className="h-8 w-8 text-blue-500 opacity-75" />
          <div><p className="text-sm text-muted-foreground">Pending Review</p><p className="text-2xl font-bold">{stats.total}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-amber-500 opacity-75" />
          <div><p className="text-sm text-muted-foreground">High Value (&gt;100K)</p><p className="text-2xl font-bold text-amber-600">{stats.highValue}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <Clock className="h-8 w-8 text-red-500 opacity-75" />
          <div><p className="text-sm text-muted-foreground">Urgent</p><p className="text-2xl font-bold text-red-600">{stats.urgent}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-emerald-500 opacity-75" />
          <div><p className="text-sm text-muted-foreground">Total Value</p><p className="text-lg font-bold">{formatCurrency(stats.totalValue)}</p></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search claims, members, providers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
            {bulkSelected.size > 0 && (
              <div className="mb-3">
                <BulkActionsBar
                  selectedIds={Array.from(bulkSelected)}
                  onClear={() => setBulkSelected(new Set())}
                  onDone={() => { setBulkSelected(new Set()); window.location.reload() }}
                  queueType="checker"
                />
              </div>
            )}
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
                  <TableHead>Maker</TableHead>
                  <TableHead>Maker Notes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No claims in checker queue
                    </TableCell>
                  </TableRow>
                ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(claim => (
                  <TableRow key={claim.id} className={bulkSelected.has(claim.id) ? 'bg-blue-50/50' : ''}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={bulkSelected.has(claim.id)}
                        onCheckedChange={checked => {
                          setBulkSelected(prev => { const n = new Set(prev); if (checked) n.add(claim.id); else n.delete(claim.id); return n })
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium font-mono text-xs">{claim.claimNumber}</TableCell>
                    <TableCell>
                      <p className="font-medium">{claim.memberName}</p>
                      {claim.memberNumber && <p className="text-[10px] text-muted-foreground">{claim.memberNumber}</p>}
                    </TableCell>
                    <TableCell>{claim.provider?.name}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(claim.invoiceAmount)}
                      {claim.invoiceAmount > 100000 && (
                        <p className="text-[10px] text-amber-600 text-right">High value</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={getPriorityColor(claim.priority)} variant="secondary">{claim.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      {claim.makerApprovedBy && (
                        <div className="text-xs">
                          <p className="font-medium">{claim.makerApprovedBy}</p>
                          {claim.makerApprovedAt && (
                            <p className="text-muted-foreground">{formatDate(claim.makerApprovedAt)}</p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[160px] truncate text-xs text-muted-foreground" title={claim.makerComments}>
                        {claim.makerComments || '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="View"
                          onClick={() => openAction(claim, 'view')}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="Final Approve"
                          onClick={() => openAction(claim, 'approve')}>
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" title="Return to Maker"
                          onClick={() => openAction(claim, 'return_maker')}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600" title="Return to Provider"
                          onClick={() => openAction(claim, 'return_provider')}>
                          <Send className="h-3.5 w-3.5 rotate-180" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Reject"
                          onClick={() => openAction(claim, 'reject')}>
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" title="Escalate to Fraud team"
                          onClick={() => openAction(claim, 'escalate_fraud')}>
                          <AlertOctagon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Action / View Dialog — side-by-side document + form ── */}
      <Dialog open={!!actionType} onOpenChange={() => closeAction()}>
        <DialogContent className="max-w-[min(1400px,95vw)] w-[min(1400px,95vw)] h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
            <DialogTitle>
              {actionType ? actionTitle[actionType] : ''}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim?.claimNumber} — {selectedClaim?.memberName}
              {' '}({formatCurrency(selectedClaim?.invoiceAmount || 0)}) · {selectedClaim?.provider?.name}
            </DialogDescription>
          </DialogHeader>

          {selectedClaim && (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-0 overflow-hidden">
              {/* ── LEFT: Document preview ── */}
              <div className="min-h-0 p-4 border-r bg-muted/20">
                <InlineDocumentPreview
                  documents={selectedClaim.documents || []}
                  emptyHint="No document uploads available for this claim."
                  className="h-full"
                />
              </div>

              {/* ── RIGHT: Form / details ── */}
              <div className="min-h-0 overflow-y-auto p-5 space-y-4 text-sm">
                {/* Claim summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-muted-foreground text-xs">Claim #</Label><p className="font-mono font-medium">{selectedClaim.claimNumber}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Amount</Label><p className="font-bold text-base">{formatCurrency(selectedClaim.invoiceAmount)}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Member</Label><p>{selectedClaim.memberName}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Provider</Label><p>{selectedClaim.provider?.name}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Priority</Label><Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary">{selectedClaim.priority}</Badge></div>
                  <div><Label className="text-muted-foreground text-xs">Submitted</Label><p>{formatDate(selectedClaim.submittedAt)}</p></div>
                </div>

                {/* Maker context */}
                {selectedClaim.makerComments && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Maker Notes — {selectedClaim.makerApprovedBy}</p>
                    <p className="mt-1 text-sm">{selectedClaim.makerComments}</p>
                  </div>
                )}

                {actionType !== 'view' && (
                  <>
                    {/* Return to Provider — missing docs selector */}
                    {actionType === 'return_provider' && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Missing / Required Documents</Label>
                          <p className="text-xs text-muted-foreground">Select documents the provider must supply before resubmitting</p>
                          <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                            {MISSING_DOC_OPTIONS.map(doc => (
                              <button
                                key={doc}
                                onClick={() => toggleMissingDoc(doc)}
                                className={`text-left text-xs rounded border px-2 py-1.5 transition-colors ${
                                  missingDocs.includes(doc)
                                    ? 'bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                                    : 'hover:bg-muted/50'
                                }`}
                              >
                                {missingDocs.includes(doc) ? '✓ ' : ''}{doc}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              placeholder="Other document…"
                              value={customDoc}
                              onChange={e => setCustomDoc(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && addCustomDoc()}
                              className="h-8 text-xs flex-1"
                            />
                            <Button size="sm" variant="outline" onClick={addCustomDoc} disabled={!customDoc.trim()}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          {missingDocs.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {missingDocs.map(d => (
                                <Badge key={d} variant="secondary" className="gap-1 text-[10px]">
                                  {d}
                                  <button onClick={() => setMissingDocs(prev => prev.filter(x => x !== d))}>
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Comments / reason */}
                    <Separator />
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm font-semibold">
                          <MessageSquare className={`h-3.5 w-3.5 ${
                            actionType === 'approve' ? 'text-emerald-600'
                            : actionType === 'return_provider' ? 'text-amber-600'
                            : actionType === 'return_maker' ? 'text-sky-600'
                            : 'text-red-600'
                          }`} />
                          {actionType === 'approve' ? 'Checker Comments'
                            : actionType === 'return_provider' ? 'Message to Provider'
                            : actionType === 'return_maker' ? 'Return Reason'
                            : 'Rejection Reason'}
                          {actionType === 'approve'
                            ? <Badge variant="outline" className="ml-1 text-[10px] font-normal">optional</Badge>
                            : <Badge variant="destructive" className="ml-1 text-[10px] font-normal">required</Badge>}
                        </Label>
                        <span className={`text-xs tabular-nums ${comments.length > 1800 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {comments.length}/2000
                        </span>
                      </div>
                      <Textarea
                        placeholder={
                          actionType === 'approve' ? 'Add final review notes — e.g. verified amounts, audited documents, any special handling…'
                          : actionType === 'return_provider' ? 'Explain clearly what must be corrected or supplied before resubmission…'
                          : actionType === 'return_maker' ? 'Explain to the maker what to re-check or correct…'
                          : 'Provide a clear, factual rejection reason. The provider will see this.'
                        }
                        value={comments}
                        onChange={e => setComments(e.target.value.slice(0, 2000))}
                        rows={5}
                        className="resize-none bg-background"
                      />
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Mail className="h-3 w-3 mt-0.5 shrink-0" />
                        {actionType === 'approve' ? 'Comments are saved to the audit trail. The provider, the original maker, and you will each receive an email.'
                          : actionType === 'return_provider' ? 'This message is emailed to the provider/branch. You will also receive a confirmation email.'
                          : actionType === 'return_maker' ? 'The maker who first reviewed this claim will receive an email with this reason. You will also get a confirmation.'
                          : 'The provider, the original maker, and you will all receive an email. This is permanently recorded.'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-3 border-t shrink-0 flex-col sm:flex-row sm:items-center gap-2">
            {actionError && (
              <div className="flex-1 text-xs rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}
            <Button variant="outline" onClick={closeAction}>Cancel</Button>
            {actionType !== 'view' && (
              <Button
                variant={
                  actionType === 'approve' ? 'default'
                  : actionType === 'reject' || actionType === 'escalate_fraud' ? 'destructive'
                  : 'secondary'
                }
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  (actionType === 'reject' && !comments) ||
                  (actionType === 'return_maker' && !comments) ||
                  (actionType === 'return_provider' && !comments) ||
                  (actionType === 'escalate_fraud' && !comments)
                }
                className={
                  actionType === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : actionType === 'escalate_fraud'
                      ? 'bg-red-600 hover:bg-red-700'
                      : ''
                }
              >
                {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {actionType === 'approve' && <><CheckCircle className="mr-2 h-3.5 w-3.5" /> Final Approve</>}
                {actionType === 'reject' && <><XCircle className="mr-2 h-3.5 w-3.5" /> Reject Claim</>}
                {actionType === 'return_maker' && <><RotateCcw className="mr-2 h-3.5 w-3.5" /> Return to Maker</>}
                {actionType === 'return_provider' && (
                  <><AlertTriangle className="mr-2 h-3.5 w-3.5" /> Return to Provider ({missingDocs.length} item{missingDocs.length !== 1 ? 's' : ''})</>
                )}
                {actionType === 'escalate_fraud' && <><AlertOctagon className="mr-2 h-3.5 w-3.5" /> Escalate to Fraud</>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
