import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Scale, CheckCircle, XCircle, Clock, RefreshCw, AlertTriangle,
  MessageSquare, Send, Loader2, ExternalLink, FileText, User2,
  Gavel, ChevronRight, X, CircleDot, ShieldCheck, Inbox, FilePlus2,
  Search, Download, Paperclip, ArrowUp, ArrowDown, ArrowUpDown,
  BarChart3, ListChecks, Timer, TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useAuthStore } from '@/store/authStore'
import api from '@/services/api'
import { formatDate, formatDateTime, formatCurrency, cn } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  under_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  finalised:    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

const outcomeColors: Record<string, string> = {
  upheld:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  dismissed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const roleLabel: Record<string, string> = {
  admin:          'Admin',
  claims_officer: 'Claims Officer',
  fraud_officer:  'Fraud Officer',
  provider_admin: 'Provider Admin',
  provider_user:  'Provider',
}

const roleBubbleColor: Record<string, string> = {
  admin:          'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800',
  claims_officer: 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
  fraud_officer:  'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800',
  provider_admin: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800',
  provider_user:  'bg-teal-100 dark:bg-teal-900/30 border-teal-200 dark:border-teal-800',
}

const SLA_DAYS = 14
const PAGE_SIZE = 10
const SEEN_KEY = 'appeals-seen-v1'

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', statusColors[status] ?? '')}>
      {status.replace('_', ' ')}
    </span>
  )
}

function OutcomePill({ outcome }: { outcome?: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', outcomeColors[outcome] ?? '')}>
      {outcome}
    </span>
  )
}

/** SLA / aging computation for an appeal. */
function slaInfo(a: any) {
  const created = new Date(a.createdAt).getTime()
  const open = a.status !== 'finalised'
  const end = !open && a.adjudicatedAt ? new Date(a.adjudicatedAt).getTime() : Date.now()
  const daysOpen = Math.max(0, Math.floor((end - created) / 86_400_000))
  const overdue = open && daysOpen > SLA_DAYS
  const atRisk = open && !overdue && daysOpen >= SLA_DAYS - 4
  return { daysOpen, overdue, atRisk, daysLeft: SLA_DAYS - daysOpen, open }
}

function SlaBadge({ appeal }: { appeal: any }) {
  const { daysOpen, overdue, atRisk, daysLeft, open } = slaInfo(appeal)
  if (!open) {
    return <span className="text-xs text-muted-foreground whitespace-nowrap">resolved · {daysOpen}d</span>
  }
  const cls = overdue
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    : atRisk
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  const text = overdue ? `${daysOpen - SLA_DAYS}d overdue` : atRisk ? `${daysLeft}d left` : `${daysOpen}d open`
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', cls)}>{text}</span>
}

// ── Unread tracking (per-browser, localStorage) ──
function getSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} }
}
function markSeen(id: string, ts?: string | null) {
  const s = getSeen()
  s[id] = ts || new Date().toISOString()
  localStorage.setItem(SEEN_KEY, JSON.stringify(s))
}
function isUnread(a: any, myId?: string) {
  if (!a.lastMessageAt || a.lastMessageBy === myId) return false
  const seen = getSeen()[a.id]
  return !seen || new Date(a.lastMessageAt).getTime() > new Date(seen).getTime()
}

export default function Appeals() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [tab, setTab] = useState<'queue' | 'analytics'>('queue')
  const [appeals, setAppeals] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  // Filters / sort / pagination
  const [statusFilter, setStatusFilter] = useState('all')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('filed')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [seenVersion, setSeenVersion] = useState(0)

  // Detail slide-over
  const [detail, setDetail] = useState<any | null>(null)

  // Thread state
  const [messages, setMessages] = useState<any[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAtts, setPendingAtts] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Inline adjudication state
  const [deciding, setDeciding] = useState(false)
  const [outcome, setOutcome] = useState<'upheld' | 'dismissed'>('upheld')
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)

  // File-appeal dialog state
  const [fileOpen, setFileOpen] = useState(false)
  const [appealable, setAppealable] = useState<any[]>([])
  const [appealableLoading, setAppealableLoading] = useState(false)
  const [fileClaimId, setFileClaimId] = useState('')
  const [fileReason, setFileReason] = useState('')
  const [fileNotes, setFileNotes] = useState('')
  const [filing, setFiling] = useState(false)

  const isStaff = ['admin', 'claims_officer', 'fraud_officer'].includes(user?.role ?? '')
  const canDecide = ['admin', 'claims_officer'].includes(user?.role ?? '')
  const canMessage = ['admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user'].includes(user?.role ?? '')
  const canFile = ['admin', 'claims_officer', 'provider_admin', 'provider_user'].includes(user?.role ?? '')

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // Reset to first page whenever a filter changes
  useEffect(() => { setPage(0) }, [statusFilter, outcomeFilter, debouncedSearch, dateFrom, dateTo, sortBy, sortOrder])

  const buildParams = useCallback((forExport = false) => {
    const p = new URLSearchParams()
    if (statusFilter !== 'all') p.set('status', statusFilter)
    if (outcomeFilter !== 'all') p.set('outcome', outcomeFilter)
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (dateFrom) p.set('dateFrom', dateFrom)
    if (dateTo) p.set('dateTo', dateTo)
    p.set('sortBy', sortBy)
    p.set('sortOrder', sortOrder)
    if (forExport) {
      p.set('limit', '1000'); p.set('offset', '0')
    } else {
      p.set('limit', String(PAGE_SIZE)); p.set('offset', String(page * PAGE_SIZE))
    }
    return p
  }, [statusFilter, outcomeFilter, debouncedSearch, dateFrom, dateTo, sortBy, sortOrder, page])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/appeals?${buildParams()}`)
      setAppeals(data.appeals || [])
      setTotal(data.total || 0)
    } catch {
      toast.error('Failed to load appeals')
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => { load() }, [load])

  const loadMessages = async (appealId: string) => {
    setMessagesLoading(true)
    try {
      const { data } = await api.get(`/appeals/${appealId}/messages`)
      setMessages(Array.isArray(data) ? data : [])
    } catch {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keep the open detail panel in sync after a reload
  useEffect(() => {
    if (!detail) return
    const fresh = appeals.find(a => a.id === detail.id)
    if (fresh && fresh !== detail) setDetail(fresh)
  }, [appeals]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(key); setSortOrder('desc') }
  }

  const SortHead = ({ label, sortKey, className }: { label: string; sortKey?: string; className?: string }) => (
    <TableHead className={className}>
      {sortKey ? (
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(sortKey)}>
          {label}
          {sortBy === sortKey
            ? (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>
      ) : label}
    </TableHead>
  )

  const openDetail = (appeal: any) => {
    setDetail(appeal)
    setMessages([])
    setNewMessage('')
    setPendingAtts([])
    setDeciding(false)
    setOutcome('upheld')
    setOutcomeNotes('')
    loadMessages(appeal.id)
    markSeen(appeal.id, appeal.lastMessageAt)
    setSeenVersion(v => v + 1)
  }

  const closeDetail = () => { setDetail(null); setDeciding(false) }

  const openClaim = (claimNumber?: string) => {
    if (!claimNumber) { toast.error('No claim linked to this appeal'); return }
    navigate(`/claims?open=${encodeURIComponent(claimNumber)}`)
  }

  const openAttachment = async (att: any) => {
    try {
      const { data } = await api.get(att.url, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(data)
      window.open(blobUrl, '_blank')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    } catch {
      toast.error('Could not open attachment')
    }
  }

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const { data } = await api.post('/appeals/attachments/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setPendingAtts(prev => [...prev, data])
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const sendMessage = async () => {
    if (!detail || (!newMessage.trim() && pendingAtts.length === 0)) return
    setSending(true)
    try {
      const { data } = await api.post(`/appeals/${detail.id}/messages`, {
        message: newMessage.trim(),
        attachments: pendingAtts,
      })
      setMessages(prev => [...prev, data])
      setNewMessage('')
      setPendingAtts([])
      markSeen(detail.id, data.createdAt)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const markUnderReview = async (id: string) => {
    setActioningId(id)
    try {
      await api.patch(`/appeals/${id}/status`, { status: 'under_review' })
      toast.success('Appeal moved to Under Review')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Could not update status')
    } finally {
      setActioningId(null)
    }
  }

  const adjudicate = async () => {
    if (!detail) return
    setSaving(true)
    try {
      await api.patch(`/appeals/${detail.id}/adjudicate`, { outcome, outcomeNotes })
      toast.success(
        outcome === 'upheld'
          ? 'Appeal upheld — invoice returned to claims for final approval'
          : 'Appeal dismissed — original decision stands',
      )
      setDeciding(false)
      setOutcomeNotes('')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to adjudicate')
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { data } = await api.get(`/appeals?${buildParams(true)}`)
      const rows = data.appeals || []
      const header = ['Claim Number', 'Amount', 'Filed By', 'Status', 'Outcome', 'Filed', 'Days Open', 'Reason', 'Decision Notes']
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = [header.join(',')]
      for (const a of rows) {
        lines.push([
          a.claim?.claimNumber ?? '',
          a.claim?.invoiceAmount ?? '',
          a.filer?.name ?? '',
          a.status,
          a.outcome ?? '',
          formatDate(a.createdAt),
          slaInfo(a).daysOpen,
          a.reason ?? '',
          a.outcomeNotes ?? '',
        ].map(esc).join(','))
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `appeals-export-${formatDate(new Date())}.csv`
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${rows.length} appeals`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const openFileDialog = async () => {
    setFileOpen(true)
    setFileClaimId(''); setFileReason(''); setFileNotes('')
    setAppealableLoading(true)
    try {
      const [{ data: claimData }, { data: appealData }] = await Promise.all([
        api.get('/claims?status=rejected,fraud_confirmed&limit=100'),
        api.get('/appeals?status=pending&limit=200'),
      ])
      const list = claimData.claims ?? (Array.isArray(claimData) ? claimData : [])
      const blocked = new Set<string>([
        ...(appealData.appeals ?? []).map((a: any) => a.claimId),
        ...appeals.filter(a => a.status === 'pending' || a.status === 'under_review').map(a => a.claimId),
      ])
      setAppealable(list.filter((c: any) => !blocked.has(c.id)))
    } catch {
      toast.error('Could not load appealable claims')
      setAppealable([])
    } finally {
      setAppealableLoading(false)
    }
  }

  const fileAppeal = async () => {
    if (!fileClaimId || !fileReason.trim()) return
    setFiling(true)
    try {
      await api.post('/appeals', {
        claimId: fileClaimId,
        reason: fileReason.trim(),
        additionalNotes: fileNotes.trim() || undefined,
      })
      toast.success('Appeal filed — the claims team has been notified')
      setFileOpen(false)
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to file appeal')
    } finally {
      setFiling(false)
    }
  }

  // Unread map — recomputed when the list reloads or a thread is marked seen
  const unreadMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const a of appeals) m[a.id] = isUnread(a, user?.id)
    return m
  }, [appeals, seenVersion, user?.id])

  // Summary cards (current page snapshot)
  const overdueCount = useMemo(() => appeals.filter(a => slaInfo(a).overdue).length, [appeals])
  const summary = [
    { key: 'pending',      label: 'Pending',      value: appeals.filter(a => a.status === 'pending').length,      icon: Clock,         color: 'text-yellow-500', ring: 'hover:ring-yellow-300' },
    { key: 'under_review', label: 'Under Review', value: appeals.filter(a => a.status === 'under_review').length,  icon: AlertTriangle, color: 'text-blue-500',   ring: 'hover:ring-blue-300' },
    { key: 'finalised',    label: 'Finalised',    value: appeals.filter(a => a.status === 'finalised').length,    icon: CheckCircle,   color: 'text-gray-400',   ring: 'hover:ring-gray-300' },
    { key: 'overdue',      label: 'SLA Overdue',  value: overdueCount,                                            icon: Timer,         color: 'text-red-500',    ring: 'hover:ring-red-300' },
  ]

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = statusFilter !== 'all' || outcomeFilter !== 'all' || !!search || !!dateFrom || !!dateTo

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-blue-600" /> Appeals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{total} total · provider ↔ claims ↔ fraud</p>
        </div>
        <div className="flex items-center gap-2">
          {canFile && (
            <Button size="sm" onClick={openFileDialog}>
              <FilePlus2 className="h-4 w-4 mr-1" /> File Appeal
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="queue"><ListChecks className="h-4 w-4 mr-1" /> Queue</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</TabsTrigger>
        </TabsList>

        {/* ───────────── QUEUE TAB ───────────── */}
        <TabsContent value="queue" className="space-y-6 mt-4">
          {/* Summary cards — clickable filters */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {summary.map(s => {
              const Icon = s.icon
              const filterable = s.key !== 'overdue'
              const active = statusFilter === s.key && filterable
              return (
                <Card
                  key={s.label}
                  onClick={() => filterable && setStatusFilter(active ? 'all' : s.key)}
                  className={cn(
                    'transition-all ring-1 ring-transparent hover:shadow-md',
                    filterable && 'cursor-pointer',
                    s.ring,
                    active && 'ring-2 ring-blue-400 shadow-md',
                  )}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <Icon className={cn('h-8 w-8', s.color)} />
                    <div>
                      <div className="text-2xl font-bold leading-none">{s.value}</div>
                      <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Toolbar */}
          <Card>
            <div className="p-4 border-b space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search claim no., filer, reason…"
                    className="pl-8 h-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="finalised">Finalised</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
                  <SelectTrigger className="w-32 h-9 text-xs"><SelectValue placeholder="Outcome" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes</SelectItem>
                    <SelectItem value="upheld">Upheld</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={exporting}>
                  {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} Export CSV
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Filed between</span>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-40" />
                <span>and</span>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 w-40" />
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                    setStatusFilter('all'); setOutcomeFilter('all'); setSearch(''); setDateFrom(''); setDateTo('')
                  }}>Clear filters</Button>
                )}
              </div>
            </div>

            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="Invoice" />
                    <SortHead label="Amount" sortKey="amount" />
                    <TableHead>Filed By</TableHead>
                    <TableHead className="max-w-xs">Reason</TableHead>
                    <SortHead label="Status" sortKey="status" />
                    <SortHead label="Outcome" sortKey="outcome" />
                    <TableHead>SLA</TableHead>
                    <SortHead label="Filed" sortKey="filed" />
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && appeals.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </TableCell></TableRow>
                  )}
                  {!loading && appeals.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      <Inbox className="h-8 w-8 mx-auto opacity-30 mb-2" />
                      No appeals found
                    </TableCell></TableRow>
                  )}
                  {appeals.map(a => {
                    const unread = unreadMap[a.id]
                    return (
                      <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(a)}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {unread && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" title="New activity" />}
                            <button
                              className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                              onClick={e => { e.stopPropagation(); openClaim(a.claim?.claimNumber) }}
                              title="Open the underlying claim"
                            >
                              {a.claim?.claimNumber ?? '—'}
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {a.claim?.invoiceAmount != null ? formatCurrency(Number(a.claim.invoiceAmount)) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">{a.filer?.name ?? '—'}</TableCell>
                        <TableCell className="text-sm max-w-xs truncate" title={a.reason}>
                          <span className="inline-flex items-center gap-1">
                            {a.messageCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <MessageSquare className="h-3 w-3" />{a.messageCount}
                              </span>
                            )}
                            {a.reason}
                          </span>
                        </TableCell>
                        <TableCell><StatusPill status={a.status} /></TableCell>
                        <TableCell><OutcomePill outcome={a.outcome} /></TableCell>
                        <TableCell><SlaBadge appeal={a} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(a.createdAt)}</TableCell>
                        <TableCell className="text-right"><ChevronRight className="h-4 w-4 text-muted-foreground inline" /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between p-3 border-t text-xs text-muted-foreground">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
                  <span>Page {page + 1} / {pageCount}</span>
                  <Button variant="outline" size="sm" className="h-7" disabled={page + 1 >= pageCount || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ───────────── ANALYTICS TAB ───────────── */}
        <TabsContent value="analytics" className="mt-4">
          <AppealAnalytics active={tab === 'analytics'} />
        </TabsContent>
      </Tabs>

      {/* ── Detail Slide-over ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0" onClick={closeDetail} />
          <div className="relative h-full w-full max-w-2xl bg-background shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* Panel header */}
            <div className="shrink-0 border-b p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Gavel className="h-5 w-5 text-blue-600 shrink-0" />
                  <h2 className="text-lg font-bold truncate">Appeal</h2>
                  <StatusPill status={detail.status} />
                  {detail.outcome && <OutcomePill outcome={detail.outcome} />}
                  <SlaBadge appeal={detail} />
                </div>
                <button
                  className="mt-1 font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                  onClick={() => openClaim(detail.claim?.claimNumber)}
                >
                  {detail.claim?.claimNumber} <ExternalLink className="h-3 w-3" />
                </button>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={closeDetail}><X className="h-4 w-4" /></Button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Claim summary */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Claim
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openClaim(detail.claim?.claimNumber)}>
                    Open full claim <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div><span className="text-muted-foreground text-xs">Amount</span><div className="font-semibold tabular-nums">{detail.claim?.invoiceAmount != null ? formatCurrency(Number(detail.claim.invoiceAmount)) : '—'}</div></div>
                  <div><span className="text-muted-foreground text-xs">Claim status</span><div className="font-medium capitalize">{detail.claim?.status?.replace(/_/g, ' ') ?? '—'}</div></div>
                </div>
              </div>

              {/* Appeal meta */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs flex items-center gap-1"><User2 className="h-3 w-3" /> Filed by</span>
                    <div className="font-medium">{detail.filer?.name ?? '—'}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> Filed on</span>
                    <div className="font-medium">{formatDateTime(detail.createdAt)}</div>
                  </div>
                  {detail.adjudicator?.name && (
                    <div>
                      <span className="text-muted-foreground text-xs flex items-center gap-1"><Gavel className="h-3 w-3" /> Adjudicated by</span>
                      <div className="font-medium">{detail.adjudicator.name}</div>
                    </div>
                  )}
                  {detail.adjudicatedAt && (
                    <div>
                      <span className="text-muted-foreground text-xs">Decided on</span>
                      <div className="font-medium">{formatDateTime(detail.adjudicatedAt)}</div>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Reason for appeal</Label>
                  <p className="text-sm mt-1 p-2.5 bg-muted/50 rounded-md leading-relaxed">{detail.reason}</p>
                </div>
                {detail.additionalNotes && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Additional notes</Label>
                    <p className="text-sm mt-1 p-2.5 bg-muted/50 rounded-md leading-relaxed">{detail.additionalNotes}</p>
                  </div>
                )}
                {detail.outcomeNotes && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Decision notes</Label>
                    <p className={cn('text-sm mt-1 p-2.5 rounded-md leading-relaxed border',
                      detail.outcome === 'upheld'
                        ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800')}>{detail.outcomeNotes}</p>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <Timeline appeal={detail} />

              {/* Thread */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-semibold">Discussion thread</span>
                  <span className="text-xs text-muted-foreground">Provider · Claims · Fraud</span>
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3 min-h-[120px]">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                      <MessageSquare className="h-7 w-7 opacity-30" />
                      <p>No messages yet. {canMessage && detail.status !== 'finalised' ? 'Start the discussion below.' : ''}</p>
                    </div>
                  ) : messages.map(msg => {
                    const isOwn = msg.sender?.id === user?.id || msg.senderId === user?.id
                    const atts = Array.isArray(msg.attachments) ? msg.attachments : []
                    return (
                      <div key={msg.id} className={cn('flex flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                          <span className="font-medium text-foreground">{msg.sender?.name ?? '—'}</span>
                          <span>·</span>
                          <span>{roleLabel[msg.sender?.role ?? msg.senderRole] ?? msg.senderRole}</span>
                          <span>·</span>
                          <span>{formatDateTime(msg.createdAt)}</span>
                        </div>
                        <div className={cn('rounded-lg border px-3 py-2 text-sm max-w-[85%]',
                          isOwn ? 'bg-blue-600 text-white border-blue-700'
                                : (roleBubbleColor[msg.sender?.role ?? msg.senderRole] ?? 'bg-background border-border'))}>
                          {msg.message && <div className="whitespace-pre-wrap">{msg.message}</div>}
                          {atts.length > 0 && (
                            <div className={cn('mt-1.5 space-y-1', msg.message && 'pt-1.5 border-t', isOwn ? 'border-blue-400/40' : 'border-border/60')}>
                              {atts.map((att: any, i: number) => (
                                <button key={i} onClick={() => openAttachment(att)}
                                  className={cn('flex items-center gap-1.5 text-xs hover:underline w-full text-left', isOwn ? 'text-blue-50' : 'text-blue-600')}>
                                  <Paperclip className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{att.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {canMessage && detail.status !== 'finalised' && (
                  <div className="mt-2 space-y-2">
                    {pendingAtts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {pendingAtts.map((att, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded-full pl-2 pr-1 py-0.5 border">
                            <Paperclip className="h-3 w-3" />
                            <span className="max-w-[140px] truncate">{att.name}</span>
                            <button onClick={() => setPendingAtts(prev => prev.filter((_, j) => j !== i))} className="hover:text-red-500">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 items-end">
                      <input ref={fileInputRef} type="file" multiple className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv"
                        onChange={e => handleFilePick(e.target.files)} />
                      <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={uploading}
                        onClick={() => fileInputRef.current?.click()} title="Attach files">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      </Button>
                      <Textarea
                        placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                        rows={2}
                        className="resize-none flex-1 text-sm"
                      />
                      <Button onClick={sendMessage} disabled={(!newMessage.trim() && pendingAtts.length === 0) || sending} size="icon" className="h-10 w-10 shrink-0">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                )}
                {detail.status === 'finalised' && (
                  <p className="text-center text-xs text-muted-foreground py-2">This appeal is finalised — the thread is read-only.</p>
                )}
              </div>
            </div>

            {/* Panel footer — staff actions */}
            {isStaff && detail.status !== 'finalised' && (
              <div className="shrink-0 border-t p-4 space-y-3">
                {!deciding ? (
                  <div className="flex gap-2">
                    {detail.status === 'pending' && (
                      <Button variant="outline" className="flex-1" disabled={actioningId === detail.id} onClick={() => markUnderReview(detail.id)}>
                        {actioningId === detail.id
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Updating…</>
                          : <><AlertTriangle className="h-4 w-4 mr-1" /> Mark Under Review</>}
                      </Button>
                    )}
                    {canDecide && (
                      <Button className="flex-1" onClick={() => setDeciding(true)}><Gavel className="h-4 w-4 mr-1" /> Decide Appeal</Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold">Record decision</Label>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDeciding(false)}>Cancel</Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant={outcome === 'upheld' ? 'default' : 'outline'} className={cn('flex-1', outcome === 'upheld' && 'bg-green-600 hover:bg-green-700')} onClick={() => setOutcome('upheld')}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Uphold
                      </Button>
                      <Button variant={outcome === 'dismissed' ? 'default' : 'outline'} className={cn('flex-1', outcome === 'dismissed' && 'bg-red-600 hover:bg-red-700')} onClick={() => setOutcome('dismissed')}>
                        <XCircle className="h-4 w-4 mr-1" /> Dismiss
                      </Button>
                    </div>
                    {outcome === 'upheld' && (
                      <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 dark:border-green-800">
                        Invoice will be reinstated and routed to the claims officer queue for final approval.
                      </p>
                    )}
                    <Textarea rows={3} value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} placeholder="Explain your decision…" className="text-sm" />
                    <Button className={cn('w-full', outcome === 'upheld' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')} onClick={adjudicate} disabled={saving}>
                      {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'Confirm Decision'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── File Appeal Dialog ── */}
      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FilePlus2 className="h-5 w-5 text-blue-600" /> File an Appeal</DialogTitle>
            <DialogDescription>
              Appeal a rejected or fraud-confirmed invoice. The claims team and fraud officer
              will be notified and can respond in the discussion thread.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Claim to appeal</Label>
              {appealableLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading eligible claims…
                </div>
              ) : appealable.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No eligible claims. Only rejected or fraud-confirmed invoices without an active appeal can be appealed.
                </div>
              ) : (
                <Select value={fileClaimId} onValueChange={setFileClaimId}>
                  <SelectTrigger><SelectValue placeholder="Select a claim…" /></SelectTrigger>
                  <SelectContent>
                    {appealable.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="font-mono text-xs">{c.claimNumber}</span>
                        <span className="text-muted-foreground"> · {c.invoiceAmount != null ? formatCurrency(Number(c.invoiceAmount)) : '—'} · {c.status?.replace(/_/g, ' ')}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Reason for appeal <span className="text-red-500">*</span></Label>
              <Textarea rows={3} value={fileReason} onChange={e => setFileReason(e.target.value)} placeholder="Explain why this decision should be reconsidered…" className="text-sm" />
            </div>

            <div className="space-y-1.5">
              <Label>Additional notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea rows={2} value={fileNotes} onChange={e => setFileNotes(e.target.value)} placeholder="Reference numbers, supporting context, etc." className="text-sm" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFileOpen(false)}>Cancel</Button>
            <Button onClick={fileAppeal} disabled={filing || !fileClaimId || !fileReason.trim()}>
              {filing ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Filing…</> : <><FilePlus2 className="h-4 w-4 mr-1" /> Submit Appeal</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Vertical status timeline for an appeal. */
function Timeline({ appeal }: { appeal: any }) {
  const isFinal = appeal.status === 'finalised'
  const isReview = appeal.status === 'under_review' || isFinal
  const steps = [
    { label: 'Appeal filed', at: appeal.createdAt, done: true, icon: Inbox },
    { label: 'Under review', at: isReview ? appeal.updatedAt : null, done: isReview, icon: AlertTriangle },
    {
      label: isFinal ? `Finalised — ${appeal.outcome ?? ''}` : 'Decision',
      at: appeal.adjudicatedAt,
      done: isFinal,
      icon: isFinal && appeal.outcome === 'upheld' ? CheckCircle : isFinal ? XCircle : Gavel,
    },
  ]
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Progress</Label>
      <div className="mt-2 space-y-0">
        {steps.map((s, i) => {
          const Icon = s.done ? s.icon : CircleDot
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Icon className={cn('h-4 w-4', s.done ? 'text-blue-600' : 'text-muted-foreground/40')} />
                {i < steps.length - 1 && <div className={cn('w-px flex-1 my-0.5', s.done ? 'bg-blue-300' : 'bg-border')} />}
              </div>
              <div className={cn('pb-3 -mt-0.5', !s.done && 'opacity-50')}>
                <div className="text-sm font-medium capitalize">{s.label}</div>
                {s.at && <div className="text-xs text-muted-foreground">{formatDateTime(s.at)}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PIE_COLORS = ['#eab308', '#3b82f6', '#9ca3af']
const OUTCOME_COLORS = ['#22c55e', '#ef4444']

/** Analytics dashboard — fetches aggregate stats and renders charts. */
function AppealAnalytics({ active }: { active: boolean }) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    api.get('/appeals/analytics')
      .then(({ data }) => { if (!cancelled) setData(data) })
      .catch(() => { if (!cancelled) toast.error('Failed to load analytics') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active])

  if (loading || !data) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading analytics…</div>
  }

  const statusData = [
    { name: 'Pending', value: data.byStatus?.pending ?? 0 },
    { name: 'Under Review', value: data.byStatus?.under_review ?? 0 },
    { name: 'Finalised', value: data.byStatus?.finalised ?? 0 },
  ].filter(d => d.value > 0)
  const outcomeData = [
    { name: 'Upheld', value: data.byOutcome?.upheld ?? 0 },
    { name: 'Dismissed', value: data.byOutcome?.dismissed ?? 0 },
  ].filter(d => d.value > 0)

  const kpis = [
    { label: 'Total appeals', value: data.total, icon: ListChecks, color: 'text-blue-500' },
    { label: 'Upheld rate', value: `${data.upheldRate}%`, icon: ShieldCheck, color: 'text-green-500' },
    { label: 'Avg resolution', value: `${data.avgResolutionDays}d`, icon: TrendingUp, color: 'text-violet-500' },
    { label: `Overdue (>${data.slaDays}d)`, value: data.overdue, icon: Timer, color: 'text-red-500' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={cn('h-8 w-8', k.color)} />
                <div>
                  <div className="text-2xl font-bold leading-none">{k.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-2">Status breakdown</h3>
            {statusData.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-2">Outcome split</h3>
            {outcomeData.length === 0 ? <Empty hint="No finalised appeals yet" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={outcomeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                    {outcomeData.map((_, i) => <Cell key={i} fill={OUTCOME_COLORS[i % OUTCOME_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-2">Monthly trend</h3>
            {(!data.monthlyTrend || data.monthlyTrend.length === 0) ? <Empty /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip /><Legend />
                  <Bar dataKey="filed" name="Filed" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="upheld" name="Upheld" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="dismissed" name="Dismissed" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-2">By provider</h3>
            {(!data.byProvider || data.byProvider.length === 0) ? <Empty /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.byProvider} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="provider" width={120} fontSize={10} />
                  <Tooltip /><Legend />
                  <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="upheld" name="Upheld" fill="#22c55e" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Empty({ hint = 'No data yet' }: { hint?: string }) {
  return <div className="flex flex-col items-center justify-center h-[240px] text-muted-foreground text-sm gap-2"><BarChart3 className="h-8 w-8 opacity-30" />{hint}</div>
}
