/**
 * InvoiceBillingAudit
 *
 * Presents every line item from the medical invoice in a structured audit
 * table annotated with clinical-appropriateness verdicts.  Results are
 * persisted to the database on first run and served from cache thereafter
 * — Gemini is called at most once per claim, not on every page view.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  CheckCircle2, XCircle, HelpCircle, Stethoscope,
  AlertTriangle, Loader2, ShieldAlert, ShieldCheck,
  Flag, RefreshCw, Clock, Maximize2, ChevronDown, ChevronUp, Gauge, Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import api from '@/services/api'

// ── types ──────────────────────────────────────────────────────────────────

interface ReceiptItem {
  description:    string
  quantity?:      number | null
  unitPrice?:     number | null
  totalPrice?:    number | null
  taxAmount?:     number | null
  serviceDate?:   string | null
  procedureCode?: string | null
}

interface AssessedItem {
  name:          string
  match:         'match' | 'mismatch' | 'uncertain'
  score:         number
  reason:        string
  quantity?:     number | null
  unitPrice?:    number | null
  amount?:       number | null
  procedureCode?: string | null
  enriched?:     boolean
}

interface Assessment {
  diagnosis:    string
  items:        AssessedItem[]
  overall:      'match' | 'partial' | 'mismatch' | 'uncertain'
  overallScore: number
  summary:      string
  cachedAt?:    string   // ISO string if served from DB cache
}

export interface Props {
  claimId?:   string
  diagnosis?: string
  treatment?: string
  lineItems?: ReceiptItem[]
  rawText?:   string
  /** Document URL — upload stage only. Lets the audit read the invoice image
   *  directly (vision) when text extraction finds no line items. */
  fileUrl?:   string
}

// ── helpers ────────────────────────────────────────────────────────────────

const MATCH = {
  match: {
    icon: CheckCircle2,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg:   'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-800/40',
    pill: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/50',
    label: 'Appropriate',
  },
  mismatch: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bg:   'bg-red-50 dark:bg-red-950/20 border-red-300/60 dark:border-red-700/40',
    pill: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-300/60 dark:border-red-700/50',
    label: 'Unrelated',
  },
  uncertain: {
    icon: HelpCircle,
    color: 'text-amber-500 dark:text-amber-400',
    bg:   'bg-amber-50/60 dark:bg-amber-950/15 border-amber-200/60 dark:border-amber-700/40',
    pill: 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/40',
    label: 'Uncertain',
  },
} as const

// Gemini models the user can switch to — each has its OWN daily free-tier
// quota, so picking one not used today bypasses an exhausted model's limit.
const MODEL_OPTIONS = [
  { value: '',                      label: 'Default (flash-latest)' },
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
  { value: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro' },
] as const

function fmtKES(n?: number | null) {
  if (n == null) return null
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2 })
}

function timeAgo(iso?: string) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

type MergedRow = ReceiptItem & { assessed?: AssessedItem }

// ── component ──────────────────────────────────────────────────────────────

export default function InvoiceBillingAudit({
  claimId, diagnosis, treatment, lineItems, rawText, fileUrl,
}: Props) {
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [forceRefresh, setForceRefresh] = useState(0)
  const [expanded, setExpanded]     = useState<Set<number>>(new Set())
  const [bigView, setBigView]       = useState(false)
  const [enriching, setEnriching]   = useState<Set<number>>(new Set())
  const [enrichOverrides, setEnrichOverrides] = useState<Record<number, AssessedItem>>({})
  // Persisted model override — remembered so the user doesn't re-pick each time.
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('billingAuditModel') || '')
  const setModel = (m: string) => { setSelectedModel(m); localStorage.setItem('billingAuditModel', m) }

  const toggleExpand = (i: number) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })

  const keyRef = useRef('')
  const newKey = claimId
    ? `claim:${claimId}:${forceRefresh}`
    : `inline:${diagnosis}|${treatment}|${(lineItems ?? []).map(l => l.description).join(',')}|${rawText?.slice(0,80) ?? ''}|${forceRefresh}`

  // For inline (no claimId), only auto-run when there's actual invoice content to assess —
  // a diagnosis alone is not enough; Gemini needs items or raw text to extract from.
  const hasAssessableContent = claimId
    || (rawText && rawText.trim().length > 20)
    || (lineItems && lineItems.length > 0)
    || !!fileUrl   // vision can read the document image even without OCR text

  // Vision fallback (upload stage): read the invoice image directly when text
  // extraction found no line items. Returns true if it produced items.
  const runVisionAssessment = useCallback(async (): Promise<boolean> => {
    if (!fileUrl) return false
    try {
      let blob: Blob | null = null
      if (fileUrl.startsWith('blob:') || fileUrl.startsWith('data:')) {
        const r = await fetch(fileUrl)
        if (r.ok) blob = await r.blob()
      } else {
        const rel = fileUrl.replace(/^\/api\//, '/')
        const { data } = await api.get(rel, { responseType: 'blob' })
        blob = data
      }
      if (!blob) return false
      const fd = new FormData()
      fd.append('file', new File([blob], 'invoice', { type: blob.type || 'application/pdf' }))
      if (diagnosis) fd.append('diagnosis', diagnosis)
      if (treatment) fd.append('treatment', treatment)
      if (selectedModel) fd.append('model', selectedModel)
      const { data } = await api.post<Assessment>('/claims/billing-validation/assess-vision', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000,
      })
      if (data?.items?.length) { setAssessment(data); return true }
    } catch { /* fall through to the text result */ }
    return false
  }, [fileUrl, diagnosis, treatment, selectedModel])

  const runAssessment = useCallback(() => {
    if (!hasAssessableContent) return
    setLoading(true)
    setError(null)
    setAssessment(null)

    // No OCR text/items but we have the file → go straight to vision.
    const textAssessable = claimId
      || (rawText && rawText.trim().length > 20)
      || (lineItems && lineItems.length > 0)
    if (!textAssessable && fileUrl) {
      runVisionAssessment()
        .then(ok => { if (!ok) setError('Could not read billing items from the document') })
        .finally(() => setLoading(false))
      return
    }

    const qs = new URLSearchParams()
    if (forceRefresh > 0) qs.set('refresh', 'true')
    if (selectedModel) qs.set('model', selectedModel)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    const req = claimId
      ? api.get<Assessment>(`/claims/${claimId}/billing-validation${query}`, { timeout: 60_000 })
      : api.post<Assessment>('/claims/billing-validation/assess', {
          diagnosis, treatment, rawText, model: selectedModel || undefined,
          lineItems: lineItems?.map(li => ({
            description: li.description,
            procedureCode: li.procedureCode ?? undefined,
          })),
        }, { timeout: 45_000 })

    req
      .then(async r => {
        // Text extraction found nothing but we have the document → try vision.
        if (!claimId && fileUrl && !(r.data?.items?.length)) {
          const ok = await runVisionAssessment()
          if (ok) return
        }
        setAssessment(r.data)
      })
      .catch(e => {
        const isTimeout = e?.code === 'ECONNABORTED' || String(e?.message).includes('timeout')
        setError(isTimeout
          ? 'Assessment timed out — click Retry to try again, or check back after publishing.'
          : (e?.response?.data?.message ?? 'Assessment unavailable'))
      })
      .finally(() => setLoading(false))
  }, [claimId, diagnosis, treatment, rawText, lineItems, forceRefresh, hasAssessableContent, fileUrl, runVisionAssessment, selectedModel]) // eslint-disable-line

  useEffect(() => {
    if (newKey === keyRef.current && forceRefresh === 0) return
    keyRef.current = newKey
    if (hasAssessableContent) runAssessment()
  }, [newKey]) // eslint-disable-line

  // Re-running the assessment invalidates any per-item enrichment overrides.
  useEffect(() => { setEnrichOverrides({}); setEnriching(new Set()) }, [assessment])

  // ── per-item enrichment — fetch missing amount / code / verdict ────────────
  const enrichItem = useCallback(async (i: number, row: MergedRow) => {
    setEnriching(prev => new Set(prev).add(i))
    try {
      const { data } = await api.post<AssessedItem>('/claims/billing-validation/enrich-item', {
        claimId, diagnosis, treatment, rawText,
        itemName: row.description,
      }, { timeout: 45_000 })
      setEnrichOverrides(prev => ({ ...prev, [i]: data }))
    } catch {
      /* best-effort — leave the row as-is on failure */
    } finally {
      setEnriching(prev => { const n = new Set(prev); n.delete(i); return n })
    }
  }, [claimId, diagnosis, treatment, rawText])

  // Apply an enrichment override onto a row (filled amount/code/verdict win).
  const withOverride = (row: MergedRow, i: number): MergedRow => {
    const ov = enrichOverrides[i]
    if (!ov) return row
    return {
      ...row,
      quantity:      ov.quantity   ?? row.quantity,
      unitPrice:     ov.unitPrice  ?? row.unitPrice,
      totalPrice:    ov.amount     ?? row.totalPrice,
      procedureCode: ov.procedureCode ?? row.procedureCode,
      assessed:      { ...(row.assessed ?? { name: row.description, match: 'uncertain' as const, score: 0, reason: '' }), ...ov },
    }
  }

  // ── merge receipt items with assessment ───────────────────────────────────

  const rows: MergedRow[] = (() => {
    if (lineItems && lineItems.length > 0 && assessment) {
      return lineItems.map((li, i) => ({ ...li, assessed: assessment.items[i] }))
    }
    if (assessment && assessment.items.length > 0) {
      // Path B items carry their own amount/qty/rate parsed from the invoice.
      return assessment.items.map(it => ({
        description: it.name,
        quantity:   it.quantity ?? null,
        unitPrice:  it.unitPrice ?? null,
        totalPrice: it.amount ?? null,
        assessed:   it,
      }))
    }
    if (lineItems && lineItems.length > 0) return lineItems.map(li => ({ ...li }))
    return []
  })()

  // Rows with any per-item enrichment applied — used for both display and stats
  // so a fetched verdict/amount immediately updates the counts and progress bar.
  const displayRows   = rows.map((r, i) => withOverride(r, i))
  const mismatchRows  = displayRows.filter(r => r.assessed?.match === 'mismatch')
  const matchCount    = displayRows.filter(r => r.assessed?.match === 'match').length
  const mismatchTotal = mismatchRows.reduce((s, r) => s + (r.totalPrice ?? 0), 0)
  const displayDx     = assessment?.diagnosis || diagnosis || ''
  const isQuota       = assessment?.summary === 'AI_QUOTA_EXCEEDED'

  const hasAnyData = claimId || diagnosis || treatment || rawText || (lineItems && lineItems.length > 0)
  if (!hasAnyData) return null

  // ── single audit row — stacked, readable, expandable ──────────────────────
  // `wide` (used in the larger panel) forces every reason fully expanded.
  const AuditRow = ({ row, i, wide }: { row: MergedRow; i: number; wide?: boolean }) => {
    const cfg      = row.assessed ? MATCH[row.assessed.match] : null
    const Icon     = cfg?.icon
    const isBad    = row.assessed?.match === 'mismatch'
    const hasArith = row.quantity != null && row.unitPrice != null && row.totalPrice != null
      && Math.abs(row.quantity * row.unitPrice - row.totalPrice) > 0.5
    const reason   = row.assessed?.reason ?? ''
    const isLong   = reason.length > 90
    const isOpen   = wide || expanded.has(i)
    const score    = row.assessed?.score
    // A line is "incomplete" when its amount is missing or its verdict is
    // unresolved — these can be filled in by the per-item enrichment pass.
    const busy        = enriching.has(i)
    const isEnriched  = !!row.assessed?.enriched || !!enrichOverrides[i]
    const isIncomplete = row.totalPrice == null || row.assessed?.match === 'uncertain'

    return (
      <div className={`rounded-xl border px-3 py-2.5 ${cfg ? cfg.bg : 'border-border bg-card'}`}>
        {/* Header: description (wraps) + verdict pill */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {isBad && <Flag className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
            <p className={`text-sm font-semibold leading-snug break-words ${isBad ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
              {row.description}
            </p>
          </div>
          {cfg && Icon && (
            <span className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.pill}`}>
              <Icon className={`h-3 w-3 ${cfg.color}`} />{cfg.label}
            </span>
          )}
        </div>

        {/* Meta: amount · qty×rate · procedure code · accuracy index */}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {row.totalPrice != null && (
            <span className={`text-sm font-bold font-mono tabular-nums ${isBad ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
              {fmtKES(row.totalPrice)}
            </span>
          )}
          {(row.quantity != null && row.unitPrice != null) && (
            <span className="text-[11px] font-mono text-muted-foreground">{row.quantity} × {fmtKES(row.unitPrice)}</span>
          )}
          {row.taxAmount != null && row.taxAmount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/50">+VAT {fmtKES(row.taxAmount)}</span>
          )}
          {row.procedureCode && (
            <span className="text-[10px] font-mono text-muted-foreground/70 border border-border rounded px-1.5 py-0">{row.procedureCode}</span>
          )}
          {score != null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5 cursor-default ${
                  score >= 0.85 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' :
                  score >= 0.6  ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10' :
                                  'text-red-600 dark:text-red-400 bg-red-500/10'
                }`}>
                  <Gauge className="h-2.5 w-2.5" />{Math.round(score * 100)}%
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">AI accuracy index for this verdict</TooltipContent>
            </Tooltip>
          )}
        </div>

        {hasArith && (
          <p className="flex items-center gap-1 text-[10px] text-red-500 mt-1">
            <AlertTriangle className="h-3 w-3" /> qty × rate ≠ total
          </p>
        )}

        {/* Clinical reason — full width, wraps, expandable */}
        {reason && (
          <div className="mt-1.5">
            <p className={`text-[11.5px] leading-relaxed break-words ${isBad ? 'text-red-600/90 dark:text-red-400/80' : 'text-muted-foreground'} ${!isOpen && isLong ? 'line-clamp-2' : ''}`}>
              {reason}
            </p>
            {isLong && !wide && (
              <button
                type="button"
                onClick={() => toggleExpand(i)}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
              >
                {isOpen ? <>Show less <ChevronUp className="h-2.5 w-2.5" /></> : <>Read more <ChevronDown className="h-2.5 w-2.5" /></>}
              </button>
            )}
          </div>
        )}

        {/* Fetch-details — fill in a line whose amount/code/verdict is missing */}
        {isIncomplete && !isEnriched && (
          <button
            type="button"
            onClick={() => enrichItem(i, row)}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-sky-300/60 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-950/30 px-2.5 py-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors disabled:opacity-60"
          >
            {busy
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Fetching details…</>
              : <><Sparkles className="h-3 w-3" /> Fetch missing details</>}
          </button>
        )}
        {isEnriched && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-2.5 w-2.5" /> Details fetched from invoice
          </p>
        )}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3 text-sm">

      {/* ── Header: Diagnosis + status bar ──────────────────────────────── */}
      <div className="rounded-xl border border-sky-200/60 dark:border-sky-800/30 bg-sky-50/70 dark:bg-sky-950/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Stethoscope className="h-4 w-4 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600/60 dark:text-sky-400/60 mb-0.5">
                Patient Diagnosis
              </p>
              <p className="text-sm font-semibold text-foreground leading-snug">
                {displayDx || <span className="italic text-muted-foreground">Not recorded</span>}
              </p>
            </div>
          </div>

          {/* Overall status pill + refresh — hidden when extraction found no
              items, so a failed run doesn't masquerade as an "Uncertain" verdict. */}
          <div className="flex items-center gap-2 shrink-0">
            {assessment && !loading && rows.length > 0 && (
              <>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border ${
                  assessment.overall === 'match'    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-700' :
                  assessment.overall === 'mismatch' ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300/60 dark:border-red-700' :
                  assessment.overall === 'partial'  ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300/60 dark:border-amber-700' :
                  'bg-muted text-muted-foreground border-border'
                }`}>
                  {assessment.overall === 'match'    ? <><ShieldCheck className="h-3 w-3" />Clean</> :
                   assessment.overall === 'mismatch' ? <><ShieldAlert className="h-3 w-3" />Flagged</> :
                   assessment.overall === 'partial'  ? <><AlertTriangle className="h-3 w-3" />Partial</> :
                                                      <><HelpCircle className="h-3 w-3" />Uncertain</>}
                </span>
                {claimId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        title="Re-run AI assessment"
                        aria-label="Re-run AI assessment"
                        onClick={() => setForceRefresh(n => n + 1)}
                        className="p-1 rounded hover:bg-sky-100 dark:hover:bg-sky-900/30 text-sky-500 dark:text-sky-400 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">Re-run AI assessment</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </div>

        {/* Summary + cache timestamp — only when there are items to summarise */}
        {assessment && !loading && rows.length > 0 && (
          <div className="mt-2 pt-2 border-t border-sky-200/40 dark:border-sky-800/30">
            <p className="text-xs text-sky-700/70 dark:text-sky-300/70 leading-relaxed">{assessment.summary}</p>
            {assessment.cachedAt && (
              <p className="flex items-center gap-1 text-[10px] text-sky-600/40 dark:text-sky-400/40 mt-1">
                <Clock className="h-2.5 w-2.5" />
                Assessed {timeAgo(assessment.cachedAt)} · cached
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
          <div className="relative">
            <div className="h-10 w-10 rounded-full border-2 border-sky-200 dark:border-sky-800 animate-pulse" />
            <Loader2 className="h-5 w-5 animate-spin text-sky-500 absolute inset-0 m-auto" />
          </div>
          <p className="text-xs text-center">Reading invoice and checking each item<br/>against the patient's diagnosis…</p>
        </div>
      )}

      {/* ── No assessable content (upload stage, before OCR text exists) ──── */}
      {!loading && !error && !assessment && !hasAssessableContent && (diagnosis || treatment) && (
        <div className="rounded-lg border border-dashed border-sky-300/50 dark:border-sky-700/40 bg-sky-50/40 dark:bg-sky-950/10 px-4 py-5 text-center space-y-1.5">
          <Sparkles className="h-4 w-4 text-sky-500/60 mx-auto" />
          <p className="text-xs font-medium text-foreground/70">
            Invoice not read yet
          </p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Click <span className="font-semibold text-sky-600 dark:text-sky-400">Auto-fill</span> at the top to read this document, and each billed item will be listed and checked against the diagnosis. (It also runs automatically once the claim is published.)
          </p>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-center space-y-2">
          <p className="text-xs text-destructive/80">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); setForceRefresh(n => n + 1) }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Invoice audit list ───────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="space-y-1.5">
          {/* List header + expand control */}
          <div className="flex items-center justify-between px-1 pb-0.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">
              {rows.length} item{rows.length !== 1 ? 's' : ''} on invoice
            </span>
            <button
              type="button"
              onClick={() => setBigView(true)}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/30 rounded px-1.5 py-0.5 transition-colors"
            >
              <Maximize2 className="h-2.5 w-2.5" /> View larger
            </button>
          </div>

          {displayRows.map((row, i) => <AuditRow key={i} row={row} i={i} />)}
        </div>
      )}

      {/* ── AI quota exceeded — distinct, accurate state (not "bad scan"). ──── */}
      {!loading && !error && isQuota && rows.length === 0 && (
        <div className="rounded-xl border border-orange-300/60 dark:border-orange-700/50 bg-orange-50 dark:bg-orange-950/20 px-4 py-5 text-center space-y-2.5">
          <AlertTriangle className="h-4 w-4 text-orange-500 mx-auto" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-orange-800 dark:text-orange-300">AI service is over its quota</p>
            <p className="text-[11px] text-orange-700/80 dark:text-orange-300/70 leading-relaxed">
              The billing audit couldn't run because the AI provider's quota/billing limit was hit. Each model has a separate daily allowance — pick a different one below and retry, or wait for the quota to reset. Your invoice data is unaffected.
            </p>
          </div>

          {/* Model picker — each Gemini model has its own daily free-tier quota */}
          <div className="flex items-center justify-center gap-2">
            <label className="text-[10px] font-semibold text-orange-700/70 dark:text-orange-300/60 uppercase tracking-wide">Model</label>
            <select
              value={selectedModel}
              onChange={e => setModel(e.target.value)}
              className="text-[11px] rounded-lg border border-orange-300/60 dark:border-orange-700/50 bg-white dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 px-2 py-1 outline-none focus:ring-2 focus:ring-orange-400/40"
            >
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <button
            type="button"
            onClick={() => { setError(null); setForceRefresh(n => n + 1) }}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-1.5 transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Retry with this model
          </button>
        </div>
      )}

      {/* ── No items — single consistent state after an assessment ran but
             produced nothing (avoids the pill + summary + this all at once). ──── */}
      {!loading && !error && !isQuota && hasAssessableContent && assessment && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-amber-300/50 dark:border-amber-700/40 bg-amber-50/40 dark:bg-amber-950/10 px-4 py-5 text-center space-y-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-500/70 mx-auto" />
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-foreground/70">Couldn't read the billing items</p>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              The invoice text was scanned but no billed line items could be parsed from it — this usually means a low-quality scan. Try again, or re-process the document.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setError(null); setForceRefresh(n => n + 1) }}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/50 rounded-lg px-3 py-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      )}

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      {!loading && assessment && rows.length > 0 && (
        <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {matchCount} appropriate
          </span>
          {mismatchRows.length > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <XCircle className="h-3 w-3" />
              {mismatchRows.length} unrelated
            </span>
          )}
          <div className="flex-1">
            <Progress value={assessment.overallScore * 100} className="h-1.5" />
          </div>
          <span className="font-mono text-[10px]">{Math.round(assessment.overallScore * 100)}%</span>
        </div>
      )}

      {/* ── Fraud alert ──────────────────────────────────────────────────── */}
      {!loading && assessment && mismatchRows.length > 0 && (
        <div className="rounded-xl border-2 border-red-400/50 dark:border-red-700/50
                        bg-red-50 dark:bg-red-950/25 px-4 py-3.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full
                            bg-red-100 dark:bg-red-900/40 shrink-0">
              <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-300 leading-tight">
                Billing Fraud Risk Detected
              </p>
              <p className="text-[10px] text-red-600/70 dark:text-red-400/70">
                {mismatchRows.length} item{mismatchRows.length !== 1 ? 's' : ''} not clinically related to the diagnosis
              </p>
            </div>
            {mismatchTotal > 0 && (
              <Badge variant="destructive" className="ml-auto text-xs font-mono shrink-0">
                {fmtKES(mismatchTotal)} flagged
              </Badge>
            )}
          </div>

          <p className="text-xs text-red-700/75 dark:text-red-300/75 leading-relaxed border-t border-red-200/60 dark:border-red-800/40 pt-2">
            Billing for procedures unrelated to the presenting condition is a known
            inflation tactic — the insurer is billed for services the patient did not
            need, increasing the payout. Escalate to the fraud team for verification.
          </p>

          {/* Flagged items chips */}
          <div className="flex flex-wrap gap-1.5">
            {mismatchRows.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg border
                border-red-300/60 dark:border-red-700/50 bg-red-100 dark:bg-red-900/30
                px-2.5 py-1 text-[11px] text-red-700 dark:text-red-300">
                <Flag className="h-2.5 w-2.5 shrink-0" />
                <span className="font-medium">{r.description}</span>
                {r.totalPrice != null && (
                  <span className="font-mono opacity-70">· {fmtKES(r.totalPrice)}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Clean bill — only when every item genuinely matched ──────────── */}
      {!loading && assessment && mismatchRows.length === 0 && rows.length > 0 && matchCount === rows.length && (
        <div className="rounded-xl border border-emerald-200/70 dark:border-emerald-800/40
                        bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full
                          bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              All items consistent with diagnosis
            </p>
            <p className="text-[11px] text-emerald-700/60 dark:text-emerald-400/60 mt-0.5">
              No unrelated billing detected on this invoice.
            </p>
          </div>
        </div>
      )}

      {/* ── Needs review — no mismatches, but some items couldn't be verified ── */}
      {!loading && assessment && mismatchRows.length === 0 && rows.length > 0 && matchCount < rows.length && (
        <div className="rounded-xl border border-amber-200/70 dark:border-amber-800/40
                        bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full
                          bg-amber-100 dark:bg-amber-900/40 shrink-0">
            <HelpCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
              {rows.length - matchCount} item{rows.length - matchCount !== 1 ? 's' : ''} need{rows.length - matchCount === 1 ? 's' : ''} review
            </p>
            <p className="text-[11px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">
              No clearly unrelated billing, but appropriateness could not be confirmed for every item — verify the flagged entries against the clinical record.
            </p>
          </div>
        </div>
      )}

      {/* ── Wide panel — full audit with roomy layout & all reasons expanded ── */}
      <Dialog open={bigView} onOpenChange={setBigView}>
        <DialogContent className="max-w-3xl w-[92vw] max-h-[88vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogTitle className="sr-only">Billing & Diagnosis Audit</DialogTitle>

          {/* Dialog header */}
          <div className="flex items-start gap-3 px-5 py-4 border-b bg-gradient-to-r from-sky-50 to-background dark:from-sky-950/30 dark:to-background shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/40 shrink-0">
              <Stethoscope className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600/60 dark:text-sky-400/60">
                Billing audit · patient diagnosis
              </p>
              <p className="text-base font-bold text-foreground leading-snug break-words">
                {displayDx || <span className="italic text-muted-foreground">Not recorded</span>}
              </p>
              {assessment?.summary && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{assessment.summary}</p>
              )}
            </div>
            {assessment && (
              <div className="text-right shrink-0">
                <p className="text-2xl font-black tabular-nums text-foreground">{Math.round(assessment.overallScore * 100)}%</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">appropriate</p>
              </div>
            )}
          </div>

          {/* Dialog body — scrollable, roomy rows */}
          <div className="overflow-y-auto px-5 py-4 space-y-2">
            {displayRows.map((row, i) => <AuditRow key={i} row={row} i={i} wide />)}
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">No line items to display.</p>
            )}
          </div>

          {/* Dialog footer — stats */}
          {assessment && rows.length > 0 && (
            <div className="flex items-center gap-4 px-5 py-3 border-t bg-muted/30 shrink-0 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <CheckCircle2 className="h-4 w-4" /> {matchCount} appropriate
              </span>
              {mismatchRows.length > 0 && (
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-semibold">
                  <XCircle className="h-4 w-4" /> {mismatchRows.length} unrelated
                </span>
              )}
              {mismatchTotal > 0 && (
                <Badge variant="destructive" className="ml-auto font-mono">{fmtKES(mismatchTotal)} flagged</Badge>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
    </TooltipProvider>
  )
}
