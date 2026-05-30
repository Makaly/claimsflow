import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  AlertOctagon, ShieldCheck, ShieldX, FileText, Loader2,
  User, Building2, Calendar, AlertTriangle, Eye, Download,
  Printer, Lock, Hash, Receipt, Stethoscope, UploadCloud, Ban,
  History, MailOpen, Paperclip, Send, RefreshCw, MessageSquare,
  ClipboardList, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Pagination } from '@/components/Pagination'
import InlineDocumentPreview from '@/components/InlineDocumentPreview'
import LineItemsTable from '@/components/LineItemsTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import api from '@/services/api'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'

type FraudSignal = {
  level: 'critical' | 'warning'
  title: string
  detail: string
  detectedAt: string
  meta?: {
    duplicateClaimNumbers?: string[]
    uploadedBy?: string
    uploadedAt?: string
  }
}

interface FraudClaim {
  id: string
  claimNumber: string
  barcode?: string
  batchNumber?: string
  memberName?: string
  memberNumber?: string
  invoiceAmount?: number
  invoiceNumber?: string
  invoiceDate?: string
  diagnosis?: string
  provider?: { name: string; email?: string }
  branch?: { email?: string }
  submittedAt: string
  rejectedAt?: string
  rejectionReason?: string
  fraudSignals?: FraudSignal[]
  uploadedBy?: string
  documents?: Array<{ id: string; originalName: string; mimetype: string }>
}

const PAGE_SIZE_DEFAULT = 10

export default function FraudQueue() {
  const { user } = useAuthStore()
  const canAct = user?.role === 'admin' || user?.role === 'fraud_officer'

  const [tab, setTab] = useState<'hold' | 'confirmed' | 'cross-duplicates'>('hold')

  // ── Cross-Provider Duplicates ─────────────────────────────────────────────
  interface CrossDupClaim {
    id: string
    claimNumber: string
    status: string
    providerName?: string
    invoiceAmount?: number
    submittedAt: string
  }
  interface CrossDupGroup {
    invoiceNumber: string
    count: number
    providerCount: number
    totalAmount: number
    claims: CrossDupClaim[]
  }
  const [crossDups, setCrossDups] = useState<CrossDupGroup[]>([])
  const [crossDupsTotal, setCrossDupsTotal] = useState(0)
  const [crossDupsLoading, setCrossDupsLoading] = useState(false)
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())

  const fetchCrossDups = async () => {
    setCrossDupsLoading(true)
    try {
      const { data } = await api.get('/reports/cross-provider-duplicates')
      setCrossDups(data.duplicates ?? [])
      setCrossDupsTotal(data.total ?? 0)
    } catch (err: any) {
      toast.error('Failed to load cross-provider duplicates', { description: err?.response?.data?.message })
    } finally {
      setCrossDupsLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'cross-duplicates') fetchCrossDups()
  }, [tab])

  const toggleExpand = (invoiceNumber: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev)
      if (next.has(invoiceNumber)) next.delete(invoiceNumber)
      else next.add(invoiceNumber)
      return next
    })
  }

  // ── Under Investigation ──────────────────────────────────────────────────
  const [claims, setClaims] = useState<FraudClaim[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)

  // ── Confirmed Fraud ──────────────────────────────────────────────────────
  const [confirmed, setConfirmed] = useState<FraudClaim[]>([])
  const [confirmedTotal, setConfirmedTotal] = useState(0)
  const [confirmedLoading, setConfirmedLoading] = useState(false)
  const [confirmedPage, setConfirmedPage] = useState(1)
  const [confirmedPageSize, setConfirmedPageSize] = useState(PAGE_SIZE_DEFAULT)

  const [selected, setSelected] = useState<FraudClaim | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Duplicate claim peek — opened when user clicks a CLM reference in a signal
  const [dupePeek, setDupePeek] = useState<FraudClaim | null>(null)
  const [dupePeekLoading, setDupePeekLoading] = useState(false)

  const openDupePeek = async (claimNumber: string) => {
    setDupePeekLoading(true)
    setDupePeek(null)
    try {
      const { data } = await api.get('/claims', { params: { search: claimNumber, limit: 1 } })
      const list: FraudClaim[] = data.claims ?? data ?? []
      const match = list.find((c: FraudClaim) => c.claimNumber === claimNumber)
      if (match) setDupePeek(match)
    } catch { /* ignore */ }
    setDupePeekLoading(false)
  }

  // ── Email history ──────────────────────────────────────────────────────────
  const [emailHistoryClaim, setEmailHistoryClaim] = useState<FraudClaim | null>(null)
  const [emailHistory, setEmailHistory] = useState<any[]>([])
  const [emailHistoryLoading, setEmailHistoryLoading] = useState(false)

  // ── Send Denial ────────────────────────────────────────────────────────────
  const [denialClaim, setDenialClaim] = useState<FraudClaim | null>(null)
  const [denialNote, setDenialNote] = useState('')
  const [denialCcChips, setDenialCcChips] = useState<string[]>([])
  const [denialCcInput, setDenialCcInput] = useState('')
  const [sendingDenial, setSendingDenial] = useState(false)
  const [denialAttachments, setDenialAttachments] = useState<{ filename: string; content: string; encoding: string }[]>([])
  const attachInputRef = useRef<HTMLInputElement>(null)

  // ── Reprocess ──────────────────────────────────────────────────────────────
  const [reprocessTarget, setReprocessTarget] = useState<FraudClaim | null>(null)
  const [reprocessReason, setReprocessReason] = useState('')
  const [reprocessing, setReprocessing] = useState(false)

  // ── Confirmed Fraud detail (read-only) ────────────────────────────────────
  const [confirmedDetail, setConfirmedDetail] = useState<FraudClaim | null>(null)
  const [confirmedAuditTrail, setConfirmedAuditTrail] = useState<any[]>([])
  const [confirmedAuditLoading, setConfirmedAuditLoading] = useState(false)

  // ── Evidence attachments for investigation ─────────────────────────────────
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const evidenceInputRef = useRef<HTMLInputElement>(null)

  const fetchQueue = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true)
    try {
      const { data } = await api.get('/claims/fraud-queue', {
        params: { limit: ps, offset: (p - 1) * ps },
      })
      setClaims(data.claims || [])
      setTotal(data.total ?? data.claims?.length ?? 0)
    } catch (err: any) {
      toast.error('Failed to load fraud queue', { description: err?.response?.data?.message })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  const fetchConfirmed = useCallback(async (p = confirmedPage, ps = confirmedPageSize) => {
    setConfirmedLoading(true)
    try {
      const { data } = await api.get('/claims/fraud-confirmed', {
        params: { limit: ps, offset: (p - 1) * ps },
      })
      setConfirmed(data.claims || [])
      setConfirmedTotal(data.total ?? data.claims?.length ?? 0)
    } catch (err: any) {
      toast.error('Failed to load confirmed cases', { description: err?.response?.data?.message })
    } finally {
      setConfirmedLoading(false)
    }
  }, [confirmedPage, confirmedPageSize])

  useEffect(() => { fetchQueue(page, pageSize) }, [page, pageSize])
  useEffect(() => { fetchConfirmed(confirmedPage, confirmedPageSize) }, [confirmedPage, confirmedPageSize])

  const openDetail = (c: FraudClaim) => { setSelected(c); setNotes(''); setEvidenceFiles([]) }
  const closeDetail = () => { setSelected(null); setNotes(''); setEvidenceFiles([]) }

  const submitAction = async (a: 'clear' | 'confirm') => {
    if (!selected) return
    if (!notes.trim()) { toast.error('Investigation notes are required before taking action'); return }
    setSubmitting(true)
    try {
      // Upload any staged evidence files first (best-effort — don't block on failure)
      if (evidenceFiles.length > 0) {
        setUploadingEvidence(true)
        await uploadEvidenceFiles(selected.id).catch(() => {})
        setUploadingEvidence(false)
      }
      await api.post(`/claims/${selected.id}/fraud/${a}`, {
        notes: notes.trim(),
        evidenceFileCount: evidenceFiles.length,
      })
      toast.success(a === 'clear' ? 'Claim cleared — returned to normal review' : 'Fraud confirmed — claim moved to Confirmed Cases')
      setEvidenceFiles([])
      closeDetail()
      fetchQueue(page, pageSize)
      if (a === 'confirm') fetchConfirmed(confirmedPage, confirmedPageSize)
    } catch (err: any) {
      toast.error('Action failed', { description: err?.response?.data?.message })
    } finally {
      setSubmitting(false)
      setUploadingEvidence(false)
    }
  }

  const exportCsv = async () => {
    try {
      const { data } = await api.get('/claims/fraud-queue', { params: { limit: 5000, offset: 0 } })
      const rows: FraudClaim[] = data.claims || []
      const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = [
        ['Claim #','Batch','Barcode','Member','Member #','Provider','Invoice #','Invoice Date','Amount (KES)','Signals','Signal Levels','Uploaded By','Submitted At'].map(escape).join(','),
        ...rows.map(c => [
          c.claimNumber, c.batchNumber ?? '', c.barcode ?? '', c.memberName ?? '', c.memberNumber ?? '',
          c.provider?.name ?? '', c.invoiceNumber ?? '', c.invoiceDate ?? '', c.invoiceAmount ?? 0,
          (c.fraudSignals || []).map(s => s.title).join(' | '),
          (c.fraudSignals || []).map(s => s.level).join(' | '),
          c.uploadedBy ?? '', c.submittedAt,
        ].map(escape).join(',')),
      ]
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `fraud-queue-${new Date().toISOString().slice(0, 10)}.csv`
      a.click(); URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error('Export failed', { description: err?.response?.data?.message })
    }
  }

  const exportPdf = async () => {
    try {
      const { data } = await api.get('/claims/fraud-queue', { params: { limit: 5000, offset: 0 } })
      const rows: FraudClaim[] = data.claims || []
      const generatedAt = new Date().toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short' })
      const claimRows = rows.map(c => {
        const signals = (c.fraudSignals || []).map(s =>
          `<li class="${s.level === 'critical' ? 'crit' : 'warn'}"><strong>${s.title}</strong> [${s.level}] — ${s.detail}</li>`
        ).join('')
        return `<tr>
          <td><strong>${c.claimNumber}</strong>${c.batchNumber ? `<br/><small>${c.batchNumber}</small>` : ''}</td>
          <td>${c.memberName ?? '—'}<br/><small>${c.memberNumber ?? ''}</small></td>
          <td>${c.provider?.name ?? '—'}</td>
          <td class="amount">KES ${(c.invoiceAmount ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
          <td>${c.invoiceNumber ?? '—'}</td>
          <td>${c.uploadedBy ?? '—'}</td>
          <td>${formatDate(c.submittedAt)}</td>
          <td><ul>${signals || '<li>None</li>'}</ul></td>
        </tr>`
      }).join('')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <title>Fraud Queue Report — ${new Date().toISOString().slice(0, 10)}</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
          h1{font-size:18px;color:#b91c1c;margin-bottom:4px}
          .meta{color:#666;font-size:10px;margin-bottom:16px}
          table{width:100%;border-collapse:collapse}
          th{background:#1e293b;color:#fff;text-align:left;padding:6px 8px;font-size:10px}
          td{border-bottom:1px solid #e2e8f0;padding:6px 8px;vertical-align:top}
          tr:nth-child(even) td{background:#f8fafc}
          .amount{font-weight:bold;white-space:nowrap}
          ul{padding-left:14px} li{margin-bottom:3px}
          li.crit{color:#b91c1c} li.warn{color:#92400e}
          small{color:#888}
          @media print{@page{margin:15mm}}
        </style>
      </head><body>
        <h1>&#9888; Fraud Queue Report — CIC ClaimsFlow</h1>
        <p class="meta">Generated: ${generatedAt} &nbsp;|&nbsp; Total on hold: ${rows.length}</p>
        <table>
          <thead><tr><th>Claim / Batch</th><th>Member</th><th>Provider</th><th>Amount</th><th>Invoice #</th><th>Uploaded By</th><th>Submitted</th><th>Fraud Signals</th></tr></thead>
          <tbody>${claimRows}</tbody>
        </table>
        <script>window.onload=()=>{window.print()}<\/script>
      </body></html>`
      const win = window.open('', '_blank')
      if (!win) { toast.error('Allow popups to export PDF'); return }
      win.document.write(html); win.document.close()
    } catch (err: any) {
      toast.error('PDF export failed', { description: err?.response?.data?.message })
    }
  }

  const openEmailHistory = async (c: FraudClaim) => {
    setEmailHistoryClaim(c)
    setEmailHistoryLoading(true)
    setEmailHistory([])
    try {
      const { data } = await api.get(`/claims/${c.id}/emails`)
      setEmailHistory(data.emails || [])
    } catch { /* best effort */ } finally { setEmailHistoryLoading(false) }
  }

  const openConfirmedDetail = async (c: FraudClaim) => {
    setConfirmedDetail(c)
    setConfirmedAuditLoading(true)
    setConfirmedAuditTrail([])
    try {
      const { data } = await api.get(`/claims/${c.id}/audit-trail`)
      setConfirmedAuditTrail(Array.isArray(data) ? data : data.events || [])
    } catch { /* best effort */ } finally { setConfirmedAuditLoading(false) }
  }

  const sendDenial = async () => {
    if (!denialClaim) return
    setSendingDenial(true)
    try {
      await api.post(`/claims/${denialClaim.id}/notify-denial`, {
        message: denialNote,
        cc: denialCcChips.join(', '),
        attachments: denialAttachments,
      })
      toast.success('Denial notification sent to provider')
      setDenialClaim(null); setDenialCcChips([]); setDenialCcInput(''); setDenialAttachments([])
    } catch { toast.error('Failed to send denial') } finally { setSendingDenial(false) }
  }

  const addAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(f => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        setDenialAttachments(prev => [...prev, { filename: f.name, content: base64, encoding: 'base64' }])
      }
      reader.readAsDataURL(f)
    })
    if (attachInputRef.current) attachInputRef.current.value = ''
  }

  const handleReprocess = async () => {
    if (!reprocessTarget) return
    setReprocessing(true)
    try {
      await api.post(`/claims/${reprocessTarget.id}/reprocess`, { reason: reprocessReason })
      toast.success('Claim reprocessed — returned to maker queue')
      setConfirmed(prev => prev.filter(c => c.id !== reprocessTarget.id))
      setConfirmedTotal(prev => Math.max(0, prev - 1))
      setReprocessTarget(null); setReprocessReason('')
    } catch (err: any) {
      toast.error('Reprocess failed', { description: err?.response?.data?.message || err.message })
    } finally { setReprocessing(false) }
  }

  // ── Stable document list for the investigation viewer ─────────────────────
  // Re-derived only when the selected claim changes — NOT on every notes keystroke.
  const investigationDocs = useMemo(
    () => (selected?.documents || []).map(d => ({ id: d.id, name: d.originalName, mimetype: d.mimetype })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected?.id],
  )

  // Stable docs for confirmed-fraud detail viewer
  const confirmedDetailDocs = useMemo(
    () => (confirmedDetail?.documents || []).map(d => ({ id: d.id, name: d.originalName, mimetype: d.mimetype })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmedDetail?.id],
  )

  // ── Evidence upload helper ─────────────────────────────────────────────────
  const uploadEvidenceFiles = async (claimId: string): Promise<void> => {
    if (evidenceFiles.length === 0) return
    for (const file of evidenceFiles) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('claimId', claimId)
      fd.append('documentType', 'supporting')
      await api.post('/documents/upload', fd).catch(() => {})
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const criticalCount = (c: FraudClaim) => (c.fraudSignals || []).filter(s => s.level === 'critical').length
  const warningCount  = (c: FraudClaim) => (c.fraudSignals || []).filter(s => s.level === 'warning').length

  return (
    <div className="p-6 space-y-5">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 ring-1 ring-red-500/30">
              <AlertOctagon className="h-5 w-5 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Fraud Queue</h1>
            <Badge variant="destructive" className="text-xs px-2.5 py-0.5 rounded-full">
              {total} pending
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground pl-11">
            Claims suspended pending fraud investigation. Nothing moves downstream until cleared or confirmed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportPdf} className="h-8 text-xs gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="h-8 text-xs gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'hold' | 'confirmed')}>
        <TabsList className="mb-2">
          <TabsTrigger value="hold" className="gap-2">
            <AlertOctagon className="h-3.5 w-3.5 text-red-500" />
            Under Investigation
            {total > 0 && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1.5 ml-1">{total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="gap-2">
            <Ban className="h-3.5 w-3.5 text-slate-400" />
            Confirmed Fraud
            {confirmedTotal > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-1 border-red-500/40 text-red-500">{confirmedTotal}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cross-duplicates" className="gap-2">
            <Receipt className="h-3.5 w-3.5 text-amber-500" />
            Cross-Provider Duplicates
            {crossDupsTotal > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-1 border-amber-500/40 text-amber-600">{crossDupsTotal}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Under Investigation tab ── */}
        <TabsContent value="hold" className="space-y-3 mt-0">
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : claims.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-24 flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <ShieldCheck className="h-7 w-7 text-emerald-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">Queue is clear</p>
              <p className="text-sm">No claims are currently on fraud hold.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {claims.map(c => (
              <Card
                key={c.id}
                className="overflow-hidden border-red-500/30 hover:border-red-500/60 transition-colors"
              >
                {/* Top accent bar */}
                <div className="h-1 w-full bg-gradient-to-r from-red-600 via-red-500 to-orange-400" />

                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Left: identity */}
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold tracking-tight">{c.claimNumber}</span>
                        {c.batchNumber && (
                          <Badge variant="outline" className="text-[10px] font-mono">{c.batchNumber}</Badge>
                        )}
                        {c.barcode && (
                          <Badge variant="outline" className="text-[10px] font-mono text-orange-600 border-orange-400/50">
                            {c.barcode}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="font-medium text-foreground">{c.memberName || 'Unknown'}</span>
                          {c.memberNumber && <span>· {c.memberNumber}</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 shrink-0" />
                          {c.provider?.name || '—'}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3 shrink-0" />
                          {formatDate(c.submittedAt)}
                        </span>
                        {c.uploadedBy && (
                          <span className="flex items-center gap-1.5">
                            <UploadCloud className="h-3 w-3 shrink-0" />
                            {c.uploadedBy}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: amount + signal pills */}
                    <div className="text-right shrink-0 space-y-1.5">
                      <div className="text-xl font-bold tabular-nums">{formatCurrency(c.invoiceAmount || 0)}</div>
                      {c.invoiceNumber && (
                        <div className="text-[11px] text-muted-foreground font-mono">{c.invoiceNumber}</div>
                      )}
                      <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        {criticalCount(c) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 ring-1 ring-red-500/30">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {criticalCount(c)} critical
                          </span>
                        )}
                        {warningCount(c) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-500/30">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {warningCount(c)} warning
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Signal preview — first 2 */}
                  {(c.fraudSignals?.length ?? 0) > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {(c.fraudSignals || []).slice(0, 2).map((s, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                            s.level === 'critical'
                              ? 'bg-red-500/8 border border-red-500/20'
                              : 'bg-amber-500/8 border border-amber-500/20'
                          }`}
                        >
                          <AlertTriangle className={`h-3 w-3 mt-0.5 shrink-0 ${s.level === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                          <div className="min-w-0">
                            <span className="font-semibold">{s.title}</span>
                            <span className="text-muted-foreground"> — {s.detail}</span>
                          </div>
                        </div>
                      ))}
                      {(c.fraudSignals?.length ?? 0) > 2 && (
                        <p className="text-[11px] text-muted-foreground px-1">
                          +{c.fraudSignals!.length - 2} more signal(s) — open detail view
                        </p>
                      )}
                    </div>
                  )}

                  {/* Footer row */}
                  <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-border/60">
                    {c.documents && c.documents.length > 0 ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        {c.documents.length} document(s) attached
                      </span>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                      {!canAct && (
                        <span className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Read-only view
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant={canAct ? 'default' : 'outline'}
                        className={canAct ? 'h-7 text-xs bg-red-600 hover:bg-red-700 shadow-sm' : 'h-7 text-xs'}
                        onClick={() => openDetail(c)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1.5" />
                        {canAct ? 'Investigate' : 'View Detail'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            pageSizeOptions={[5, 10, 25, 50]}
          />
        </>
      )}
        </TabsContent>

        {/* ── Confirmed Fraud tab ── */}
        <TabsContent value="confirmed" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <Ban className="h-4 w-4 text-red-500" />
                    Confirmed Fraud Cases
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    These claims were permanently rejected by the Fraud team. Send a formal denial to the provider.
                  </p>
                </div>
                <Badge variant="destructive">{confirmedTotal} case{confirmedTotal !== 1 ? 's' : ''}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {confirmedLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : confirmed.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                  <Ban className="h-10 w-10 opacity-30" />
                  <p className="text-sm">No confirmed fraud cases</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Claim #</TableHead>
                        <TableHead>Member</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Rejected</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {confirmed.map(c => (
                        <TableRow key={c.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Ban className="h-3 w-3 text-red-500 shrink-0" />
                              <span className="font-mono text-xs font-semibold">{c.claimNumber}</span>
                            </div>
                            {c.batchNumber && <p className="text-[10px] text-muted-foreground font-mono pl-4">{c.batchNumber}</p>}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-sm">{c.memberName || '—'}</p>
                            {c.memberNumber && <p className="text-[10px] text-muted-foreground">{c.memberNumber}</p>}
                          </TableCell>
                          <TableCell className="text-sm">{c.provider?.name || '—'}</TableCell>
                          <TableCell className="text-right">
                            <span className="line-through text-muted-foreground text-sm">{formatCurrency(c.invoiceAmount || 0)}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(c.rejectedAt || c.submittedAt)}
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate text-muted-foreground">
                            {c.rejectionReason || '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-slate-700 hover:bg-slate-800 text-white gap-1"
                                onClick={() => openConfirmedDetail(c)}
                              >
                                <Eye className="h-3 w-3" /> View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-500/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                onClick={() => {
                                  setDenialClaim(c)
                                  const preFill: string[] = []
                                  if (c.branch?.email) preFill.push(c.branch.email)
                                  preFill.push('claims@cic.co.ke')
                                  setDenialCcChips(preFill); setDenialCcInput(''); setDenialAttachments([])
                                  setDenialNote(`Dear ${c.provider?.name || 'Provider'},\n\nThis is to formally notify you that claim ${c.claimNumber} has been permanently declined following a fraud investigation by our Fraud & Risk team.\n\nInvoice Reference: ${c.invoiceNumber || 'N/A'}\nClaim Reference: ${c.claimNumber}\nMember: ${c.memberName || 'N/A'}\nAmount: ${(c.invoiceAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })} KES\n\nNo payment will be made against this invoice. This decision is final and has been recorded in our system.\n\nShould you require further clarification, please contact the CIC Insurance Claims Department at claims@cic.co.ke or call +254 703 099 000.\n\nYours sincerely,\nCIC Insurance Group PLC\nClaims Department`)
                                }}
                              >
                                <Send className="h-3 w-3 mr-1" /> Send Denial
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                title="View email history"
                                onClick={() => openEmailHistory(c)}
                              >
                                <History className="h-3 w-3 mr-1" /> History
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                                title="Reprocess after client consultation"
                                onClick={() => { setReprocessTarget(c); setReprocessReason('') }}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" /> Reprocess
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pagination
                    page={confirmedPage}
                    pageSize={confirmedPageSize}
                    total={confirmedTotal}
                    onPageChange={setConfirmedPage}
                    onPageSizeChange={(s) => { setConfirmedPageSize(s); setConfirmedPage(1) }}
                    pageSizeOptions={[5, 10, 25, 50]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cross-Provider Duplicates tab ── */}
        <TabsContent value="cross-duplicates" className="space-y-4 mt-2">
          {/* Summary + refresh */}
          <div className="flex items-center justify-between gap-4">
            <Card className="flex-1">
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <span className="text-sm">
                  {crossDupsLoading ? 'Loading…' : (
                    <><span className="font-bold text-amber-600">{crossDupsTotal}</span> duplicate invoice group{crossDupsTotal !== 1 ? 's' : ''} found across multiple providers</>
                  )}
                </span>
              </CardContent>
            </Card>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCrossDups}
              disabled={crossDupsLoading}
              className="gap-2 shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${crossDupsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {crossDupsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : crossDups.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
                <ShieldCheck className="h-10 w-10 text-emerald-500 opacity-60" />
                <div className="text-center">
                  <p className="font-medium">No cross-provider duplicates</p>
                  <p className="text-sm">No invoice numbers are shared across multiple providers.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-0 px-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Invoice #</TableHead>
                      <TableHead className="text-center">Provider Count</TableHead>
                      <TableHead className="text-center">Claim Count</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead>Claim Statuses</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {crossDups.map(group => {
                      const isExpanded = expandedInvoices.has(group.invoiceNumber)
                      const isCrossProvider = group.providerCount > 1
                      return (
                        <>
                          <TableRow
                            key={`group-${group.invoiceNumber}`}
                            className={`cursor-pointer ${isCrossProvider ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30' : 'hover:bg-muted/50'}`}
                            onClick={() => toggleExpand(group.invoiceNumber)}
                          >
                            <TableCell className="pl-4">
                              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </TableCell>
                            <TableCell className="font-mono text-sm font-semibold">{group.invoiceNumber}</TableCell>
                            <TableCell className="text-center">
                              {isCrossProvider ? (
                                <Badge variant="destructive" className="text-[10px]">{group.providerCount}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">{group.providerCount}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-center text-sm">{group.count}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{formatCurrency(group.totalAmount)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {Array.from(new Set(group.claims.map(c => c.status))).map(s => (
                                  <Badge key={s} variant="outline" className="text-[10px] capitalize">{s}</Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && group.claims.map(claim => (
                            <TableRow
                              key={`claim-${claim.id}`}
                              className={`text-xs ${isCrossProvider ? 'bg-red-50/60 dark:bg-red-950/10' : 'bg-muted/20'}`}
                            >
                              <TableCell />
                              <TableCell className="pl-8 font-mono text-muted-foreground">{claim.claimNumber}</TableCell>
                              <TableCell className="text-center text-muted-foreground" colSpan={1}>
                                {claim.providerName ?? '—'}
                              </TableCell>
                              <TableCell className="text-center capitalize">
                                <Badge
                                  variant={claim.status === 'approved' ? 'default' : claim.status === 'rejected' ? 'destructive' : 'outline'}
                                  className="text-[10px]"
                                >
                                  {claim.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">{claim.invoiceAmount != null ? formatCurrency(claim.invoiceAmount) : '—'}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(claim.submittedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Email History Dialog ── */}
      <Dialog open={!!emailHistoryClaim} onOpenChange={(o) => !o && setEmailHistoryClaim(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
            <MailOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <DialogTitle className="text-sm font-semibold leading-none">Email History</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                All emails sent for <span className="font-mono">{emailHistoryClaim?.claimNumber}</span>
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {emailHistoryLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : emailHistory.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <MailOpen className="h-10 w-10 opacity-30" />
                <p className="text-sm">No emails have been sent for this claim yet</p>
              </div>
            ) : emailHistory.map((e: any, i: number) => (
              <div key={i} className="rounded-lg border bg-muted/10 overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{e.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">To:</span> {e.sentTo}
                      {e.cc && <> &nbsp;·&nbsp; <span className="font-medium">CC:</span> {e.cc}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Sent by:</span> {e.sentByName || 'System'} &nbsp;·&nbsp;
                      {new Date(e.sentAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    e.status === 'sent' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>{e.status}</span>
                </div>
                <div className="px-4 py-3">
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed line-clamp-4">{e.body}</pre>
                  {e.attachments && Array.isArray(e.attachments) && e.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.attachments.map((a: any, j: number) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded bg-muted text-xs px-2 py-0.5">
                          <Paperclip className="h-2.5 w-2.5" />{a.filename}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t shrink-0 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setEmailHistoryClaim(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reprocess Dialog ── */}
      <Dialog open={!!reprocessTarget} onOpenChange={(o) => !o && (setReprocessTarget(null), setReprocessReason(''))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-amber-500" />
              Reprocess Claim
            </DialogTitle>
            <DialogDescription>
              This will return <span className="font-mono font-semibold">{reprocessTarget?.claimNumber}</span> to the maker queue for normal review after client consultation.
              The fraud history is preserved in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-400/30 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-300">
              Use this only when the provider/client has provided satisfactory explanations that change the fraud assessment.
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Reason for reprocessing <span className="text-muted-foreground text-xs">(required)</span></Label>
              <Textarea
                rows={3}
                placeholder="e.g. Provider supplied missing authorisation documents — claim cleared after phone consultation with Dr. Kamau."
                value={reprocessReason}
                onChange={e => setReprocessReason(e.target.value)}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReprocessTarget(null); setReprocessReason('') }}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={reprocessing || !reprocessReason.trim()}
              onClick={handleReprocess}
            >
              {reprocessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {reprocessing ? 'Reprocessing…' : 'Reprocess Claim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send Denial Dialog ── */}
      <Dialog open={!!denialClaim} onOpenChange={(o) => !o && (setDenialClaim(null), setDenialCcChips([]), setDenialCcInput(''))}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden rounded-xl">
          <div className="flex items-center gap-3 px-5 py-4 border-b bg-red-950/30">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20">
              <Send className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Send Denial to Provider</h2>
              <p className="text-xs text-muted-foreground">
                Claim <span className="font-mono text-red-400">{denialClaim?.claimNumber}</span> — permanently rejected for confirmed fraud
              </p>
            </div>
          </div>

          {denialClaim && (
            <div className="flex flex-col gap-0">
              <div className="border-b bg-muted/20">
                <div className="flex items-center gap-3 px-5 py-2.5 border-b">
                  <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0">To</span>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm font-medium">{denialClaim.provider?.name || 'Provider'}</span>
                    {denialClaim.provider?.email ? (
                      <span className="text-xs text-muted-foreground">&lt;{denialClaim.provider.email}&gt;</span>
                    ) : (
                      <span className="text-xs text-amber-500 italic">No email on file — update provider contact</span>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3 px-5 py-2 min-h-[38px]">
                  <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0 pt-1">CC</span>
                  <div
                    className="flex-1 flex flex-wrap gap-1.5 items-center cursor-text"
                    onClick={() => document.getElementById('fq-cc-chip-input')?.focus()}
                  >
                    {denialCcChips.map((chip, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-400/30 px-2.5 py-0.5 text-xs font-medium">
                        {chip}
                        <button
                          type="button"
                          onClick={() => setDenialCcChips(prev => prev.filter((_, j) => j !== i))}
                          className="hover:text-red-500 transition-colors ml-0.5 text-xs leading-none"
                          aria-label="Remove CC recipient"
                        >×</button>
                      </span>
                    ))}
                    <input
                      id="fq-cc-chip-input"
                      type="text"
                      value={denialCcInput}
                      onChange={e => setDenialCcInput(e.target.value)}
                      onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && denialCcInput.trim()) {
                          e.preventDefault()
                          const email = denialCcInput.trim().replace(/,/g, '')
                          if (email && !denialCcChips.includes(email)) setDenialCcChips(prev => [...prev, email])
                          setDenialCcInput('')
                        } else if (e.key === 'Backspace' && !denialCcInput && denialCcChips.length > 0) {
                          setDenialCcChips(prev => prev.slice(0, -1))
                        }
                      }}
                      onBlur={() => {
                        if (denialCcInput.trim()) {
                          const email = denialCcInput.trim().replace(/,/g, '')
                          if (email && !denialCcChips.includes(email)) setDenialCcChips(prev => [...prev, email])
                          setDenialCcInput('')
                        }
                      }}
                      placeholder={denialCcChips.length === 0 ? 'Add recipients — press Enter or comma to add' : ''}
                      className="flex-1 min-w-[180px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 px-5 py-2 border-t">
                  <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0">Re</span>
                  <span className="text-sm text-muted-foreground">
                    Fraud Claim Denial — {denialClaim.claimNumber} / {denialClaim.memberName}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 px-5 py-2 border-t bg-muted/10">
                <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0 pt-1">Files</span>
                <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                  {denialAttachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted border text-xs px-2.5 py-0.5 font-medium">
                      <Paperclip className="h-2.5 w-2.5 shrink-0" />
                      {a.filename}
                      <button type="button" onClick={() => setDenialAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="hover:text-red-500 ml-0.5 leading-none" aria-label="Remove attachment">×</button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => attachInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Paperclip className="h-3 w-3" /> Attach file
                  </button>
                  <input ref={attachInputRef} type="file" multiple className="hidden" onChange={addAttachment} />
                </div>
              </div>

              <div className="p-5 space-y-3">
                <div className="rounded-lg border bg-background overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 border-b">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
                    <span className="ml-2 text-[10px] text-muted-foreground">Email body — edit below</span>
                  </div>
                  <Textarea
                    rows={10}
                    value={denialNote}
                    onChange={e => setDenialNote(e.target.value)}
                    className="border-0 rounded-none text-sm leading-relaxed resize-none focus-visible:ring-0 bg-background font-mono"
                  />
                  <div className="px-4 py-2.5 bg-muted/20 border-t flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>CIC Insurance Group PLC · Registered in Kenya · www.cic.co.ke</span>
                    <span>This email was generated by ClaimsFlow</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/10">
            <p className="text-[11px] text-muted-foreground">This action is permanently logged in the audit trail.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDenialClaim(null); setDenialCcChips([]); setDenialCcInput('') }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={sendingDenial || !denialClaim?.provider?.email}
                onClick={sendDenial}
                className="bg-red-600 hover:bg-red-700"
              >
                {sendingDenial ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                {denialClaim?.provider?.email ? 'Send Denial' : 'No email on file'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirmed Fraud Detail Dialog (read-only) ── */}
      <Dialog open={!!confirmedDetail} onOpenChange={(o) => !o && setConfirmedDetail(null)}>
        <DialogContent className="max-w-[min(1400px,96vw)] w-[min(1400px,96vw)] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl">
          <DialogTitle className="sr-only">{confirmedDetail?.claimNumber} — Confirmed Fraud Detail</DialogTitle>

          {/* Header */}
          <div className="shrink-0 bg-gradient-to-r from-slate-900 via-red-950 to-slate-900 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <Ban className="h-5 w-5 text-red-400 shrink-0" />
                  <span className="text-white font-bold text-base tracking-tight">{confirmedDetail?.claimNumber}</span>
                  <Badge className="bg-red-600/30 text-red-300 border-red-500/40 text-[10px] px-2">CONFIRMED FRAUD</Badge>
                  {confirmedDetail?.batchNumber && (
                    <Badge variant="outline" className="text-[10px] font-mono text-slate-300 border-slate-500/40">{confirmedDetail.batchNumber}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-red-200/70 pl-7">
                  {confirmedDetail?.memberName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{confirmedDetail.memberName}</span>}
                  {confirmedDetail?.provider?.name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{confirmedDetail.provider.name}</span>}
                  {confirmedDetail?.invoiceAmount != null && <span className="font-semibold text-white line-through opacity-60">{formatCurrency(confirmedDetail.invoiceAmount)}</span>}
                </div>
              </div>
              <button onClick={() => setConfirmedDetail(null)} className="text-red-300/60 hover:text-white transition-colors rounded-md p-1">✕</button>
            </div>
          </div>

          {/* Body */}
          {confirmedDetail && (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] overflow-hidden">

              {/* LEFT: Documents */}
              <div className="min-h-0 border-r bg-muted/10 p-4">
                <InlineDocumentPreview
                  documents={confirmedDetailDocs}
                  emptyHint="No documents were attached to this claim."
                  className="h-full"
                />
              </div>

              {/* RIGHT: Details + audit trail */}
              <div className="min-h-0 overflow-y-auto flex flex-col gap-0">

                {/* Claim details */}
                <div className="p-5 space-y-5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Claim Details</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: User,        label: 'Member',         val: confirmedDetail.memberName || '—' },
                        { icon: Hash,        label: 'Member #',       val: confirmedDetail.memberNumber || '—', mono: true },
                        { icon: Building2,   label: 'Provider',       val: confirmedDetail.provider?.name || '—' },
                        { icon: Receipt,     label: 'Invoice Amount', val: formatCurrency(confirmedDetail.invoiceAmount || 0), bold: true },
                        { icon: Hash,        label: 'Invoice #',      val: confirmedDetail.invoiceNumber || '—', mono: true },
                        { icon: Calendar,    label: 'Rejected',       val: formatDate(confirmedDetail.rejectedAt || confirmedDetail.submittedAt) },
                        { icon: UploadCloud, label: 'Uploaded By',    val: confirmedDetail.uploadedBy || '—' },
                      ].map(({ icon: Icon, label, val, mono, bold }) => (
                        <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5"><Icon className="h-3 w-3" />{label}</p>
                          <p className={`text-sm leading-tight truncate ${mono ? 'font-mono text-xs' : ''} ${bold ? 'font-bold' : 'font-medium'}`}>{val}</p>
                        </div>
                      ))}
                      {confirmedDetail.rejectionReason && (
                        <div className="col-span-2 rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2.5">
                          <p className="flex items-center gap-1 text-[10px] text-red-500/70 mb-0.5"><Ban className="h-3 w-3" />Rejection Reason</p>
                          <p className="text-sm font-medium text-red-700 dark:text-red-300">{confirmedDetail.rejectionReason}</p>
                        </div>
                      )}
                      {confirmedDetail.diagnosis && (
                        <div className="col-span-2 rounded-lg bg-muted/40 px-3 py-2.5">
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5"><Stethoscope className="h-3 w-3" />Diagnosis</p>
                          <p className="text-sm font-medium">{confirmedDetail.diagnosis}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fraud signals */}
                  {(confirmedDetail.fraudSignals?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                        Fraud Signals — {confirmedDetail.fraudSignals!.length} Detected
                      </p>
                      <div className="space-y-2">
                        {confirmedDetail.fraudSignals!.map((s, i) => (
                          <div key={i} className={`rounded-lg border px-3 py-2.5 text-xs ${s.level === 'critical' ? 'bg-red-500/8 border-red-500/20' : 'bg-amber-500/8 border-amber-500/20'}`}>
                            <div className="flex items-center gap-1.5 font-semibold mb-1">
                              <span>{s.level === 'critical' ? '🔴' : '🟡'}</span>
                              <span className={s.level === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
                                {s.title}
                              </span>
                              <span className={`ml-auto text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full ${s.level === 'critical' ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-600'}`}>
                                {s.level}
                              </span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed">{s.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Audit trail — single unified section */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                      <ClipboardList className="h-3 w-3" />
                      Investigation Notes &amp; Audit Trail
                    </p>
                    {confirmedAuditLoading ? (
                      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-xs">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                      </div>
                    ) : confirmedAuditTrail.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground/60">
                        No audit events recorded
                      </div>
                    ) : (
                      <div className="relative pl-5">
                        <div className="absolute left-[9px] top-3 bottom-3 w-px bg-border/60" />
                        <div className="space-y-4">
                          {confirmedAuditTrail.map((e: any, i: number) => {
                            const summary: string = e.summary || ''
                            const isFraudConfirm  = summary === 'fraud_confirmed'
                            const isFraudClear    = summary === 'fraud_cleared'
                            const isFraudEscalate = summary === 'fraud_escalated'
                            const isApproval  = e.kind === 'approval'
                            const isApproved  = e.data?.decision === 'approved'
                            const isRejected  = e.data?.decision === 'rejected'
                            const dotCls = isFraudConfirm ? 'bg-red-500 ring-2 ring-red-500/20'
                              : isFraudClear    ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                              : isFraudEscalate ? 'bg-orange-500 ring-2 ring-orange-500/20'
                              : isApproval && isApproved ? 'bg-emerald-400 ring-2 ring-emerald-400/20'
                              : isApproval && isRejected ? 'bg-red-400 ring-2 ring-red-400/20'
                              : e.kind === 'status_change' ? 'bg-blue-400 ring-2 ring-blue-400/20'
                              : 'bg-slate-300 dark:bg-slate-600'
                            const labelMap: Record<string, string> = {
                              fraud_confirmed: 'Fraud Confirmed',
                              fraud_cleared: 'Fraud Cleared',
                              fraud_escalated: 'Escalated to Fraud',
                              document_uploaded: 'Document Uploaded',
                              document_upload: 'Document Uploaded',
                              ocr_completed: 'OCR Completed',
                              claim_created: 'Claim Created',
                              claim_submitted: 'Claim Submitted',
                              batch_published: 'Batch Published',
                              reprocess: 'Reprocessed',
                            }
                            const label = e.kind === 'status_change'
                              ? `Status: ${(e.data?.fromStatus || '').replace(/_/g, ' ')} → ${(e.data?.toStatus || '').replace(/_/g, ' ')}`
                              : e.kind === 'approval'
                              ? `${(e.data?.level || '').replace(/_/g, ' ')} — ${(e.data?.decision || '').toUpperCase()}`
                              : labelMap[summary] || summary.replace(/_/g, ' ')
                            const actorStr = e.actor?.name || e.actor?.email || 'System'
                            const actorRole = e.actor?.role ? e.actor.role.replace(/_/g, ' ') : null
                            const ts = e.at ? new Date(e.at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : ''
                            const headerCls = isFraudConfirm ? 'bg-red-500/8 text-red-600 dark:text-red-400'
                              : isFraudClear    ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-400'
                              : isFraudEscalate ? 'bg-orange-500/8 text-orange-700 dark:text-orange-400'
                              : isApproval && isApproved ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-400'
                              : isApproval && isRejected ? 'bg-red-500/8 text-red-600 dark:text-red-400'
                              : 'bg-muted/40 text-muted-foreground'
                            return (
                              <div key={i} className="relative pl-5">
                                <div className={`absolute -left-[2px] top-[5px] h-3 w-3 rounded-full ring-background ${dotCls}`} />
                                <div className="rounded-lg border bg-card overflow-hidden">
                                  <div className={`flex items-center gap-2 px-3 py-2 border-b text-[10px] font-semibold uppercase tracking-wide ${headerCls}`}>
                                    <span className="flex-1 capitalize">{label || 'Event'}</span>
                                    <span className="font-normal normal-case text-muted-foreground shrink-0">{ts}</span>
                                  </div>
                                  <div className="px-3 py-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="font-medium text-foreground/70">{actorStr}</span>
                                    {actorRole && <><span>·</span><span className="capitalize">{actorRole}</span></>}
                                  </div>
                                  {e.reason && (
                                    <div className="px-3 pb-2.5">
                                      <p className="text-[11px] text-foreground/75 leading-relaxed bg-muted/30 rounded px-2 py-1.5 whitespace-pre-wrap border-l-2 border-border">{e.reason}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom action strip */}
                <div className="mt-auto shrink-0 border-t p-4 flex items-center gap-2 bg-muted/20">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-red-500/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => {
                      const c = confirmedDetail
                      setDenialClaim(c)
                      const preFill: string[] = []
                      if (c.branch?.email) preFill.push(c.branch.email)
                      preFill.push('claims@cic.co.ke')
                      setDenialCcChips(preFill); setDenialCcInput(''); setDenialAttachments([])
                      setDenialNote(`Dear ${c.provider?.name || 'Provider'},\n\nThis is to formally notify you that claim ${c.claimNumber} has been permanently declined following a fraud investigation by our Fraud & Risk team.\n\nInvoice Reference: ${c.invoiceNumber || 'N/A'}\nClaim Reference: ${c.claimNumber}\nMember: ${c.memberName || 'N/A'}\nAmount: ${(c.invoiceAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })} KES\n\nNo payment will be made against this invoice. This decision is final and has been recorded in our system.\n\nShould you require further clarification, please contact the CIC Insurance Claims Department at claims@cic.co.ke or call +254 703 099 000.\n\nYours sincerely,\nCIC Insurance Group PLC\nClaims Department`)
                      setConfirmedDetail(null)
                    }}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Send Denial
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => { openEmailHistory(confirmedDetail); setConfirmedDetail(null) }}
                  >
                    <History className="h-3.5 w-3.5 mr-1.5" /> Email History
                  </Button>
                  {canAct && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                      onClick={() => { setReprocessTarget(confirmedDetail); setReprocessReason(''); setConfirmedDetail(null) }}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reprocess
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 text-xs ml-auto" onClick={() => setConfirmedDetail(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Investigation Dialog ── */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent className="max-w-[min(1400px,96vw)] w-[min(1400px,96vw)] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl">

          {/* Header banner */}
          <div className="shrink-0 bg-gradient-to-r from-red-950 via-red-900 to-slate-900 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <AlertOctagon className="h-5 w-5 text-red-400 shrink-0" />
                  <span className="text-white font-bold text-base tracking-tight">
                    {selected?.claimNumber}
                  </span>
                  <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px] px-2">
                    FRAUD HOLD
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-red-200/70 pl-7">
                  {selected?.memberName && (
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{selected.memberName}</span>
                  )}
                  {selected?.provider?.name && (
                    <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{selected.provider.name}</span>
                  )}
                  {selected?.invoiceAmount != null && (
                    <span className="font-semibold text-white">{formatCurrency(selected.invoiceAmount)}</span>
                  )}
                </div>
              </div>
              <button
                onClick={closeDetail}
                className="text-red-300/60 hover:text-white transition-colors rounded-md p-1"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Body */}
          {selected && (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] overflow-hidden">

              {/* LEFT: Document preview */}
              <div className="min-h-0 border-r bg-muted/10 p-4">
                <InlineDocumentPreview
                  documents={investigationDocs}
                  emptyHint="No documents attached to this claim."
                  className="h-full"
                />
              </div>

              {/* RIGHT: Details + investigation panel */}
              <div className="min-h-0 overflow-y-auto flex flex-col">

                {/* Claim details */}
                <div className="p-5 space-y-5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Claim Details</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: User,         label: 'Member',         val: selected.memberName || '—' },
                        { icon: Hash,         label: 'Member #',       val: selected.memberNumber || '—', mono: true },
                        { icon: Building2,    label: 'Provider',       val: selected.provider?.name || '—' },
                        { icon: Receipt,      label: 'Invoice Amount', val: formatCurrency(selected.invoiceAmount || 0), bold: true },
                        { icon: Hash,         label: 'Invoice #',      val: selected.invoiceNumber || '—', mono: true },
                        { icon: Hash,         label: 'Batch #',        val: selected.batchNumber || '—', mono: true },
                        { icon: Calendar,     label: 'Submitted',      val: formatDate(selected.submittedAt) },
                        { icon: UploadCloud,  label: 'Uploaded By',    val: selected.uploadedBy || '—' },
                      ].map(({ icon: Icon, label, val, mono, bold }) => (
                        <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                            <Icon className="h-3 w-3" />{label}
                          </p>
                          <p className={`text-sm leading-tight truncate ${mono ? 'font-mono text-xs' : ''} ${bold ? 'font-bold' : 'font-medium'}`}>
                            {val}
                          </p>
                        </div>
                      ))}
                      {selected.diagnosis && (
                        <div className="col-span-2 rounded-lg bg-muted/40 px-3 py-2.5">
                          <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                            <Stethoscope className="h-3 w-3" />Diagnosis
                          </p>
                          <p className="text-sm font-medium">{selected.diagnosis}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fraud signals */}
                  {(selected.fraudSignals?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                        Fraud Signal Analysis — {selected.fraudSignals!.length} Signal{selected.fraudSignals!.length !== 1 ? 's' : ''} Detected
                      </p>
                      <div className="space-y-3">
                        {selected.fraudSignals!.map((s, i) => {
                          const isCrit = s.level === 'critical'
                          const isDupe = s.meta?.duplicateClaimNumbers && s.meta.duplicateClaimNumbers.length > 0
                          return (
                            <div key={i} className={`rounded-xl border overflow-hidden ${isCrit ? 'border-red-500/25' : 'border-amber-500/25'}`}>
                              {/* Header */}
                              <div className={`flex items-center gap-2.5 px-4 py-3 ${isCrit ? 'bg-red-500/8' : 'bg-amber-500/8'}`}>
                                <span className="text-base">{isCrit ? '🔴' : '🟡'}</span>
                                <span className={`text-xs font-bold uppercase tracking-wide ${isCrit ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                                  {isCrit ? 'CRITICAL' : 'WARNING'} — {s.title.toUpperCase()}
                                </span>
                                {s.detectedAt && (
                                  <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">
                                    {formatDate(s.detectedAt)}
                                  </span>
                                )}
                              </div>

                              <div className="px-4 py-3 space-y-3 text-xs">
                                {/* What was detected */}
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">What Was Detected</p>
                                  <p className="text-foreground/80 leading-relaxed">{s.detail}</p>
                                </div>

                                {/* Duplicate claim cards */}
                                {isDupe && (
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Duplicate Claim(s)</p>
                                    <div className="space-y-1.5">
                                      {s.meta!.duplicateClaimNumbers!.map(cn => (
                                        <div key={cn} className="rounded-lg border bg-background flex items-center gap-3 px-3 py-2.5">
                                          <div className="h-7 w-7 rounded-md bg-red-500/10 flex items-center justify-center shrink-0">
                                            <Receipt className="h-3.5 w-3.5 text-red-500" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="font-mono text-xs font-bold">{cn}</p>
                                            {s.meta?.uploadedBy && (
                                              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                                <User className="h-2.5 w-2.5" />
                                                Uploaded by <span className="font-medium text-foreground/70">{s.meta.uploadedBy}</span>
                                                {s.meta.uploadedAt && <> · {formatDate(s.meta.uploadedAt)}</>}
                                              </p>
                                            )}
                                          </div>
                                          <button
                                            onClick={() => openDupePeek(cn)}
                                            className="inline-flex items-center gap-1.5 h-7 rounded-lg px-2.5 text-[11px] font-medium border bg-background hover:bg-muted transition-colors shrink-0"
                                          >
                                            <Eye className="h-3 w-3" />View Claim
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Uploader info for non-dupe signals */}
                                {!isDupe && selected.uploadedBy && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-0.5 border-t">
                                    <UploadCloud className="h-3 w-3" />
                                    Submitted by <span className="font-medium text-foreground/70">{selected.uploadedBy}</span>
                                    {selected.submittedAt && <> · {formatDate(selected.submittedAt)}</>}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Duplicate claim peek panel */}
                      {(dupePeekLoading || dupePeek) && (
                        <div className="mt-3 rounded-xl border bg-card overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs font-semibold">
                                {dupePeek ? `Claim ${dupePeek.claimNumber}` : 'Loading claim…'}
                              </span>
                            </div>
                            <button onClick={() => setDupePeek(null)} className="text-muted-foreground hover:text-foreground">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {dupePeekLoading ? (
                            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
                            </div>
                          ) : dupePeek && (
                            <div className="p-4 space-y-2 text-xs">
                              <div className="grid grid-cols-2 gap-3">
                                {[
                                  ['Claim #', dupePeek.claimNumber],
                                  ['Status', dupePeek.rejectedAt ? 'Rejected' : 'Active'],
                                  ['Member', dupePeek.memberName || '—'],
                                  ['Member No.', dupePeek.memberNumber || '—'],
                                  ['Invoice No.', dupePeek.invoiceNumber || '—'],
                                  ['Amount', dupePeek.invoiceAmount != null ? `KES ${Number(dupePeek.invoiceAmount).toLocaleString()}` : '—'],
                                  ['Provider', dupePeek.provider?.name || '—'],
                                  ['Submitted', dupePeek.submittedAt ? formatDate(dupePeek.submittedAt) : '—'],
                                  ['Uploaded by', dupePeek.uploadedBy || '—'],
                                  ['Batch', dupePeek.batchNumber || '—'],
                                ].map(([label, val]) => (
                                  <div key={label}>
                                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">{label}</p>
                                    <p className="font-medium">{val}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="pt-2 border-t">
                                <button
                                  onClick={() => { setSelected(dupePeek); setDupePeek(null) }}
                                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                                >
                                  <Eye className="h-3 w-3" />Open Full Claim Detail
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                  {/* ── Line-item Analysis ── */}
                  {selected && (
                    <div className="mt-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                        <ClipboardList className="h-3 w-3" />
                        Invoice Line Item Analysis
                      </p>
                      <LineItemsTable claimId={selected.id} invoiceTotal={selected.invoiceAmount} />
                    </div>
                  )}

                {/* ── Investigation & Decision panel ── always at bottom */}
                <div className="mt-auto shrink-0 border-t">
                  {canAct ? (
                    <div className="p-5 space-y-3 bg-slate-950/40 dark:bg-slate-900/60">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-500/15">
                          <ShieldCheck className="h-3.5 w-3.5 text-orange-500" />
                        </div>
                        <p className="text-sm font-semibold">Investigation Findings &amp; Decision</p>
                        <Badge variant="destructive" className="text-[9px] h-4 px-1.5 ml-auto">Required</Badge>
                      </div>

                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Record your investigation findings — who you contacted, what evidence was reviewed, what checks were performed, and the basis for your decision. This note is permanently attached to the audit trail."
                        rows={4}
                        className="resize-none text-sm bg-background/60 border-border/60 focus:border-orange-500/50 focus:ring-orange-500/20"
                      />

                      {/* Evidence attachments */}
                      <div className="rounded-lg border border-border/60 bg-background/40 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Paperclip className="h-3.5 w-3.5" />
                            Evidence Attachments
                            {evidenceFiles.length > 0 && (
                              <span className="rounded-full bg-orange-500/20 text-orange-500 text-[10px] font-bold px-1.5 py-0.5 ml-1">
                                {evidenceFiles.length}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => evidenceInputRef.current?.click()}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-500 hover:text-orange-400 transition-colors"
                          >
                            <UploadCloud className="h-3 w-3" /> Attach file
                          </button>
                          <input
                            ref={evidenceInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
                            onChange={(e) => {
                              const files = Array.from(e.target.files || [])
                              setEvidenceFiles(prev => [...prev, ...files])
                              if (evidenceInputRef.current) evidenceInputRef.current.value = ''
                            }}
                          />
                        </div>

                        {evidenceFiles.length === 0 ? (
                          <div
                            className="px-3 py-4 text-center cursor-pointer"
                            onClick={() => evidenceInputRef.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                              e.preventDefault()
                              const files = Array.from(e.dataTransfer.files)
                              setEvidenceFiles(prev => [...prev, ...files])
                            }}
                          >
                            <p className="text-[11px] text-muted-foreground/60">
                              Drag &amp; drop screenshots, reports, emails, or other evidence here
                            </p>
                          </div>
                        ) : (
                          <div className="p-2 space-y-1 max-h-28 overflow-y-auto">
                            {evidenceFiles.map((f, i) => (
                              <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 bg-muted/40 group">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs truncate flex-1 font-medium">{f.name}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                                <button
                                  type="button"
                                  onClick={() => setEvidenceFiles(prev => prev.filter((_, j) => j !== i))}
                                  className="text-muted-foreground hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                                  aria-label="Remove"
                                >
                                  <History className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm h-10"
                          onClick={() => submitAction('clear')}
                          disabled={submitting || !notes.trim()}
                        >
                          {submitting
                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            : <ShieldCheck className="h-4 w-4 mr-2" />}
                          Clear — Resume
                        </Button>
                        <Button
                          variant="destructive"
                          className="h-10 bg-red-600 hover:bg-red-700 shadow-sm"
                          onClick={() => submitAction('confirm')}
                          disabled={submitting || !notes.trim()}
                        >
                          {(submitting || uploadingEvidence)
                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            : <ShieldX className="h-4 w-4 mr-2" />}
                          {uploadingEvidence ? 'Uploading evidence…' : 'Confirm Fraud'}
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        <span className="text-emerald-600 font-medium">Clear</span> returns to claims officer review &amp; dumps files.&nbsp;&nbsp;
                        <span className="text-red-600 font-medium">Confirm Fraud</span> permanently rejects — irreversible.
                      </p>
                    </div>
                  ) : (
                    <div className="p-5 bg-muted/20 flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Investigation panel — Fraud Team only</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          The fraud officer assigned to this claim will record their findings here and issue a clear or rejection decision.
                          You have read-only access to the claim details and documents above.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
