import { useState, useEffect } from 'react'
import {
  UserCog, Search, Loader2, FileText, DollarSign, Clock,
  CheckCircle, AlertTriangle, X, ChevronRight,
  Building2, User, Calendar, Hash, ShieldAlert, MessageSquare,
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
  documents: CheckerDoc[]
  submittedAt: string
}

const SIGNAL_STYLE = {
  critical: { bg: 'bg-red-950/30 border-red-700', text: 'text-red-300', label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-950/30 border-amber-700', text: 'text-amber-300', label: 'WARNING' },
  info:     { bg: 'bg-blue-950/30 border-blue-700', text: 'text-blue-300', label: 'INFO' },
}

export default function CheckerQueue() {
  const [claims, setClaims] = useState<CheckerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState(false)
  const [selectedClaim, setSelectedClaim] = useState<CheckerClaim | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [activeDocIdx, setActiveDocIdx] = useState(0)
  const [ocrFields, setOcrFields] = useState<OcrAnnotation[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/workflow/claims/maker_checker_review')
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []
        setClaims(list.map((c: any) => ({
          id: c.id,
          claimNumber: c.claimNumber,
          memberName: c.memberName || c.patientName || '—',
          memberNumber: c.memberNumber,
          provider: c.provider ? { name: c.provider.name } : undefined,
          invoiceAmount: c.invoiceAmount || 0,
          priority: c.priority || 'normal',
          fraudSignals: Array.isArray(c.fraudSignals) ? c.fraudSignals : [],
          ocrConfidence: c.ocrConfidence,
          documents: (c.documents || []).map((d: any) => ({
            id: d.id,
            name: d.originalName || d.filename || '',
            documentType: d.documentType,
            mimetype: d.mimetype,
          })),
          submittedAt: c.submittedAt,
        })))
      } catch { /* keep existing */ }
      finally { setLoading(false) }
    }
    load()
  }, [])

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
    setNotes('')
    setSubmitError(null)
    setOcrFields([])
    setDocBytes(null)
    setOpen(true)
  }

  const closeClaim = () => {
    setOpen(false)
    setSelectedClaim(null)
    setNotes('')
    setDocBytes(null)
    setOcrFields([])
    setSubmitError(null)
  }

  const handleForward = async () => {
    if (!selectedClaim) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.post('/workflow/checker/approve', { claimId: selectedClaim.id, comments: notes })
      setClaims(prev => prev.filter(c => c.id !== selectedClaim.id))
      closeClaim()
    } catch (err: any) {
      const d = err?.response?.data
      setSubmitError(
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

  const activeDoc = selectedClaim?.documents[activeDocIdx]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maker-Checker Queue</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Verify invoice data and documents, then forward to the Claims Officer
          </p>
        </div>
        <Badge variant="outline" className="text-base px-4 py-2 gap-2">
          <UserCog className="h-4 w-4" /> {stats.total} Pending
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { icon: FileText,   color: 'text-blue-500',    label: 'Pending Review',    value: stats.total },
          { icon: DollarSign, color: 'text-amber-500',   label: 'High Value (>100K)', value: stats.highValue },
          { icon: Clock,      color: 'text-red-500',     label: 'Urgent',            value: stats.urgent },
          { icon: DollarSign, color: 'text-emerald-500', label: 'Total Value',       value: formatCurrency(stats.totalValue) },
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
                          {claim.fraudSignals.length > 0 ? (
                            <div className="flex items-center gap-1">
                              {critCount > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-400"><AlertTriangle className="h-3 w-3" />{critCount}</span>}
                              {warnCount > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-400"><AlertTriangle className="h-3 w-3" />{warnCount}</span>}
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

      {/* ── Invoice Review Panel ── */}
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

                {/* RIGHT — Details + forward action */}
                <div className="min-h-0 overflow-y-auto flex flex-col bg-background">

                  {/* Metadata */}
                  <div className="px-4 pt-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-3 border-b">
                    {[
                      { icon: Hash,       label: 'Claim #',   value: selectedClaim.claimNumber, className: 'font-mono text-xs font-semibold text-primary' },
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

                  {/* Fraud signals */}
                  <div className="flex-1 px-4 py-3 space-y-3">
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
                                    sig.level === 'critical' ? 'bg-red-500/30 text-red-300' : sig.level === 'warning' ? 'bg-amber-500/30 text-amber-300' : 'bg-blue-500/30 text-blue-300'
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
                  </div>

                  {/* Verification / forward section */}
                  <div className="shrink-0 border-t bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Verification Notes</span>
                      <span className="text-[9px] border border-border rounded px-1 text-muted-foreground">optional</span>
                    </div>
                    <Textarea
                      placeholder="Summarise your QA checks — confirmed amounts, document quality, member identity, cross-references…"
                      value={notes}
                      onChange={e => setNotes(e.target.value.slice(0, 2000))}
                      rows={3}
                      className="resize-none text-xs"
                    />
                    {submitError && (
                      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 px-3 py-2 text-xs">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{submitError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-none" onClick={closeClaim}>Close</Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        onClick={handleForward}
                        disabled={submitting}
                      >
                        {submitting
                          ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Forwarding…</>
                          : <><CheckCircle className="mr-2 h-3.5 w-3.5" />Forward to Claims Officer</>
                        }
                      </Button>
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
