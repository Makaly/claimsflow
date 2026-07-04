import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle, XCircle, FileText, Loader2, ChevronDown, ChevronRight,
  Building2, Calendar, Award, Handshake, Users, MessageSquare, History,
  Eye, Lock, BookOpen, FileSearch, CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/authStore'
import { ReviewPdfPager } from './ReviewPdfPager'
import api from '@/services/api'

interface ReadinessEntry {
  viewedPages: number[]
  pageCount: number
  complete: boolean
}

interface ActiveDoc {
  id: string
  fileName: string
  mimeType?: string
  status: string
  version?: number
  reviewComment?: string
}

/**
 * Split-pane review workspace for the admin approval flow.
 *
 * Left panel  — collapsible section list; each document row shows a
 *               progress pill and per-doc Approve / Return buttons that
 *               unlock only after every page is read.
 *
 * Right panel — full-height PDF / image viewer for the selected document;
 *               every page-turn is recorded in the audit trail.
 *
 * The overall Approve button (in ProviderDecisionBar) is locked until
 * readyToApprove=true, surfaced via the onReadinessChange callback.
 */
export function OnboardingPacketReview({
  providerId,
  onReadinessChange,
}: {
  providerId: string
  onReadinessChange?: (ready: boolean, completed: number, total: number) => void
}) {
  const { user } = useAuthStore()
  const isReviewer = user?.role === 'admin' || user?.role === 'claims_officer'

  const [packet, setPacket] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [readiness, setReadiness] = useState<Record<string, ReadinessEntry>>({})
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null)

  // Per-doc action state
  const [busyDocId, setBusyDocId] = useState<string | null>(null)
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const refresh = useCallback(async () => {
    const { data } = await api.get(`/providers/${providerId}/onboarding-packet`)
    setPacket(data)
  }, [providerId])

  const fetchReadiness = useCallback(async () => {
    try {
      const { data } = await api.get(`/providers/${providerId}/review-readiness`)
      const map: Record<string, ReadinessEntry> = {}
      for (const d of data.documents ?? []) {
        map[d.id] = { viewedPages: d.viewedPages, pageCount: d.pageCount, complete: d.complete }
      }
      setReadiness(map)
      onReadinessChange?.(data.readyToApprove, data.completedDocuments, data.totalDocuments)
    } catch { /* non-fatal */ }
  }, [providerId, onReadinessChange])

  // StrictMode double-mounts effects in dev; guard against double-fetch
  // using a ref so the API call only fires once per providerId. We deliberately
  // do NOT cancel the in-flight request on cleanup — StrictMode's synthetic
  // unmount would otherwise leave loading=true forever.
  const fetchedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (fetchedForRef.current === providerId) return
    fetchedForRef.current = providerId
    setLoading(true)
    Promise.all([refresh(), fetchReadiness()])
      .finally(() => setLoading(false))
  }, [providerId, refresh, fetchReadiness])

  const handlePageView = useCallback(async (docId: string, page: number) => {
    await api.post(`/providers/${providerId}/onboarding-documents/${docId}/page-view`, { pageNumber: page })
    setReadiness(prev => {
      const entry = prev[docId]
      if (!entry || entry.viewedPages.includes(page)) return prev
      const viewedPages = [...entry.viewedPages, page]
      const complete = viewedPages.length >= entry.pageCount
      const next = { ...prev, [docId]: { ...entry, viewedPages, complete } }
      const totalDocs = Object.keys(next).length
      const completedDocs = Object.values(next).filter(e => e.complete).length
      onReadinessChange?.(completedDocs === totalDocs && totalDocs > 0, completedDocs, totalDocs)
      return next
    })
  }, [providerId, onReadinessChange])

  const approveDoc = async (docId: string) => {
    setBusyDocId(docId)
    try {
      const { data: updated } = await api.post(
        `/providers/${providerId}/onboarding-documents/${docId}/approve`,
        { comment: '' },
      )
      patchDoc(updated)
      if (activeDoc?.id === docId) setActiveDoc(a => a ? { ...a, status: updated.status } : a)
      toast.success('Document approved')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not approve')
    } finally { setBusyDocId(null) }
  }

  const submitDocReject = async (docId: string) => {
    if (!rejectReason.trim()) { toast.error('Reason is required'); return }
    setBusyDocId(docId)
    try {
      const { data: updated } = await api.post(
        `/providers/${providerId}/onboarding-documents/${docId}/reject`,
        { reason: rejectReason },
      )
      patchDoc(updated)
      if (activeDoc?.id === docId) setActiveDoc(a => a ? { ...a, status: updated.status, reviewComment: updated.reviewComment } : a)
      setRejectingDocId(null); setRejectReason('')
      toast.success('Document rejected — provider notified')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not reject')
    } finally { setBusyDocId(null) }
  }

  const patchDoc = (updated: any) => {
    setPacket((p: any) => {
      if (!p) return p
      const swap = (arr: any[] | undefined) =>
        Array.isArray(arr) ? arr.map(d => d.id === updated.id ? { ...d, ...updated } : d) : arr
      const s = p.sections
      return {
        ...p, sections: {
          ...s,
          a_companyProfile:   { ...s.a_companyProfile,   documents: swap(s.a_companyProfile.documents) },
          b_yearsOfExperience:{ ...s.b_yearsOfExperience, documents: swap(s.b_yearsOfExperience.documents) },
          d_certifications:   { ...s.d_certifications,   firmDocuments: swap(s.d_certifications.firmDocuments), staffDocuments: swap(s.d_certifications.staffDocuments) },
          f_programOfWorks:   { ...s.f_programOfWorks,   documents: swap(s.f_programOfWorks.documents) },
        },
      }
    })
  }

  if (loading) return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading onboarding packet…
    </div>
  )
  if (!packet) return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground italic">
      Could not load onboarding packet.
    </div>
  )

  const s = packet.sections
  const totalDocs = Object.keys(readiness).length
  const completedDocs = Object.values(readiness).filter(e => e.complete).length

  // All document rows across every section — passed to the left panel
  const allDocRows = [
    ...s.a_companyProfile.documents,
    ...s.b_yearsOfExperience.documents,
    ...s.d_certifications.firmDocuments,
    ...s.d_certifications.staffDocuments,
    ...s.f_programOfWorks.documents,
  ]

  const docActionProps = {
    providerId, readiness, isReviewer, busyDocId,
    rejectingDocId, setRejectingDocId, rejectReason, setRejectReason,
    onApprove: approveDoc, onReject: submitDocReject,
    activeDocId: activeDoc?.id ?? null,
    onSelectDoc: (doc: ActiveDoc) => setActiveDoc(prev => prev?.id === doc.id ? null : doc),
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── LEFT PANEL: section list ──────────────────────────────────── */}
      <div className="w-[380px] shrink-0 flex flex-col border-r overflow-hidden">

        {/* Panel header */}
        <div className="px-4 py-3 border-b bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Onboarding Packet</p>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {packet.onboardingSubmittedAt
                ? <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px]">SUBMITTED</Badge>
                : <Badge variant="outline" className="text-[10px]">DRAFT</Badge>}
              {totalDocs > 0 && (
                completedDocs === totalDocs
                  ? <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px] gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" /> All read
                    </Badge>
                  : <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px] gap-1">
                      <BookOpen className="h-2.5 w-2.5" /> {completedDocs}/{totalDocs} read
                    </Badge>
              )}
            </div>
          </div>
          {/* Provider note */}
          {packet.providerNote && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-[11px]">
              <MessageSquare className="h-3 w-3 text-sky-500 shrink-0 mt-0.5" />
              <span className="italic text-sky-700 dark:text-sky-300">"{packet.providerNote}"</span>
            </div>
          )}
          {/* Reading gate hint */}
          {isReviewer && completedDocs < totalDocs && totalDocs > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              <Lock className="h-3 w-3 shrink-0" />
              <span>Click a document to open viewer → read all pages to unlock Approve</span>
            </div>
          )}
        </div>

        {/* Scrollable section list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <SectionRow letter="a" title="Company Profile" icon={Building2} complete={s.a_companyProfile.complete}>
            <InfoLine label="Structure" value={s.a_companyProfile.companyStructure} />
            <DocList docs={s.a_companyProfile.documents} {...docActionProps} />
          </SectionRow>

          <SectionRow letter="b" title="Years of Experience" icon={Calendar} complete={s.b_yearsOfExperience.complete}>
            <InfoLine label="Years" value={s.b_yearsOfExperience.yearsProvidingServices} />
            <DocList docs={s.b_yearsOfExperience.documents} {...docActionProps} />
          </SectionRow>

          <SectionRow letter="c" title="Scope Understanding" icon={FileText} complete={s.c_scopeUnderstanding.complete}>
            <div className="text-[11px] whitespace-pre-wrap bg-muted/40 border rounded p-2 max-h-28 overflow-y-auto leading-relaxed">
              {s.c_scopeUnderstanding.scopeUnderstanding || <em className="text-destructive">not provided</em>}
            </div>
          </SectionRow>

          <SectionRow letter="d" title="Certifications" icon={Award} complete={s.d_certifications.complete}>
            <p className="text-[10px] text-muted-foreground font-medium mb-1">Firm level</p>
            <DocList docs={s.d_certifications.firmDocuments} {...docActionProps} />
            <p className="text-[10px] text-muted-foreground font-medium mb-1 mt-2">Staff level</p>
            <DocList docs={s.d_certifications.staffDocuments} {...docActionProps} />
          </SectionRow>

          <SectionRow letter="e" title="References" icon={Handshake} complete={s.e_references.complete}>
            {s.e_references.references.length === 0
              ? <em className="text-[11px] text-destructive">no references</em>
              : s.e_references.references.map((r: any) => (
                  <div key={r.id} className="bg-muted/30 border rounded p-2 text-[11px] space-y-0.5 mb-1.5">
                    <div className="font-semibold">{r.clientName}</div>
                    <div className="text-muted-foreground">{r.contactPerson}{r.contactEmail && ` · ${r.contactEmail}`}</div>
                    <div>{new Date(r.engagementStartDate).toLocaleDateString()} – {r.engagementEndDate ? new Date(r.engagementEndDate).toLocaleDateString() : 'ongoing'}</div>
                    <div className="text-muted-foreground">{r.servicesProvided}</div>
                  </div>
                ))
            }
          </SectionRow>

          <SectionRow letter="f" title="Program of Works" icon={Users} complete={s.f_programOfWorks.complete}>
            {s.f_programOfWorks.programOfWorksText && (
              <div className="text-[11px] whitespace-pre-wrap bg-muted/40 border rounded p-2 max-h-24 overflow-y-auto mb-1.5">
                {s.f_programOfWorks.programOfWorksText}
              </div>
            )}
            <DocList docs={s.f_programOfWorks.documents} {...docActionProps} />
          </SectionRow>

          {/* (g) Registration document — official certificate of incorporation
              or business permit. Stored on the provider record itself, so we
              render a plain status row instead of an audited DocList. */}
          <SectionRow letter="g" title="Registration Document" icon={FileText} complete={!!s.g_registrationDocument?.complete}>
            {s.g_registrationDocument?.complete ? (
              <a
                href={`/api/providers/${providerId}/document`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border bg-muted/20 hover:bg-muted/40 px-2.5 py-2 text-[11px] transition-colors"
              >
                <FileText className="h-3 w-3 text-emerald-500 shrink-0" />
                <span className="flex-1 truncate font-medium text-foreground">
                  {s.g_registrationDocument.proofDocumentName || 'Registration document'}
                </span>
                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase">Open ↗</span>
              </a>
            ) : (
              <em className="text-[11px] text-destructive">no registration document uploaded</em>
            )}
          </SectionRow>

          {/* (h) Supplementary / "other" documents the provider attached.
              These still count toward the overall read-all-pages gate. */}
          {s.h_otherDocuments?.documents?.length > 0 && (
            <SectionRow letter="h" title="Other documents" icon={FileText} complete={true}>
              <DocList docs={s.h_otherDocuments.documents} {...docActionProps} />
            </SectionRow>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: document viewer ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-muted/10">
        {activeDoc ? (
          <>
            {/* Viewer header */}
            <div className="px-4 py-3 border-b bg-background shrink-0 flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{activeDoc.fileName}</p>
                {activeDoc.version && activeDoc.version > 1 && (
                  <span className="text-[10px] text-purple-500">Version {activeDoc.version}</span>
                )}
              </div>

              {/* Progress pill */}
              {readiness[activeDoc.id] && (
                readiness[activeDoc.id].complete
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                      <CheckCircle className="h-3 w-3" /> All {readiness[activeDoc.id].pageCount} pages read
                    </span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-600 shrink-0">
                      <BookOpen className="h-3 w-3" />
                      {readiness[activeDoc.id].viewedPages.length}/{readiness[activeDoc.id].pageCount} pages read
                    </span>
              )}

              {/* Status badge */}
              <Badge className={`text-[10px] shrink-0 capitalize ${
                activeDoc.status === 'approved' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                : activeDoc.status === 'rejected' ? 'bg-red-500/15 text-red-500 border-red-500/30'
                : 'bg-amber-500/15 text-amber-500 border-amber-500/30'
              }`}>{activeDoc.status}</Badge>

              {/* Action buttons — locked until fully read */}
              {isReviewer && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {rejectingDocId !== activeDoc.id ? (
                    <>
                      <Button
                        size="sm"
                        className={`h-7 text-xs gap-1.5 ${
                          readiness[activeDoc.id]?.complete
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground'
                        }`}
                        disabled={!!busyDocId || !readiness[activeDoc.id]?.complete}
                        onClick={() => readiness[activeDoc.id]?.complete && approveDoc(activeDoc.id)}
                        title={readiness[activeDoc.id]?.complete ? 'Approve this document' : 'Read all pages first'}
                      >
                        {busyDocId === activeDoc.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : readiness[activeDoc.id]?.complete
                            ? <CheckCircle className="h-3 w-3" />
                            : <Lock className="h-3 w-3" />}
                        Approve
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className={`h-7 text-xs gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 ${
                          !readiness[activeDoc.id]?.complete ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                        disabled={!!busyDocId || !readiness[activeDoc.id]?.complete}
                        onClick={() => readiness[activeDoc.id]?.complete && (setRejectingDocId(activeDoc.id), setRejectReason(''))}
                        title={readiness[activeDoc.id]?.complete ? 'Return to provider for correction' : 'Read all pages first'}
                      >
                        <History className="h-3 w-3" />
                        Return
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Rejection reason…"
                        className="h-7 w-48 text-xs"
                      />
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => { setRejectingDocId(null); setRejectReason('') }}>Cancel</Button>
                      <Button size="sm" variant="destructive" className="h-7 text-xs"
                        disabled={!!busyDocId || !rejectReason.trim()}
                        onClick={() => submitDocReject(activeDoc.id)}>
                        {busyDocId === activeDoc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        <span className="ml-1">Send</span>
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reviewer comment strip */}
            {activeDoc.reviewComment && (
              <div className={`flex items-start gap-2 px-4 py-2 text-[11px] border-b shrink-0 ${
                activeDoc.status === 'rejected' ? 'bg-red-500/5 text-red-500' : 'bg-muted/30 text-muted-foreground'
              }`}>
                <MessageSquare className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{activeDoc.reviewComment}</span>
              </div>
            )}

            {/* PDF / image viewer */}
            <div className="flex-1 overflow-y-auto p-4">
              {(activeDoc.mimeType === 'application/pdf' || activeDoc.fileName?.toLowerCase().endsWith('.pdf')) ? (
                <ReviewPdfPager
                  url={`/api/providers/${providerId}/onboarding-documents/${activeDoc.id}/file`}
                  alreadyViewed={readiness[activeDoc.id]?.viewedPages ?? []}
                  onLoadPages={() => {}}
                  onPageView={page => handlePageView(activeDoc.id, page)}
                />
              ) : activeDoc.mimeType?.startsWith('image/') ? (
                <ImageViewer
                  url={`/api/providers/${providerId}/onboarding-documents/${activeDoc.id}/file`}
                  docId={activeDoc.id}
                  alreadyViewed={readiness[activeDoc.id]?.viewedPages ?? []}
                  onView={() => handlePageView(activeDoc.id, 1)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <FileText className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Preview not available for this file type.</p>
                  <a
                    href={`/api/providers/${providerId}/onboarding-documents/${activeDoc.id}/file`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sm text-primary underline"
                    onClick={() => handlePageView(activeDoc.id, 1)}
                  >
                    Download / open externally
                  </a>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground p-8">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <FileSearch className="h-9 w-9 opacity-40" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Select a document to review</p>
              <p className="text-xs opacity-70">
                Click any document name in the left panel to open it here.<br />
                You must read every page before the Approve button unlocks.
              </p>
            </div>
            {totalDocs > 0 && (
              <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-xs">
                <BookOpen className="h-3.5 w-3.5" />
                {completedDocs}/{totalDocs} documents fully read
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionRow({ letter, title, icon: Icon, complete, children }: {
  letter: string; title: string; icon: any; complete: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        {complete
          ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          : <XCircle className="h-3.5 w-3.5 text-destructive/60 shrink-0" />}
        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground">({letter})</span>
        <span className="text-xs font-semibold flex-1 truncate">{title}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1.5 border-t space-y-1.5">{children}</div>}
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: any }) {
  if (value == null) return null
  return (
    <div className="text-[11px]">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  )
}

interface DocListProps {
  docs: any[]
  providerId: string
  readiness: Record<string, ReadinessEntry>
  isReviewer: boolean
  busyDocId: string | null
  rejectingDocId: string | null
  setRejectingDocId: (id: string | null) => void
  rejectReason: string
  setRejectReason: (s: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  activeDocId: string | null
  onSelectDoc: (doc: ActiveDoc) => void
}

function DocList({ docs, readiness, activeDocId, onSelectDoc, isReviewer, busyDocId }: DocListProps) {
  if (!docs || docs.length === 0) return <em className="text-[11px] text-destructive">no documents</em>
  return (
    <div className="space-y-1">
      {docs.map(d => {
        const rEntry = readiness[d.id]
        const viewed = rEntry?.viewedPages?.length ?? 0
        const total = rEntry?.pageCount ?? (d.pageCount ?? 1)
        const docComplete = rEntry?.complete ?? false
        const isActive = activeDocId === d.id
        const status: string = d.status || 'pending'

        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelectDoc({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, status, version: d.version, reviewComment: d.reviewComment })}
            className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors text-[11px] border ${
              isActive
                ? 'bg-primary/10 border-primary/40 text-foreground'
                : 'bg-muted/20 border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className={`h-3 w-3 shrink-0 ${isActive ? 'text-primary' : 'opacity-40'}`} />
            <span className="flex-1 truncate font-medium">{d.fileName}</span>
            {d.version && d.version > 1 && (
              <span className="rounded-full bg-purple-500/15 px-1 text-[9px] text-purple-500">v{d.version}</span>
            )}

            {/* Progress pill */}
            {rEntry ? (
              docComplete
                ? <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-600 shrink-0">✓{total}p</span>
                : <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-600 shrink-0">{viewed}/{total}p</span>
            ) : null}

            {/* Status dot */}
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              status === 'approved' ? 'bg-emerald-500'
              : status === 'rejected' ? 'bg-red-500'
              : 'bg-amber-400'
            }`} />

            {/* Lock when not fully read */}
            {isReviewer && !docComplete && (
              <Lock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            )}
          </button>
        )
      })}
    </div>
  )
}

function ImageViewer({ url, docId, alreadyViewed, onView }: {
  url: string; docId: string; alreadyViewed: number[]; onView: () => void
}) {
  useEffect(() => {
    if (!alreadyViewed.includes(1)) onView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])
  return (
    <div className="flex items-start justify-center">
      <img src={url} alt="Onboarding document" className="max-w-full rounded shadow-md" />
    </div>
  )
}
