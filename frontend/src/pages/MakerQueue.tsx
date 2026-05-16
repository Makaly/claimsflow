import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  UserCheck, Eye, CheckCircle, XCircle, FileText,
  Clock, AlertTriangle, Search, Loader2, DollarSign, Hash, ChevronLeft, ChevronRight,
  ScanLine, Sparkles, MessageSquare, Send, Mail, AlertOctagon,
  Ban, Building2, User, Calendar, RefreshCw, Paperclip, History,
  X, MailOpen, Stethoscope, CreditCard, MapPin, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
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
import { toast } from 'sonner'
import BulkActionsBar from '@/components/BulkActionsBar'
import { Checkbox } from '@/components/ui/checkbox'

type ActionType = 'approve' | 'reject' | 'view' | 'escalate_fraud' | null

interface MakerClaim {
  id: string
  claimNumber: string
  memberName: string
  memberNumber?: string
  patientId?: string
  provider?: { name: string }
  branch?: { name?: string; email?: string }
  invoiceAmount: number
  invoiceNumber?: string
  invoiceDate?: string
  serviceDate?: string
  priority: string
  status: string
  assignedAt?: string
  slaDeadline?: string
  batchNumber?: string
  documents?: Array<{ id?: string; name: string; size?: number; documentType?: string; mimetype?: string }>
  aiExtracted?: boolean
  aiConfidence?: number
  diagnosis?: string
  diagnosisCode?: string
  treatment?: string
  fraudSignals?: Array<{ level: string; title: string; detail?: string }>
  submittedAt: string
}

const DEMO_CLAIMS: MakerClaim[] = [
  {
    id: 'mc1', claimNumber: 'CLM-2026-00142', memberName: 'John Kamau',
    memberNumber: 'MBR-003210', provider: { name: 'Nairobi Hospital' },
    invoiceAmount: 45000, invoiceNumber: 'INV-2026-9821', priority: 'normal',
    status: 'under_review', assignedAt: '2026-04-10T09:00:00Z',
    slaDeadline: '2026-04-13T09:00:00Z',
    documents: [{ name: 'invoice.pdf' }, { name: 'lab_results.pdf' }, { name: 'prescription.pdf' }],
    aiExtracted: true, aiConfidence: 0.92,
    diagnosis: 'Acute Pharyngitis', diagnosisCode: 'J02.9',
    submittedAt: '2026-04-09T08:30:00Z',
  },
  {
    id: 'mc2', claimNumber: 'CLM-2026-00141', memberName: 'Mary Wanjiku',
    memberNumber: 'MBR-007441', provider: { name: 'Aga Khan University Hospital' },
    invoiceAmount: 78000, invoiceNumber: 'INV-2026-7643', priority: 'high',
    status: 'under_review', assignedAt: '2026-04-09T14:00:00Z',
    slaDeadline: '2026-04-12T14:00:00Z',
    documents: [{ name: 'invoice.pdf' }, { name: 'discharge_summary.pdf' }, { name: 'xray.pdf' }, { name: 'lab.pdf' }, { name: 'referral.pdf' }],
    aiExtracted: true, aiConfidence: 0.88,
    diagnosis: 'Hypertensive Heart Disease', diagnosisCode: 'I11',
    submittedAt: '2026-04-08T13:00:00Z',
  },
  {
    id: 'mc3', claimNumber: 'CLM-2026-00140', memberName: 'Peter Ochieng',
    memberNumber: 'MBR-009102', provider: { name: 'MP Shah Hospital' },
    invoiceAmount: 23000, invoiceNumber: 'INV-2026-4412', priority: 'urgent',
    status: 'under_review', assignedAt: '2026-04-09T08:00:00Z',
    slaDeadline: '2026-04-09T12:00:00Z',
    documents: [{ name: 'invoice.pdf' }],
    aiExtracted: true, aiConfidence: 0.61,
    submittedAt: '2026-04-08T07:00:00Z',
  },
  {
    id: 'mc4', claimNumber: 'CLM-2026-00137', memberName: 'Sarah Njeri',
    memberNumber: 'MBR-004887', provider: { name: 'Kenyatta National Hospital' },
    invoiceAmount: 89000, invoiceNumber: 'INV-2026-3388', priority: 'normal',
    status: 'under_review', assignedAt: '2026-04-08T10:00:00Z',
    slaDeadline: '2026-04-14T10:00:00Z',
    documents: [{ name: 'invoice.pdf' }, { name: 'op_report.pdf' }, { name: 'pre_auth.pdf' }, { name: 'lab.pdf' }],
    aiExtracted: true, aiConfidence: 0.95,
    diagnosis: 'Appendicitis', diagnosisCode: 'K37',
    submittedAt: '2026-04-07T09:00:00Z',
  },
  {
    id: 'mc5', claimNumber: 'CLM-2026-00136', memberName: "James Mwangi",
    memberNumber: 'MBR-002214', provider: { name: "Nairobi Women's Hospital" },
    invoiceAmount: 67000, priority: 'high',
    status: 'under_review', assignedAt: '2026-04-07T09:00:00Z',
    slaDeadline: '2026-04-10T09:00:00Z',
    documents: [{ name: 'invoice.pdf' }, { name: 'maternity.pdf' }],
    aiExtracted: false,
    submittedAt: '2026-04-06T08:00:00Z',
  },
]

export default function MakerQueue() {
  const [tab, setTab] = useState<'queue' | 'fraud_confirmed'>('queue')

  // ── Normal maker queue ────────────────────────────────────────────────────
  const [claims, setClaims] = useState<MakerClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedClaim, setSelectedClaim] = useState<MakerClaim | null>(null)
  const [actionType, setActionType] = useState<ActionType>(null)
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  // ── Confirmed fraud cases ─────────────────────────────────────────────────
  const [fraudClaims, setFraudClaims] = useState<any[]>([])
  const [fraudLoading, setFraudLoading] = useState(false)
  const [fraudPage, setFraudPage] = useState(1)
  const [fraudPageSize, setFraudPageSize] = useState(10)
  const [fraudTotal, setFraudTotal] = useState(0)
  const [denialClaim, setDenialClaim] = useState<any | null>(null)
  const [denialNote, setDenialNote] = useState('')
  const [denialCcChips, setDenialCcChips] = useState<string[]>([])
  const [denialCcInput, setDenialCcInput] = useState('')
  const [sendingDenial, setSendingDenial] = useState(false)
  const [denialAttachments, setDenialAttachments] = useState<{ filename: string; content: string; encoding: string }[]>([])
  const attachInputRef = useRef<HTMLInputElement>(null)

  // ── Reprocess ─────────────────────────────────────────────────────────────
  const [reprocessTarget, setReprocessTarget] = useState<any | null>(null)
  const [reprocessReason, setReprocessReason] = useState('')
  const [reprocessing, setReprocessing] = useState(false)

  // ── Confirmed fraud detail view ───────────────────────────────────────────
  const [fraudDetail, setFraudDetail] = useState<any | null>(null)
  const [fraudAuditTrail, setFraudAuditTrail] = useState<any[]>([])
  const [fraudAuditLoading, setFraudAuditLoading] = useState(false)
  const [fraudDetailTab, setFraudDetailTab] = useState<'details' | 'signals' | 'audit'>('details')
  const [auditPage, setAuditPage] = useState(1)
  const AUDIT_PAGE_SIZE = 5

  const fraudDetailDocs = useMemo(
    () => (fraudDetail?.documents || []).map((d: any) => ({ id: d.id, name: d.originalName || d.name || '', mimetype: d.mimetype || d.mimeType || '' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fraudDetail?.id],
  )

  const openFraudDetail = async (c: any) => {
    setFraudDetail(c)
    setFraudDetailTab('details')
    setAuditPage(1)
    setFraudAuditLoading(true)
    setFraudAuditTrail([])
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/claims/${c.id}/audit-trail`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setFraudAuditTrail(Array.isArray(data) ? data : data.events || [])
      }
    } catch { /* best effort */ } finally { setFraudAuditLoading(false) }
  }

  // ── Email history ─────────────────────────────────────────────────────────
  const [emailHistoryClaim, setEmailHistoryClaim] = useState<any | null>(null)
  const [emailHistory, setEmailHistory] = useState<any[]>([])
  const [emailHistoryLoading, setEmailHistoryLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/workflow/claims/maker_checker_review', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          // Backend returns { claims, total } — frontend was ignoring this shape and always
          // rendering empty. Normalise here.
          const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.claims) ? data.claims : []
          setClaims(list.map((c: any) => ({
            id: c.id,
            claimNumber: c.claimNumber,
            memberName: c.memberName || c.patientName || '—',
            memberNumber: c.memberNumber,
            patientId: c.patientId,
            provider: c.provider ? { name: c.provider.name } : undefined,
            branch: c.branch ? { name: c.branch.name, email: c.branch.email } : undefined,
            invoiceAmount: c.invoiceAmount || 0,
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate,
            serviceDate: c.serviceDate || c.dateOfService,
            priority: c.priority || 'normal',
            status: c.status,
            assignedAt: c.assignedAt || c.submittedAt,
            slaDeadline: c.slaDeadline,
            batchNumber: c.batchSubmission?.batchNumber || c.batchNumber,
            documents: (c.documents || []).map((d: any) => ({
              id: d.id,
              name: d.originalName || d.filename || '',
              size: Number(d.size) || 0,
              documentType: d.documentType,
              mimetype: d.mimetype,
            })),
            aiExtracted: c.ocrStatus === 'completed',
            aiConfidence: c.ocrConfidence,
            diagnosis: c.diagnosis,
            diagnosisCode: (c.procedureCodes && c.procedureCodes[0]) || undefined,
            treatment: c.treatment,
            fraudSignals: c.fraudSignals || [],
            submittedAt: c.submittedAt,
          })))
        } else {
          setClaims([])
        }
      } catch {
        setClaims([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const load = async () => {
      setFraudLoading(true)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(
          `/api/claims/fraud-confirmed?limit=${fraudPageSize}&offset=${(fraudPage - 1) * fraudPageSize}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (res.ok) {
          const data = await res.json()
          setFraudClaims(data.claims || [])
          setFraudTotal(data.total ?? 0)
        }
      } catch { /* best effort */ } finally { setFraudLoading(false) }
    }
    load()
  }, [fraudPage, fraudPageSize])

  const sendDenial = async () => {
    if (!denialClaim) return
    setSendingDenial(true)
    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/claims/${denialClaim.id}/notify-denial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: denialNote,
          cc: denialCcChips.join(', '),
          attachments: denialAttachments,
        }),
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
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/claims/${reprocessTarget.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: reprocessReason }),
      })
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed')
      toast.success('Claim reprocessed — returned to maker-checker queue')
      setFraudClaims(prev => prev.filter(c => c.id !== reprocessTarget.id))
      setFraudTotal(prev => Math.max(0, prev - 1))
      setReprocessTarget(null); setReprocessReason('')
    } catch (err: any) {
      toast.error('Reprocess failed', { description: err.message })
    } finally { setReprocessing(false) }
  }

  const openEmailHistory = async (c: any) => {
    setEmailHistoryClaim(c)
    setEmailHistoryLoading(true)
    setEmailHistory([])
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/claims/${c.id}/emails`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setEmailHistory(data.emails || [])
      }
    } catch { /* best effort */ } finally { setEmailHistoryLoading(false) }
  }

  const filtered = claims.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return claimNumSubseq(c.claimNumber, search) ||
      c.memberName.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q)
  })

  const now = new Date()
  const stats = {
    total: claims.length,
    urgent: claims.filter(c => c.priority === 'urgent').length,
    slaBreach: claims.filter(c => c.slaDeadline && new Date(c.slaDeadline) < now).length,
    lowConf: claims.filter(c => c.aiExtracted && (c.aiConfidence || 1) < 0.7).length,
    totalValue: claims.reduce((s, c) => s + c.invoiceAmount, 0),
  }

  const openAction = (claim: MakerClaim, type: ActionType) => {
    setSelectedClaim(claim)
    setActionType(type)
    setComments('')
    setActionError(null)
  }

  const closeAction = () => {
    setActionType(null)
    setSelectedClaim(null)
    setComments('')
    setActionError(null)
  }

  const handleSubmit = async () => {
    if (!selectedClaim || !actionType || actionType === 'view') return
    setSubmitting(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('token')
      const endpoint =
        actionType === 'approve'
          ? '/api/workflow/maker/approve'
          : actionType === 'reject'
            ? '/api/workflow/maker/reject'
            : `/api/claims/${selectedClaim.id}/fraud/escalate`
      const body =
        actionType === 'approve'
          ? { claimId: selectedClaim.id, comments }
          : actionType === 'reject'
            ? { claimId: selectedClaim.id, reason: comments }
            : { reason: comments }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // Surface the real backend error instead of silently pretending success.
        let msg = `Request failed (${res.status})`
        try {
          const body = await res.json()
          msg = body?.message || body?.error || msg
        } catch { /* non-JSON body */ }
        setActionError(
          res.status === 403
            ? `You are not the assigned maker for this claim. ${msg}`
            : msg,
        )
        setSubmitting(false)
        return
      }
      // Success — drop it from the list and close the dialog.
      setClaims(prev => prev.filter(c => c.id !== selectedClaim.id))
      setSubmitting(false)
      closeAction()
    } catch (err: any) {
      setActionError(err?.message || 'Network error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maker-Checker Queue</h1>
          <p className="text-muted-foreground">Verify captured data, merge and QA documents, then forward to the claims officer</p>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-2">
          <UserCheck className="mr-2 h-4 w-4" /> {stats.total} Assigned
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <UserCheck className="h-3.5 w-3.5" />
            My Queue
            {stats.total > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 ml-1">{stats.total}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="fraud_confirmed" className="gap-2">
            <Ban className="h-3.5 w-3.5 text-red-500" />
            Confirmed Fraud
            {fraudTotal > 0 && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-1 border-red-500/40 text-red-500">{fraudTotal}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Normal queue tab ── */}
        <TabsContent value="queue" className="space-y-6 mt-4">

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: 'Assigned', value: stats.total, icon: FileText, color: 'text-blue-500' },
          { label: 'Urgent', value: stats.urgent, icon: Clock, color: 'text-red-500' },
          { label: 'SLA Breached', value: stats.slaBreach, icon: AlertTriangle, color: 'text-amber-500' },
          { label: 'Low OCR Confidence', value: stats.lowConf, icon: ScanLine, color: 'text-orange-500' },
          { label: 'Total Value', value: formatCurrency(stats.totalValue), icon: DollarSign, color: 'text-emerald-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-7 w-7 ${s.color} opacity-75 shrink-0`} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
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
                  queueType="maker_checker"
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
                  <TableHead>Docs</TableHead>
                  <TableHead>OCR</TableHead>
                  <TableHead>SLA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No claims in maker-checker queue
                    </TableCell>
                  </TableRow>
                ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(claim => {
                  const slaBreach = claim.slaDeadline && new Date(claim.slaDeadline) < now
                  const lowConf = claim.aiExtracted && (claim.aiConfidence || 1) < 0.7
                  return (
                    <TableRow
                      key={claim.id}
                      className={`hover:bg-muted/60 transition-colors ${lowConf ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''} ${bulkSelected.has(claim.id) ? 'bg-blue-50/50' : ''}`}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={bulkSelected.has(claim.id)}
                          onCheckedChange={checked => {
                            setBulkSelected(prev => {
                              const next = new Set(prev)
                              if (checked) next.add(claim.id); else next.delete(claim.id)
                              return next
                            })
                          }}
                        />
                      </TableCell>
                      <TableCell onClick={() => openAction(claim, 'view')} className="cursor-pointer">
                        <div className="flex items-center gap-1">
                          <span className="font-medium font-mono text-xs">{claim.claimNumber}</span>
                          {claim.aiExtracted && <Sparkles className="h-3 w-3 text-violet-500" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{claim.memberName}</p>
                        {claim.memberNumber && <p className="text-[10px] text-muted-foreground">{claim.memberNumber}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{claim.provider?.name}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(claim.invoiceAmount)}</TableCell>
                      <TableCell>
                        <Badge className={getPriorityColor(claim.priority)} variant="secondary">{claim.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          <FileText className="mr-1 h-3 w-3" />
                          {claim.documents?.length ?? 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {claim.aiExtracted ? (
                          <div className="flex items-center gap-1.5">
                            <Progress
                              value={(claim.aiConfidence || 0) * 100}
                              className={`h-1.5 w-14 ${
                                (claim.aiConfidence || 0) >= 0.85 ? '[&>div]:bg-emerald-500'
                                : (claim.aiConfidence || 0) >= 0.7 ? '[&>div]:bg-amber-500'
                                : '[&>div]:bg-red-500'
                              }`}
                            />
                            <span className={`text-[10px] font-medium ${
                              (claim.aiConfidence || 0) >= 0.85 ? 'text-emerald-600'
                              : (claim.aiConfidence || 0) >= 0.7 ? 'text-amber-600'
                              : 'text-red-600'
                            }`}>
                              {((claim.aiConfidence || 0) * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Manual</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {claim.slaDeadline ? (
                          <span className={`text-xs font-medium ${slaBreach ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {slaBreach ? '⚠ Breached' : formatDate(claim.slaDeadline)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
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
      <Dialog open={!!actionType} onOpenChange={closeAction}>
        <DialogContent className="max-w-[min(1400px,95vw)] w-[min(1400px,95vw)] h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
            <DialogTitle>
              {actionType === 'approve' ? 'Approve & Forward to Checker'
               : actionType === 'reject' ? 'Reject Claim'
               : actionType === 'escalate_fraud' ? 'Escalate to Fraud Team'
               : 'Claim Details'}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim?.claimNumber} — {selectedClaim?.memberName}
              {' '}({formatCurrency(selectedClaim?.invoiceAmount || 0)})
              {selectedClaim?.provider?.name && <> · {selectedClaim.provider.name}</>}
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

              {/* ── RIGHT: Full claim details + action form ── */}
              <div className="min-h-0 overflow-y-auto">
                {/* ── Claim identity header ── */}
                <div className="px-4 pt-4 pb-3 border-b bg-gradient-to-r from-muted/40 to-background">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black font-mono text-sm tracking-tight">{selectedClaim.claimNumber}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedClaim.batchNumber && <span className="font-mono">{selectedClaim.batchNumber} · </span>}{formatDate(selectedClaim.submittedAt)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary">{selectedClaim.priority}</Badge>
                      {selectedClaim.aiExtracted && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          (selectedClaim.aiConfidence || 0) >= 0.85 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : (selectedClaim.aiConfidence || 0) >= 0.7 ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : 'bg-red-50 border-red-200 text-red-700'
                        }`}>
                          <Sparkles className="h-2.5 w-2.5" />
                          {((selectedClaim.aiConfidence || 0) * 100).toFixed(0)}% OCR
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* ── Member & Patient ── */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                      <User className="h-3 w-3" /> Member &amp; Patient
                    </p>
                    <div className="rounded-xl border bg-card divide-y overflow-hidden">
                      <div className="grid grid-cols-2 divide-x">
                        <div className="px-3 py-2">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Full Name</p>
                          <p className="text-sm font-semibold truncate">{selectedClaim.memberName || '—'}</p>
                        </div>
                        <div className="px-3 py-2">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Member #</p>
                          <p className="text-sm font-mono font-semibold">{selectedClaim.memberNumber || '—'}</p>
                        </div>
                      </div>
                      {selectedClaim.patientId && (
                        <div className="px-3 py-2">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Patient ID</p>
                          <p className="text-sm font-mono">{selectedClaim.patientId}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Provider ── */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Building2 className="h-3 w-3" /> Provider
                    </p>
                    <div className="rounded-xl border bg-card px-3 py-2.5">
                      <p className="text-sm font-semibold">{selectedClaim.provider?.name || '—'}</p>
                      {selectedClaim.branch?.name && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3" />{selectedClaim.branch.name}</p>}
                    </div>
                  </div>

                  {/* ── Financial ── */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                      <DollarSign className="h-3 w-3" /> Financial
                    </p>
                    <div className="rounded-xl border bg-card overflow-hidden">
                      <div className="px-3 py-2.5 bg-emerald-50/50 dark:bg-emerald-950/10 border-b">
                        <p className="text-[10px] text-muted-foreground mb-0.5">Invoice Amount</p>
                        <p className="text-xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(selectedClaim.invoiceAmount)}</p>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-y">
                        {selectedClaim.invoiceNumber && (
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Invoice #</p>
                            <p className="text-xs font-mono font-semibold">{selectedClaim.invoiceNumber}</p>
                          </div>
                        )}
                        {selectedClaim.invoiceDate && (
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Invoice Date</p>
                            <p className="text-xs font-semibold">{formatDate(selectedClaim.invoiceDate)}</p>
                          </div>
                        )}
                        {selectedClaim.serviceDate && (
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Service Date</p>
                            <p className={`text-xs font-semibold ${selectedClaim.invoiceDate && new Date(selectedClaim.invoiceDate) > new Date(selectedClaim.serviceDate) ? 'text-red-600' : ''}`}>
                              {formatDate(selectedClaim.serviceDate)}
                            </p>
                          </div>
                        )}
                        {selectedClaim.slaDeadline && (
                          <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground mb-0.5">SLA Deadline</p>
                            <p className={`text-xs font-semibold ${new Date(selectedClaim.slaDeadline) < now ? 'text-red-600' : ''}`}>
                              {new Date(selectedClaim.slaDeadline) < now && '⚠ '}{formatDate(selectedClaim.slaDeadline)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Clinical ── */}
                  {(selectedClaim.diagnosis || selectedClaim.diagnosisCode || selectedClaim.treatment) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Stethoscope className="h-3 w-3" /> Clinical
                      </p>
                      <div className="rounded-xl border bg-card divide-y overflow-hidden">
                        {selectedClaim.diagnosis && (
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Diagnosis</p>
                            <p className="text-xs font-semibold">{selectedClaim.diagnosis}{selectedClaim.diagnosisCode && <span className="ml-1.5 font-mono text-muted-foreground">({selectedClaim.diagnosisCode})</span>}</p>
                          </div>
                        )}
                        {selectedClaim.treatment && (
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] text-muted-foreground mb-0.5">Treatment</p>
                            <p className="text-xs">{selectedClaim.treatment}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Fraud signals ── */}
                  {(selectedClaim.fraudSignals?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                        <ShieldAlert className="h-3 w-3 text-red-500" /> Fraud Signals
                      </p>
                      <div className="space-y-2">
                        {(selectedClaim.fraudSignals ?? []).map((s: any, i: number) => (
                          <div key={i} className={`rounded-xl border-l-4 bg-card p-3 ${s.level === 'critical' ? 'border-l-red-500 border border-red-200 dark:border-red-800/60' : 'border-l-amber-500 border border-amber-200 dark:border-amber-800/60'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${s.level === 'critical' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>{s.level}</span>
                              <span className="text-xs font-bold">{s.title}</span>
                            </div>
                            {s.detail && <p className="text-[11px] text-muted-foreground leading-relaxed">{s.detail}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>{/* end p-4 space-y-4 */}

                {/* Comment/reason input (not shown in view mode) */}
                {actionType !== 'view' && (
                  <div className="px-4 pb-4">
                    <Separator className="mb-4" />
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm font-semibold">
                          <MessageSquare className={`h-3.5 w-3.5 ${actionType === 'approve' ? 'text-emerald-600' : 'text-red-600'}`} />
                          {actionType === 'approve'
                            ? 'Maker-Checker Notes'
                            : actionType === 'escalate_fraud'
                              ? 'Reason for Fraud Escalation'
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
                        placeholder={actionType === 'approve'
                          ? 'Add context for the checker — e.g. reviewed documents, amount verified, anomalies you considered…'
                          : actionType === 'escalate_fraud'
                            ? 'Describe what led you to suspect fraud — e.g. mismatched signatures, duplicate invoice, altered dates. The fraud team will investigate and either clear the claim or reject it permanently.'
                            : 'Provide a clear, factual reason for the rejection. This will be recorded in the audit trail and sent to the provider.'}
                        value={comments}
                        onChange={e => setComments(e.target.value.slice(0, 2000))}
                        rows={5}
                        className="resize-none bg-background"
                      />
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Mail className="h-3 w-3 mt-0.5 shrink-0" />
                        {actionType === 'approve'
                          ? 'These notes are saved to the audit trail and emailed to the checker team. You will also receive a confirmation email.'
                          : 'This reason is permanently recorded. The provider/branch will be emailed, and you will receive a confirmation.'}
                      </p>
                    </div>
                  </div>
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
            <Button variant="outline" onClick={closeAction}>
              {actionType === 'view' ? 'Close' : 'Cancel'}
            </Button>

            {/* In view mode show all action buttons inline so the user can act without re-opening */}
            {actionType === 'view' && (
              <>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => { setComments(''); setActionType('escalate_fraud') }}
                >
                  <AlertOctagon className="mr-1.5 h-3.5 w-3.5" /> Escalate Fraud
                </Button>
                <Button
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => { setComments(''); setActionType('reject') }}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => { setComments(''); setActionType('approve') }}
                >
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Approve
                </Button>
              </>
            )}

            {actionType === 'approve' && (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 shadow-sm min-w-[180px]"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Send className="mr-2 h-4 w-4" />}
                {submitting ? 'Forwarding…' : 'Approve & Forward'}
              </Button>
            )}
            {actionType === 'reject' && (
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={submitting || !comments.trim()}
                className="min-w-[160px] shadow-sm"
              >
                {submitting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <XCircle className="mr-2 h-4 w-4" />}
                {submitting ? 'Rejecting…' : 'Reject Claim'}
              </Button>
            )}
            {actionType === 'escalate_fraud' && (
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={submitting || !comments.trim()}
                className="min-w-[180px] shadow-sm bg-red-600 hover:bg-red-700"
              >
                {submitting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <AlertOctagon className="mr-2 h-4 w-4" />}
                {submitting ? 'Escalating…' : 'Escalate to Fraud'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

        </TabsContent>

        {/* ── Confirmed Fraud tab ── */}
        <TabsContent value="fraud_confirmed" className="mt-4">
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
                <Badge variant="destructive">{fraudTotal} case{fraudTotal !== 1 ? 's' : ''}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {fraudLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : fraudClaims.length === 0 ? (
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
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fraudClaims.map(c => (
                        <TableRow key={c.id}>
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
                                onClick={() => openFraudDetail(c)}
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
                    page={fraudPage}
                    pageSize={fraudPageSize}
                    total={fraudTotal}
                    onPageChange={setFraudPage}
                    onPageSizeChange={(s) => { setFraudPageSize(s); setFraudPage(1) }}
                    pageSizeOptions={[5, 10, 25, 50]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Reprocess Dialog ── */}
      <Dialog open={!!reprocessTarget} onOpenChange={(o) => !o && (setReprocessTarget(null), setReprocessReason(''))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-amber-500" />
              Reprocess Claim
            </DialogTitle>
            <DialogDescription>
              This will return <span className="font-mono font-semibold">{reprocessTarget?.claimNumber}</span> to the maker-checker queue for normal review after client consultation.
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

      {/* ── Email History Dialog ── */}
      <Dialog open={!!emailHistoryClaim} onOpenChange={(o) => !o && setEmailHistoryClaim(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogTitle className="sr-only">Email History — {emailHistoryClaim?.claimNumber}</DialogTitle>
          <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
            <MailOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold">Email History</h2>
              <p className="text-xs text-muted-foreground">
                All emails sent for claim <span className="font-mono">{emailHistoryClaim?.claimNumber}</span>
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
            ) : emailHistory.map((e, i) => (
              <div key={i} className="rounded-lg border bg-muted/10 overflow-hidden">
                {/* Email header */}
                <div className="px-4 py-3 border-b bg-muted/20 flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{e.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">To:</span> {e.sentTo}
                      {e.cc && <> &nbsp;·&nbsp; <span className="font-medium">CC:</span> {e.cc}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Sent by:</span> {e.sentByName || 'System'} &nbsp;·&nbsp; {new Date(e.sentAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    e.status === 'sent' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>{e.status}</span>
                </div>
                {/* Email body preview */}
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

      {/* ── Send Denial Dialog ── */}
      <Dialog open={!!denialClaim} onOpenChange={(o) => !o && (setDenialClaim(null), setDenialCcChips([]), setDenialCcInput(''))}>

        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden rounded-xl">
          <DialogTitle className="sr-only">Send Denial — {denialClaim?.claimNumber}</DialogTitle>
          {/* Header */}
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
              {/* Email header fields */}
              <div className="border-b bg-muted/20">
                {/* To */}
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
                {/* CC — chip input */}
                <div className="flex items-start gap-3 px-5 py-2 min-h-[38px]">
                  <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0 pt-1">CC</span>
                  <div
                    className="flex-1 flex flex-wrap gap-1.5 items-center cursor-text"
                    onClick={() => document.getElementById('cc-chip-input')?.focus()}
                  >
                    {denialCcChips.map((chip, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-400/30 px-2.5 py-0.5 text-xs font-medium"
                      >
                        {chip}
                        <button
                          type="button"
                          onClick={() => setDenialCcChips(prev => prev.filter((_, j) => j !== i))}
                          className="hover:text-red-500 transition-colors ml-0.5 text-xs leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="cc-chip-input"
                      type="text"
                      value={denialCcInput}
                      onChange={e => setDenialCcInput(e.target.value)}
                      onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && denialCcInput.trim()) {
                          e.preventDefault()
                          const email = denialCcInput.trim().replace(/,/g, '')
                          if (email && !denialCcChips.includes(email)) {
                            setDenialCcChips(prev => [...prev, email])
                          }
                          setDenialCcInput('')
                        } else if (e.key === 'Backspace' && !denialCcInput && denialCcChips.length > 0) {
                          setDenialCcChips(prev => prev.slice(0, -1))
                        }
                      }}
                      onBlur={() => {
                        if (denialCcInput.trim()) {
                          const email = denialCcInput.trim().replace(/,/g, '')
                          if (email && !denialCcChips.includes(email)) {
                            setDenialCcChips(prev => [...prev, email])
                          }
                          setDenialCcInput('')
                        }
                      }}
                      placeholder={denialCcChips.length === 0 ? 'Add recipients — press Enter or comma to add' : ''}
                      className="flex-1 min-w-[180px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
                {/* Subject */}
                <div className="flex items-center gap-3 px-5 py-2 border-t">
                  <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0">Re</span>
                  <span className="text-sm text-muted-foreground">
                    Fraud Claim Denial — {denialClaim.claimNumber} / {denialClaim.memberName}
                  </span>
                </div>
              </div>

              {/* Attachments */}
              <div className="flex items-start gap-3 px-5 py-2 border-t bg-muted/10">
                <span className="text-xs font-semibold text-muted-foreground w-8 shrink-0 pt-1">Files</span>
                <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                  {denialAttachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted border text-xs px-2.5 py-0.5 font-medium">
                      <Paperclip className="h-2.5 w-2.5 shrink-0" />
                      {a.filename}
                      <button type="button" onClick={() => setDenialAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="hover:text-red-500 ml-0.5 leading-none">×</button>
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

              {/* Email body — styled preview with editable textarea */}
              <div className="p-5 space-y-3">
                <div className="rounded-lg border bg-background overflow-hidden">
                  {/* Email chrome */}
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
                  {/* Footer stamp */}
                  <div className="px-4 py-2.5 bg-muted/20 border-t flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>CIC Insurance Group PLC · Registered in Kenya · www.cic.co.ke</span>
                    <span>This email was generated by ClaimFlow</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/10">
            <p className="text-[11px] text-muted-foreground">
              This action is permanently logged in the audit trail.
            </p>
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

      {/* ── Confirmed Fraud Detail Dialog ── */}
      <Dialog open={!!fraudDetail} onOpenChange={(o) => !o && setFraudDetail(null)}>
        <DialogContent className="max-w-[min(1400px,96vw)] w-[min(1400px,96vw)] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl">
          <DialogTitle className="sr-only">{fraudDetail?.claimNumber} — Confirmed Fraud Detail</DialogTitle>

          {/* Header */}
          <div className="shrink-0 bg-gradient-to-r from-slate-900 via-red-950 to-slate-900 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <Ban className="h-5 w-5 text-red-400 shrink-0" />
                  <span className="text-white font-bold text-base tracking-tight">{fraudDetail?.claimNumber}</span>
                  <Badge className="bg-red-600/30 text-red-300 border-red-500/40 text-[10px] px-2">CONFIRMED FRAUD</Badge>
                  {fraudDetail?.batchNumber && (
                    <Badge variant="outline" className="text-[10px] font-mono text-slate-300 border-slate-500/40">{fraudDetail.batchNumber}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-red-200/70 pl-7">
                  {fraudDetail?.memberName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{fraudDetail.memberName}</span>}
                  {fraudDetail?.provider?.name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{fraudDetail.provider.name}</span>}
                  {fraudDetail?.invoiceAmount != null && <span className="font-semibold text-white/60 line-through">{formatCurrency(fraudDetail.invoiceAmount)}</span>}
                </div>
              </div>
              <button onClick={() => setFraudDetail(null)} className="text-red-300/60 hover:text-white transition-colors rounded-md p-1">✕</button>
            </div>
          </div>

          {fraudDetail && (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] overflow-hidden">
              {/* LEFT: Documents */}
              <div className="min-h-0 border-r bg-muted/10 p-4">
                <InlineDocumentPreview
                  documents={fraudDetailDocs}
                  emptyHint="No documents were attached to this claim."
                  className="h-full"
                />
              </div>

              {/* RIGHT: Tabbed detail panel */}
              <div className="min-h-0 flex flex-col bg-background">
                {/* Mini tab bar */}
                <div className="shrink-0 border-b px-4 pt-3">
                  <div className="flex gap-1">
                    {([
                      { key: 'details', label: 'Details' },
                      { key: 'signals', label: `Signals${fraudDetail.fraudSignals?.length ? ` (${fraudDetail.fraudSignals.length})` : ''}` },
                      { key: 'audit',   label: `Audit Trail${fraudAuditTrail.length ? ` (${fraudAuditTrail.length})` : ''}` },
                    ] as const).map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setFraudDetailTab(t.key)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors ${
                          fraudDetailTab === t.key
                            ? 'border-red-500 text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* ── Details tab ── */}
                  {fraudDetailTab === 'details' && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { icon: User,          label: 'Member',    val: fraudDetail.memberName || '—' },
                          { icon: Building2,     label: 'Provider',  val: fraudDetail.provider?.name || '—' },
                          { icon: DollarSign,    label: 'Amount',    val: formatCurrency(fraudDetail.invoiceAmount || 0), struck: true },
                          { icon: Calendar,      label: 'Rejected',  val: formatDate(fraudDetail.rejectedAt || fraudDetail.submittedAt) },
                          ...(fraudDetail.invoiceNumber ? [{ icon: Hash, label: 'Invoice #', val: fraudDetail.invoiceNumber, mono: true }] : []),
                          ...(fraudDetail.memberNumber  ? [{ icon: User, label: 'Member #',  val: fraudDetail.memberNumber, mono: true }] : []),
                        ].map(({ icon: Icon, label, val, struck, mono }: any) => (
                          <div key={label} className="rounded-xl bg-muted/30 border border-border/40 px-3 py-2.5 hover:bg-muted/50 transition-colors">
                            <p className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground mb-1"><Icon className="h-3 w-3" />{label}</p>
                            <p className={`text-sm leading-tight font-semibold ${struck ? 'line-through text-muted-foreground' : ''} ${mono ? 'font-mono' : ''}`}>{val}</p>
                          </div>
                        ))}
                      </div>
                      {fraudDetail.rejectionReason && (
                        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-4 py-3">
                          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1.5">
                            <Ban className="h-3 w-3" /> Rejection Reason
                          </p>
                          <p className="text-sm font-medium text-red-700 dark:text-red-300 leading-relaxed">{fraudDetail.rejectionReason}</p>
                        </div>
                      )}
                      {fraudDetail.diagnosis && (
                        <div className="rounded-xl bg-muted/30 border border-border/40 px-3 py-2.5">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">Diagnosis</p>
                          <p className="text-sm text-foreground/80 leading-snug">{fraudDetail.diagnosis}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Signals tab ── */}
                  {fraudDetailTab === 'signals' && (
                    <div className="p-4">
                      {(fraudDetail.fraudSignals?.length ?? 0) === 0 ? (
                        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground/60">
                          No fraud signals detected
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {fraudDetail.fraudSignals.map((s: any, i: number) => (
                            <div key={i} className={`rounded-xl border p-4 ${
                              s.level === 'critical'
                                ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                                : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                            }`}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                                  s.level === 'critical'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-amber-500 text-white'
                                }`}>{s.level}</span>
                                <span className={`text-sm font-semibold ${s.level === 'critical' ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>{s.title}</span>
                              </div>
                              <p className="text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Audit Trail tab ── */}
                  {fraudDetailTab === 'audit' && (
                    <div className="p-4">
                      {fraudAuditLoading ? (
                        <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground text-xs">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit trail…
                        </div>
                      ) : fraudAuditTrail.length === 0 ? (
                        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground/60">
                          No audit events recorded
                        </div>
                      ) : (() => {
                        const totalAuditPages = Math.ceil(fraudAuditTrail.length / AUDIT_PAGE_SIZE)
                        const pagedEvents = fraudAuditTrail.slice((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE)
                        const labelMap: Record<string, string> = {
                          fraud_confirmed: 'Fraud Confirmed', fraud_cleared: 'Fraud Cleared',
                          fraud_escalated: 'Escalated to Fraud', document_uploaded: 'Document Uploaded',
                          document_upload: 'Document Uploaded', ocr_completed: 'OCR Completed',
                          claim_created: 'Claim Created', claim_submitted: 'Claim Submitted',
                          batch_published: 'Batch Published', status_updated: 'Status Updated',
                          reprocess: 'Reprocessed', claim_updated: 'Fields Updated',
                        }
                        return (
                          <div>
                            <div className="relative pl-5">
                              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border/40" />
                              <div className="space-y-3">
                                {pagedEvents.map((e: any, i: number) => {
                                  const summary: string = e.summary || ''
                                  const isFraudConfirm = summary === 'fraud_confirmed'
                                  const isFraudClear = summary === 'fraud_cleared'
                                  const isFraudEscalate = summary === 'fraud_escalated'
                                  const isApproval = e.kind === 'approval'
                                  const isApproved = e.data?.decision === 'approved'
                                  const isRejected = e.data?.decision === 'rejected'
                                  const dotCls = isFraudConfirm ? 'bg-red-500'
                                    : isFraudClear ? 'bg-emerald-500'
                                    : isFraudEscalate ? 'bg-orange-500'
                                    : isApproval && isApproved ? 'bg-emerald-400'
                                    : isApproval && isRejected ? 'bg-red-400'
                                    : e.kind === 'status_change' ? 'bg-blue-400'
                                    : 'bg-slate-300 dark:bg-slate-600'
                                  const label = e.kind === 'status_change'
                                    ? `${(e.data?.fromStatus || '').replace(/_/g, ' ')} → ${(e.data?.toStatus || '').replace(/_/g, ' ')}`
                                    : e.kind === 'approval'
                                    ? `${(e.data?.level || '').replace(/_/g, ' ')} ${(e.data?.decision || '').toUpperCase()}`
                                    : labelMap[summary] || summary.replace(/_/g, ' ')
                                  const actorStr = e.actor?.name || e.actor?.email || 'System'
                                  const actorRole = e.actor?.role ? e.actor.role.replace(/_/g, ' ') : null
                                  const ts = e.at ? new Date(e.at).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' }) : ''
                                  return (
                                    <div key={i} className="relative pl-5">
                                      <div className={`absolute -left-[2px] top-[6px] h-2.5 w-2.5 rounded-full ring-2 ring-background ${dotCls}`} />
                                      <div className="rounded-xl border bg-card overflow-hidden">
                                        <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b text-[10px] font-semibold ${
                                          isFraudConfirm || (isApproval && isRejected) ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                                          : isFraudClear || (isApproval && isApproved) ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                                          : isFraudEscalate ? 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400'
                                          : 'bg-muted/40 text-muted-foreground'
                                        }`}>
                                          <span className="capitalize flex-1">{label || 'Event'}</span>
                                          <span className="font-normal text-muted-foreground shrink-0">{ts}</span>
                                        </div>
                                        <div className="px-3 py-1.5 flex items-center gap-1.5 text-[11px]">
                                          <span className="font-semibold text-foreground/80">{actorStr}</span>
                                          {actorRole && <><span className="text-muted-foreground/40">·</span><span className="capitalize text-muted-foreground">{actorRole}</span></>}
                                        </div>
                                        {e.reason && (
                                          <div className="px-3 pb-2">
                                            <p className="text-[11px] text-foreground/75 bg-muted/30 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap border-l-2 border-border leading-relaxed">{e.reason}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                            {totalAuditPages > 1 && (
                              <div className="flex items-center justify-between mt-4 pt-3 border-t">
                                <span className="text-[11px] text-muted-foreground">
                                  {(auditPage - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(auditPage * AUDIT_PAGE_SIZE, fraudAuditTrail.length)} of {fraudAuditTrail.length}
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button size="sm" variant="outline" className="h-6 w-6 p-0" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>
                                    <ChevronLeft className="h-3 w-3" />
                                  </Button>
                                  <span className="text-[11px] px-2 text-muted-foreground">{auditPage} / {totalAuditPages}</span>
                                  <Button size="sm" variant="outline" className="h-6 w-6 p-0" disabled={auditPage >= totalAuditPages} onClick={() => setAuditPage(p => p + 1)}>
                                    <ChevronRight className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>

                {/* Bottom action strip */}
                <div className="mt-auto shrink-0 border-t p-4 flex items-center gap-2 bg-muted/20">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-red-500/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => {
                      const c = fraudDetail
                      setDenialClaim(c)
                      const preFill: string[] = []
                      if (c.branch?.email) preFill.push(c.branch.email)
                      preFill.push('claims@cic.co.ke')
                      setDenialCcChips(preFill); setDenialCcInput(''); setDenialAttachments([])
                      setDenialNote(`Dear ${c.provider?.name || 'Provider'},\n\nThis is to formally notify you that claim ${c.claimNumber} has been permanently declined following a fraud investigation by our Fraud & Risk team.\n\nInvoice Reference: ${c.invoiceNumber || 'N/A'}\nClaim Reference: ${c.claimNumber}\nMember: ${c.memberName || 'N/A'}\nAmount: ${(c.invoiceAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })} KES\n\nNo payment will be made against this invoice. This decision is final and has been recorded in our system.\n\nShould you require further clarification, please contact the CIC Insurance Claims Department at claims@cic.co.ke or call +254 703 099 000.\n\nYours sincerely,\nCIC Insurance Group PLC\nClaims Department`)
                      setFraudDetail(null)
                    }}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Send Denial
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs ml-auto" onClick={() => setFraudDetail(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
