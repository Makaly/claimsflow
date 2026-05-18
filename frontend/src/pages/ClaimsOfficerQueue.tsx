import { useState, useEffect } from 'react'
import {
  Briefcase, Eye, CheckCircle, XCircle, RotateCcw,
  Search, AlertTriangle, Send, Plus, Trash2, Loader2,
  FileText, DollarSign, Clock, MessageSquare, Mail, AlertOctagon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination } from '@/components/Pagination'
import InlineDocumentPreview from '@/components/InlineDocumentPreview'
import BulkActionsBar from '@/components/BulkActionsBar'
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

type ActionType = 'approve' | 'reject' | 'return_maker_checker' | 'return_provider' | 'escalate_fraud' | 'view' | null

interface OfficerClaim {
  id: string
  claimNumber: string
  memberName: string
  memberNumber?: string
  provider?: { name: string }
  invoiceAmount: number
  priority: string
  makerCheckerApprovedBy?: string
  makerCheckerApprovedAt?: string
  makerCheckerComments?: string
  fraudVerdict?: string | null
  documents?: Array<{ id?: string; name: string; documentType?: string; mimetype?: string }>
  submittedAt: string
}

const MISSING_DOC_OPTIONS = [
  'Discharge Summary', 'Lab Results', 'X-Ray/Scan Report', 'Doctor\'s Report',
  'Pre-Authorization Letter', 'Original Invoice', 'Prescription', 'Referral Letter',
  'Member ID Card Copy', 'Inpatient Records', 'Outpatient Records', 'Post-Op Report',
]

export default function ClaimsOfficerQueue() {
  const [claims, setClaims] = useState<OfficerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedClaim, setSelectedClaim] = useState<OfficerClaim | null>(null)
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
        const { data } = await api.get('/workflow/claims/claims_officer_review')
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []

        const enriched = await Promise.all(list.map(async (c: any) => {
          let makerCheckerApprovedBy: string | undefined
          let makerCheckerApprovedAt: string | undefined
          let makerCheckerComments: string | undefined
          try {
            const hRes = await api.get(`/workflow/approval-history/${c.id}`)
            const approvals: any[] = hRes.data
            const last = [...approvals].reverse().find(
              a => a.level === 'maker_checker' && a.decision === 'approved'
            )
            if (last) {
              makerCheckerApprovedBy = last.approver?.name || last.approver?.email
              makerCheckerApprovedAt = last.createdAt
              makerCheckerComments = last.comments || undefined
            }
          } catch { /* tolerate */ }

          return {
            id: c.id,
            claimNumber: c.claimNumber,
            memberName: c.memberName || c.patientName || '—',
            memberNumber: c.memberNumber,
            provider: c.provider ? { name: c.provider.name } : undefined,
            invoiceAmount: c.invoiceAmount || 0,
            priority: c.priority || 'normal',
            makerCheckerApprovedBy,
            makerCheckerApprovedAt,
            makerCheckerComments,
            fraudVerdict: c.fraudVerdict ?? null,
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

  const reloadClaims = () => {
    setLoading(true)
    const load = async () => {
      try {
        const { data } = await api.get('/workflow/claims/claims_officer_review')
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []
        setClaims(list.map((c: any) => ({
          id: c.id,
          claimNumber: c.claimNumber,
          memberName: c.memberName || c.patientName || '—',
          memberNumber: c.memberNumber,
          provider: c.provider ? { name: c.provider.name } : undefined,
          invoiceAmount: c.invoiceAmount || 0,
          priority: c.priority || 'normal',
          fraudVerdict: c.fraudVerdict ?? null,
          documents: (c.documents || []).map((d: any) => ({
            id: d.id, name: d.originalName || d.name || 'Document',
            documentType: d.documentType, mimetype: d.mimetype,
          })),
          submittedAt: c.createdAt,
        })))
      } catch { setClaims([]) } finally { setLoading(false) }
    }
    load()
  }

  const filtered = claims.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return claimNumSubseq(c.claimNumber, search) ||
      c.memberName.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q)
  })

  const openAction = (claim: OfficerClaim, type: ActionType) => {
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

  const toggleMissingDoc = (doc: string) =>
    setMissingDocs(prev => prev.includes(doc) ? prev.filter(d => d !== doc) : [...prev, doc])

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
      const endpoints: Record<string, string> = {
        approve:             '/workflow/claims-officer/approve',
        reject:              '/workflow/claims-officer/reject',
        return_maker_checker:'/workflow/claims-officer/return-to-maker-checker',
        return_provider:     '/workflow/claims-officer/return-to-provider',
        escalate_fraud:      '/workflow/claims-officer/escalate-to-fraud',
      }
      const bodies: Record<string, object> = {
        approve:             { claimId: selectedClaim.id, comments },
        reject:              { claimId: selectedClaim.id, reason: comments },
        return_maker_checker:{ claimId: selectedClaim.id, reason: comments },
        return_provider:     { claimId: selectedClaim.id, reason: comments, missingDocuments: missingDocs },
        escalate_fraud:      { claimId: selectedClaim.id, reason: comments },
      }
      await api.post(endpoints[actionType], bodies[actionType])
      setClaims(prev => prev.filter(c => c.id !== selectedClaim.id))
      setSubmitting(false)
      closeAction()
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Network error — please try again'
      setActionError(err?.response?.status === 403 ? `Not authorised: ${msg}` : msg)
      setSubmitting(false)
    }
  }

  const stats = {
    total: claims.length,
    highValue: claims.filter(c => c.invoiceAmount > 100000).length,
    urgent: claims.filter(c => c.priority === 'urgent').length,
    fraudCleared: claims.filter(c => c.fraudVerdict === 'cleared').length,
    totalValue: claims.reduce((s, c) => s + c.invoiceAmount, 0),
  }

  const actionTitle: Record<string, string> = {
    approve:             'Approve Invoice',
    reject:              'Reject Invoice',
    return_maker_checker:'Return to Maker-Checker',
    return_provider:     'Return to Provider',
    escalate_fraud:      'Escalate to Fraud Team',
    view:                'Invoice Details',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Claims Officer Queue</h1>
          <p className="text-muted-foreground">Final approval queue — maker-checker verified invoices awaiting sign-off</p>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-2">
          <Briefcase className="mr-2 h-4 w-4" /> {stats.total} Pending
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <FileText className="h-8 w-8 text-blue-500 opacity-75" />
          <div><p className="text-sm text-muted-foreground">Pending Approval</p><p className="text-2xl font-bold">{stats.total}</p></div>
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
                  onDone={() => { setBulkSelected(new Set()); reloadClaims() }}
                  queueType="claims_officer"
                  showAssignToMe={false}
                  approveLabel="Approve All"
                  rejectLabel="Reject All"
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
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Maker-Checker</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>MC Notes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      No invoices awaiting claims officer approval
                    </TableCell>
                  </TableRow>
                ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(claim => (
                  <TableRow key={claim.id} className={bulkSelected.has(claim.id) ? 'bg-blue-50/50' : ''}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={bulkSelected.has(claim.id)}
                        onCheckedChange={checked => {
                          setBulkSelected(prev => {
                            const n = new Set(prev)
                            if (checked) n.add(claim.id); else n.delete(claim.id)
                            return n
                          })
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
                      {claim.makerCheckerApprovedBy && (
                        <div className="text-xs">
                          <p className="font-medium">{claim.makerCheckerApprovedBy}</p>
                          {claim.makerCheckerApprovedAt && (
                            <p className="text-muted-foreground">{formatDate(claim.makerCheckerApprovedAt)}</p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {claim.fraudVerdict === 'cleared' && (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-[10px]">
                          Fraud cleared
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[140px] truncate text-xs text-muted-foreground" title={claim.makerCheckerComments}>
                        {claim.makerCheckerComments || '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="View"
                          onClick={() => openAction(claim, 'view')}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="Approve → Payment"
                          onClick={() => openAction(claim, 'approve')}>
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" title="Return to Maker-Checker"
                          onClick={() => openAction(claim, 'return_maker_checker')}>
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
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" title="Escalate to Fraud"
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

      {/* ── Action / View Dialog ── */}
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
              {/* LEFT: Document preview */}
              <div className="min-h-0 p-4 border-r bg-muted/20">
                <InlineDocumentPreview
                  documents={selectedClaim.documents || []}
                  emptyHint="No document uploads available for this invoice."
                  className="h-full"
                />
              </div>

              {/* RIGHT: Form / details */}
              <div className="min-h-0 overflow-y-auto p-5 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-muted-foreground text-xs">Invoice #</Label><p className="font-mono font-medium">{selectedClaim.claimNumber}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Amount</Label><p className="font-bold text-base">{formatCurrency(selectedClaim.invoiceAmount)}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Member</Label><p>{selectedClaim.memberName}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Provider</Label><p>{selectedClaim.provider?.name}</p></div>
                  <div><Label className="text-muted-foreground text-xs">Priority</Label><Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary">{selectedClaim.priority}</Badge></div>
                  <div><Label className="text-muted-foreground text-xs">Submitted</Label><p>{formatDate(selectedClaim.submittedAt)}</p></div>
                </div>

                {selectedClaim.fraudVerdict === 'cleared' && (
                  <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-3 text-xs text-green-800 dark:text-green-300">
                    Fraud investigation completed — verdict: <strong>cleared</strong>. Invoice re-routed here for final approval.
                  </div>
                )}

                {selectedClaim.makerCheckerComments && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Maker-Checker Notes — {selectedClaim.makerCheckerApprovedBy}</p>
                    <p className="mt-1 text-sm">{selectedClaim.makerCheckerComments}</p>
                  </div>
                )}

                {actionType !== 'view' && (
                  <>
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

                    <Separator />
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm font-semibold">
                          <MessageSquare className={`h-3.5 w-3.5 ${
                            actionType === 'approve' ? 'text-emerald-600'
                            : actionType === 'return_provider' ? 'text-amber-600'
                            : actionType === 'return_maker_checker' ? 'text-sky-600'
                            : 'text-red-600'
                          }`} />
                          {actionType === 'approve' ? 'Approval Notes'
                            : actionType === 'return_provider' ? 'Message to Provider'
                            : actionType === 'return_maker_checker' ? 'Return Reason'
                            : actionType === 'escalate_fraud' ? 'Fraud Escalation Reason'
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
                          actionType === 'approve'
                            ? 'Add final approval notes — these are saved to the audit trail and emailed to the provider…'
                            : actionType === 'return_provider'
                              ? 'Explain what must be corrected or supplied before resubmission. The provider will receive this message.'
                              : actionType === 'return_maker_checker'
                                ? 'Explain to the maker-checker team what to re-verify or correct…'
                                : actionType === 'escalate_fraud'
                                  ? 'Describe the fraud indicators. The fraud officer will receive this with the claim.'
                                  : 'Provide a clear, factual rejection reason. The provider will see this message.'
                        }
                        value={comments}
                        onChange={e => setComments(e.target.value.slice(0, 2000))}
                        rows={5}
                        className="resize-none bg-background"
                      />
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Mail className="h-3 w-3 mt-0.5 shrink-0" />
                        {actionType === 'approve'
                          ? 'Approval triggers PDF watermarking, document archiving (EDMS), and payment settlement workflow. Provider will be notified by email.'
                          : actionType === 'return_provider'
                            ? 'This message is emailed to the provider/branch. The invoice returns to initial review.'
                            : actionType === 'return_maker_checker'
                              ? 'The maker-checker team will receive this reason and the invoice moves back to their queue.'
                              : actionType === 'escalate_fraud'
                                ? 'The fraud officer team will be notified immediately. The invoice is placed on fraud hold.'
                                : 'The provider, the maker-checker, and you will all receive an email. This is permanently recorded.'}
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
                  (actionType === 'return_maker_checker' && !comments) ||
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
                {actionType === 'approve' && <><CheckCircle className="mr-2 h-3.5 w-3.5" /> Approve → Payment</>}
                {actionType === 'reject' && <><XCircle className="mr-2 h-3.5 w-3.5" /> Reject Invoice</>}
                {actionType === 'return_maker_checker' && <><RotateCcw className="mr-2 h-3.5 w-3.5" /> Return to Maker-Checker</>}
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
