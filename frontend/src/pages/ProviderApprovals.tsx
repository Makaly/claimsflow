import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2, CheckCircle, XCircle, Eye, MapPin, Phone, Mail, Loader2, RefreshCw,
  Clock, FileText, AlertTriangle, ChevronRight, ShieldCheck, FileWarning, Image as ImageIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'
import api from '@/services/api'
import { ReviewPdfPager } from '@/components/ReviewPdfPager'

interface PendingProvider {
  id: string
  name: string
  type: string
  licenseNumber?: string
  contactPerson?: string
  email?: string
  phone?: string
  physicalAddress?: string
  city?: string
  region?: string
  appliedAt?: string
  createdAt?: string
  approvalStatus?: string
  companyStructure?: string
  registrationNumber?: string
  kraPin?: string
  yearsProvidingServices?: number
}

interface ReadinessDoc {
  id: string
  category: string
  fileName: string
  mimeType?: string
  pageCount: number
  viewedPages: number[]
  complete: boolean
}
interface Readiness {
  providerId: string
  documents: ReadinessDoc[]
  totalDocuments: number
  completedDocuments: number
  readyToApprove: boolean
}

const typeColors: Record<string, string> = {
  hospital: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  clinic:   'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  pharmacy: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  lab:      'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
}

const CATEGORY_LABELS: Record<string, string> = {
  company_profile:      '(a) Company profile',
  experience_evidence:  '(b) Experience evidence',
  firm_certifications:  '(d) Firm certifications',
  staff_certifications: '(d) Staff certifications',
  program_of_works:     '(f) Program of works',
  other:                'Other supporting documents',
}

export default function ProviderApprovals() {
  const [providers, setProviders] = useState<PendingProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reviewing, setReviewing] = useState<PendingProvider | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchProviders = async () => {
    try {
      const { data } = await api.get('/providers/approvals/pending')
      const list = Array.isArray(data) ? data : Array.isArray(data?.providers) ? data.providers : []
      setProviders(list)
    } catch { setProviders([]) }
  }
  useEffect(() => { fetchProviders().finally(() => setLoading(false)) }, [])

  const refresh = async () => { setRefreshing(true); await fetchProviders(); setRefreshing(false) }

  const filtered = useMemo(() => providers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.region || '').toLowerCase().includes(search.toLowerCase())
  ), [providers, search])

  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  const stats = {
    total: providers.length,
    hospitals: providers.filter(p => p.type === 'hospital' || p.type === 'clinic').length,
    labs: providers.filter(p => p.type === 'lab' || p.type === 'pharmacy').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Approvals</h1>
          <p className="text-muted-foreground">Review onboarding packets and approve new healthcare providers.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Pending approval',     value: stats.total, color: 'text-blue-500' },
          { label: 'Hospitals / clinics',  value: stats.hospitals, color: 'text-green-500' },
          { label: 'Labs / pharmacies',    value: stats.labs, color: 'text-purple-500' },
          { label: 'Avg wait (days)',      value: providers.length > 0
            ? Math.round(providers.reduce((s, p) => s + (Date.now() - new Date(p.appliedAt || p.createdAt || Date.now()).getTime()), 0) / providers.length / 86400000)
            : 0, color: 'text-amber-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`mt-0.5 text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search providers, cities, regions…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading pending providers…
        </div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="flex h-40 items-center justify-center text-muted-foreground">
          {search ? 'No providers match search' : 'No pending provider approvals'}
        </CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {visible.map(provider => {
            const appliedAt = provider.appliedAt || provider.createdAt
            const waitDays = appliedAt ? Math.round((Date.now() - new Date(appliedAt).getTime()) / 86400000) : 0
            return (
              <Card key={provider.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-1 items-start gap-4">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${typeColors[provider.type] ?? 'bg-gray-100 text-gray-700'}`}>
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold">{provider.name}</h3>
                          <Badge className={typeColors[provider.type] ?? ''} variant="secondary">{provider.type}</Badge>
                          {waitDays > 14 && (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              <Clock className="mr-1 h-2.5 w-2.5" />{waitDays}d waiting
                            </Badge>
                          )}
                        </div>
                        {provider.licenseNumber && <p className="mt-0.5 font-mono text-sm text-muted-foreground">{provider.licenseNumber}</p>}
                        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                          {provider.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3 w-3 shrink-0" />{provider.email}</div>}
                          {provider.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3 w-3 shrink-0" />{provider.phone}</div>}
                          {(provider.city || provider.region) && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" />{[provider.city, provider.region].filter(Boolean).join(', ')}</div>}
                          {provider.contactPerson && <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="h-3 w-3 shrink-0" />{provider.contactPerson}</div>}
                        </div>
                        {appliedAt && <p className="mt-2 text-xs text-muted-foreground">Applied: {formatDate(appliedAt)}</p>}
                      </div>
                    </div>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setReviewing(provider)}>
                      Review packet <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          <Pagination
            page={page} pageSize={pageSize} total={filtered.length}
            onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
          />
        </div>
      )}

      {reviewing && (
        <ReviewWorkspace
          provider={reviewing}
          onClose={() => setReviewing(null)}
          onDecision={() => {
            setProviders((prev) => prev.filter((p) => p.id !== reviewing.id))
            setReviewing(null)
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Review workspace — provider details + packet + per-page tracking + decision
// ──────────────────────────────────────────────────────────────────────────
function ReviewWorkspace({
  provider, onClose, onDecision,
}: {
  provider: PendingProvider
  onClose: () => void
  onDecision: () => void
}) {
  const [packet, setPacket] = useState<any>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadAll = async () => {
    const [packetRes, readinessRes] = await Promise.all([
      api.get(`/providers/${provider.id}/onboarding-packet`),
      api.get(`/providers/${provider.id}/review-readiness`),
    ])
    setPacket(packetRes.data)
    setReadiness(readinessRes.data)
  }
  useEffect(() => { loadAll() }, [provider.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const reportPageView = async (docId: string, pageNumber: number) => {
    try {
      await api.post(`/providers/${provider.id}/onboarding-documents/${docId}/page-view`, { pageNumber })
      // Refresh readiness so the green check appears immediately.
      const { data } = await api.get(`/providers/${provider.id}/review-readiness`)
      setReadiness(data)
    } catch { /* one missed event is fine — the next page change retries */ }
  }

  const approve = async () => {
    if (!comment.trim()) { toast.error('Approval comment is required'); return }
    setSubmitting(true)
    try {
      await api.post(`/providers/${provider.id}/approve`, { comment })
      toast.success(`${provider.name} approved.`)
      onDecision()
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.code === 'review_incomplete') {
        toast.error('You must view every page of every document before approving.')
      } else {
        toast.error(data?.message || 'Failed to approve')
      }
    } finally { setSubmitting(false) }
  }

  const reject = async () => {
    if (!reason.trim()) { toast.error('A rejection reason is required'); return }
    setSubmitting(true)
    try {
      await api.post(`/providers/${provider.id}/reject`, { reason, comment: comment.trim() || undefined })
      toast.success(`${provider.name} rejected.`)
      onDecision()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to reject')
    } finally { setSubmitting(false) }
  }

  const activeDoc = readiness?.documents.find((d) => d.id === activeDocId)
  const docUrl = activeDoc
    ? `${(import.meta as any).env?.VITE_API_URL || '/api'}/providers/${provider.id}/onboarding-documents/${activeDoc.id}/file`
    : ''

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg">{provider.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {provider.type} · {provider.licenseNumber || '—'}
                {provider.kraPin ? ` · KRA ${provider.kraPin}` : ''}
              </p>
            </div>
            {readiness && (
              <Badge className={readiness.readyToApprove
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}>
                <ShieldCheck className="mr-1 h-3 w-3" />
                {readiness.completedDocuments} / {readiness.totalDocuments} documents fully reviewed
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="grid h-[calc(92vh-180px)] grid-cols-12 overflow-hidden">
          {/* LEFT: packet summary + document list */}
          <div className="col-span-12 overflow-y-auto border-r p-4 md:col-span-5 lg:col-span-4">
            {!packet || !readiness ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
              <>
                <SectionTitle>Profile</SectionTitle>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Row label="Contact"  value={provider.contactPerson} />
                  <Row label="Email"    value={provider.email} />
                  <Row label="Phone"    value={provider.phone} />
                  <Row label="Region"   value={[provider.city, provider.region].filter(Boolean).join(', ')} />
                  <Row label="Structure" value={provider.companyStructure?.replace(/_/g, ' ')} />
                  <Row label="Years"    value={provider.yearsProvidingServices?.toString()} />
                </div>

                <SectionTitle className="mt-5">Onboarding sections</SectionTitle>
                <div className="grid gap-1.5">
                  {Object.entries(packet.sections).map(([k, v]: [string, any]) => (
                    <div key={k} className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${v.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                      <span>{sectionLabel(k)}</span>
                      {v.complete ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    </div>
                  ))}
                </div>

                <SectionTitle className="mt-5">Documents — per-page review</SectionTitle>
                <div className="grid gap-2">
                  {readiness.documents.length === 0 && (
                    <p className="text-xs text-muted-foreground">No documents uploaded.</p>
                  )}
                  {readiness.documents.map((d) => {
                    const isImage = d.mimeType?.startsWith('image/')
                    const Icon = isImage ? ImageIcon : FileText
                    return (
                      <button
                        key={d.id}
                        onClick={() => setActiveDocId(d.id)}
                        className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                          activeDocId === d.id
                            ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                            : 'border-muted hover:border-blue-200 hover:bg-muted/40'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium uppercase text-muted-foreground">{CATEGORY_LABELS[d.category] || d.category}</span>
                          </div>
                          <p className="mt-0.5 truncate text-sm">{d.fileName}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {d.viewedPages.length} / {d.pageCount} page{d.pageCount === 1 ? '' : 's'} viewed
                          </p>
                        </div>
                        {d.complete
                          ? <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                          : <FileWarning className="h-4 w-4 shrink-0 text-amber-500" />}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* RIGHT: document viewer + decision panel */}
          <div className="col-span-12 flex flex-col overflow-hidden md:col-span-7 lg:col-span-8">
            <div className="flex-1 overflow-y-auto p-4">
              {!activeDoc ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <Eye className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Select a document to begin review.</p>
                  <p className="max-w-sm text-xs">You must scroll through every page of every uploaded document — the audit log records each acknowledgement — before the Approve button unlocks.</p>
                </div>
              ) : activeDoc.mimeType === 'application/pdf' ? (
                <ReviewPdfPager
                  url={docUrl}
                  alreadyViewed={activeDoc.viewedPages}
                  onPageView={(p) => reportPageView(activeDoc.id, p)}
                />
              ) : (
                <ImageReviewer
                  url={docUrl}
                  alreadyViewed={activeDoc.viewedPages}
                  onAck={() => reportPageView(activeDoc.id, 1)}
                />
              )}
            </div>

            <Separator />
            <div className="space-y-3 border-t bg-muted/30 p-4">
              <div>
                <Label className="text-xs">Approval comment <span className="text-destructive">*</span></Label>
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="What did you verify? Any conditions attached to this approval?" />
              </div>
              {decision === 'reject' && (
                <div>
                  <Label className="text-xs">Rejection reason (sent to provider) <span className="text-destructive">*</span></Label>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain why the application cannot be approved as submitted…" />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={onClose}>Close</Button>
                <div className="flex gap-2">
                  {decision !== 'reject' ? (
                    <Button variant="outline" onClick={() => { setDecision('reject') }}>
                      <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject…
                    </Button>
                  ) : (
                    <Button variant="destructive" onClick={reject} disabled={submitting || !reason.trim()}>
                      {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                      Confirm rejection
                    </Button>
                  )}
                  <Button className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={submitting || !readiness?.readyToApprove || !comment.trim()}
                    onClick={approve}>
                    {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                    Approve
                  </Button>
                </div>
              </div>
              {readiness && !readiness.readyToApprove && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Approve unlocks once every page of every uploaded document is acknowledged.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────
function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}>{children}</p>
}
function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate">{value || '—'}</p>
    </div>
  )
}
function sectionLabel(k: string): string {
  switch (k) {
    case 'a_companyProfile':     return '(a) Company profile'
    case 'b_yearsOfExperience':  return '(b) Years of experience'
    case 'c_scopeUnderstanding': return '(c) Scope understanding'
    case 'd_certifications':     return '(d) Certifications'
    case 'e_references':         return '(e) References'
    case 'f_programOfWorks':     return '(f) Program of works'
    default:                     return k
  }
}

/** Single-page image preview with an explicit "I have reviewed this image"
 *  click — images have no pagination so we treat acknowledgement as 1/1. */
function ImageReviewer({ url, alreadyViewed, onAck }: { url: string; alreadyViewed: number[]; onAck: () => void }) {
  const [acked, setAcked] = useState(alreadyViewed.includes(1))
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3 text-center">
        <img src={url} alt="" className="mx-auto max-h-[60vh] rounded shadow-sm" />
      </div>
      <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
        <span className="text-muted-foreground">Image documents count as 1 page.</span>
        {acked
          ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-4 w-4" /> Acknowledged</span>
          : <Button size="sm" variant="outline" onClick={() => { setAcked(true); onAck() }}>
              <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Mark as reviewed
            </Button>}
      </div>
    </div>
  )
}
