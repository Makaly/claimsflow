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

interface BillingTotals {
  currency?:        string | null
  gross?:           number | null
  discount?:        number | null
  tax?:             number | null
  sponsorCoverage?: number | null
  netPayable?:      number | null
}

interface Assessment {
  diagnosis:    string
  items:        AssessedItem[]
  overall:      'match' | 'partial' | 'mismatch' | 'uncertain'
  overallScore: number
  summary:      string
  totals?:      BillingTotals | null   // invoice-level gross/deductions/net
  diagnosisInferred?: boolean          // diagnosis read off the invoice, not recorded on the claim
  pending?:     boolean  // audit is computing in the background — auto-refresh
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
  /** The claim's recorded invoice total — used to reconcile the line-item sum. */
  invoiceAmount?: number
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

// AI models the user can switch to for the billing audit. The list is the SAME
// menu the Batch Upload extractor offers (GET /ocr/models) — Claude, Gemini and
// local Ollama — so a reviewer can pick any provider. Each cloud model has its
// own daily free-tier quota, so switching providers bypasses an exhausted one.
type AuditModel = { id: string; label: string; provider: string; available: boolean; tier: string }
// Shown first; '' lets the backend use its configured default (Gemini flash).
const DEFAULT_MODEL_OPTION = { id: '', label: 'Default (recommended)', provider: '', available: true, tier: '' }

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
  claimId, diagnosis, treatment, lineItems, rawText, fileUrl, invoiceAmount,
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
  // Available AI models, fetched from the same endpoint Batch Upload uses so the
  // two menus never drift. Tesseract is excluded — it's pure OCR and cannot do
  // the clinical reasoning the billing audit needs.
  const [models, setModels] = useState<AuditModel[]>([])
  useEffect(() => {
    let cancelled = false
    api.get('/ocr/models')
      .then(({ data }) => {
        if (cancelled) return
        // Exclude tesseract (pure OCR, can't reason) and ollama (local vision
        // models can't read PDF invoices and are too slow for this) — they make
        // poor billing-audit providers and only lead to dead ends.
        const list: AuditModel[] = (data.models || [])
          .filter((m: AuditModel) => m.provider !== 'tesseract' && m.provider !== 'ollama')
          .map((m: any) => ({ id: m.id, label: m.label, provider: m.provider, available: !!m.available, tier: m.tier }))
        setModels(list)
      })
      .catch(err => console.warn('Failed to load AI models for billing audit:', err))
    return () => { cancelled = true }
  }, [])

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
        model: selectedModel || undefined,
      }, { timeout: 45_000 })
      setEnrichOverrides(prev => ({ ...prev, [i]: data }))
    } catch {
      /* best-effort — leave the row as-is on failure */
    } finally {
      setEnriching(prev => { const n = new Set(prev); n.delete(i); return n })
    }
  }, [claimId, diagnosis, treatment, rawText, selectedModel])

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
  // Itemised total — the sum of every line that has an amount. Reconciled against
  // the claim's recorded invoice amount so a mismatch (missing/extra lines or a
  // padded total) is visible at a glance.
  const itemsTotal      = displayRows.reduce((s, r) => s + (r.totalPrice ?? 0), 0)
  const itemsWithAmount = displayRows.filter(r => r.totalPrice != null).length
  // Invoice totals block (gross/deductions/net) parsed off the document, if present.
  const totals          = assessment?.totals ?? null
  const hasTotals       = !!totals && [totals.gross, totals.discount, totals.tax, totals.sponsorCoverage, totals.netPayable].some(v => v != null)
  const hasDeductions   = !!totals && [totals.discount, totals.tax, totals.sponsorCoverage, totals.netPayable].some(v => v != null)
  // Reconcile the line-item sum against ONE invoice reference: the invoice's
  // printed gross total when we read it, else the claim's recorded amount. The
  // header and the diff message use the SAME number so they never contradict.
  const grossRef        = totals?.gross ?? invoiceAmount ?? null
  const refLabel        = totals?.gross != null ? 'Invoice total' : 'Invoice amount'
  const recDiff         = grossRef != null ? itemsTotal - grossRef : null
  const reconciles      = recDiff != null && Math.abs(recDiff) < 1
  // When the OCR-grabbed claim amount disagrees with the invoice's printed total,
  // surface it rather than showing a third, contradictory number.
  const ocrAmountDiffers = totals?.gross != null && invoiceAmount != null && Math.abs(invoiceAmount - totals.gross) >= 1
  const cur             = totals?.currency || 'KES'
  const fmtCur          = (n?: number | null) => n == null ? null : `${cur} ` + n.toLocaleString('en-KE', { minimumFractionDigits: 2 })

  const hasAnyData = claimId || diagnosis || treatment || rawText || (lineItems && lineItems.length > 0)
  if (!hasAnyData) return null

  // Reusable model picker — shown on every failure state so the reviewer can
  // switch provider and retry without ever getting stuck on a dead end.
  const modelPicker = (
    <div className="flex items-center justify-center gap-2">
      <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Model</label>
      <select
        value={selectedModel}
        onChange={e => setModel(e.target.value)}
        className="text-[11px] rounded-lg border border-border bg-background text-foreground px-2 py-1 outline-none focus:ring-2 focus:ring-sky-400/40"
      >
        {[DEFAULT_MODEL_OPTION, ...models].map(m => (
          <option key={m.id || 'default'} value={m.id} disabled={!m.available}>
            {m.label}{m.available ? '' : ' (unavailable)'}
          </option>
        ))}
      </select>
    </div>
  )

  // ── single audit row — COMPACT line item + collapsible detail dropdown ─────
  // The header line stays one row (name · amount · accuracy · verdict) no matter
  // how long the clinical reason is; all detail (qty × rate, code, reason,
  // enrichment) lives in the dropdown, so long text never disarranges the list.
  // `wide` (the larger panel) forces every row open.
  const AuditRow = ({ row, i, wide }: { row: MergedRow; i: number; wide?: boolean }) => {
    const cfg      = row.assessed ? MATCH[row.assessed.match] : null
    const Icon     = cfg?.icon
    const isBad    = row.assessed?.match === 'mismatch'
    const hasArith = row.quantity != null && row.unitPrice != null && row.totalPrice != null
      && Math.abs(row.quantity * row.unitPrice - row.totalPrice) > 0.5
    const reason   = row.assessed?.reason ?? ''
    const isOpen   = wide || expanded.has(i)
    const score    = row.assessed?.score
    const busy        = enriching.has(i)
    const isEnriched  = !!row.assessed?.enriched || !!enrichOverrides[i]
    const isIncomplete = row.totalPrice == null || row.assessed?.match === 'uncertain'
    const hasQtyRate  = row.quantity != null && row.unitPrice != null
    // Is there anything worth expanding for?
    const hasDetails  = !!reason || hasQtyRate || !!row.procedureCode || hasArith
      || (row.taxAmount != null && row.taxAmount > 0) || isIncomplete || isEnriched
    const expandable  = hasDetails && !wide

    return (
      <div className={`rounded-xl border overflow-hidden ${cfg ? cfg.bg : 'border-border bg-card'}`}>
        {/* Compact header line — click to toggle the detail dropdown */}
        <button
          type="button"
          onClick={() => expandable && toggleExpand(i)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${expandable ? 'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]' : 'cursor-default'}`}
        >
          {expandable
            ? (isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />)
            : <span className="w-3.5 shrink-0" />}
          {isBad && <Flag className="h-3.5 w-3.5 text-red-500 shrink-0" />}
          <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${isBad ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
            {row.description}
          </span>
          {row.totalPrice != null && (
            <span className={`shrink-0 text-sm font-bold font-mono tabular-nums ${isBad ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
              {fmtKES(row.totalPrice)}
            </span>
          )}
          {score != null && (
            <span className={`shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold rounded px-1.5 py-0.5 ${
              score >= 0.85 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' :
              score >= 0.6  ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10' :
                              'text-red-600 dark:text-red-400 bg-red-500/10'
            }`}>
              <Gauge className="h-2.5 w-2.5" />{Math.round(score * 100)}%
            </span>
          )}
          {cfg && Icon && (
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.pill}`}>
              <Icon className={`h-3 w-3 ${cfg.color}`} />{cfg.label}
            </span>
          )}
        </button>

        {/* Detail dropdown — qty × rate, code, full reason, enrichment */}
        {isOpen && hasDetails && (
          <div className="px-3 pb-2.5 pt-2 ml-5 space-y-1.5 border-t border-black/[0.04] dark:border-white/[0.04]">
            {(hasQtyRate || row.procedureCode || (row.taxAmount != null && row.taxAmount > 0)) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                {hasQtyRate && (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Qty {row.quantity} × {fmtKES(row.unitPrice)}
                  </span>
                )}
                {row.taxAmount != null && row.taxAmount > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground/60">+VAT {fmtKES(row.taxAmount)}</span>
                )}
                {row.procedureCode && (
                  <span className="text-[10px] font-mono text-muted-foreground/80 border border-border rounded px-1.5 py-0">
                    {row.procedureCode}
                  </span>
                )}
              </div>
            )}

            {hasArith && (
              <p className="flex items-center gap-1 text-[10px] text-red-500">
                <AlertTriangle className="h-3 w-3" /> qty × rate ≠ line total
              </p>
            )}

            {reason && (
              <p className={`text-[11.5px] leading-relaxed break-words ${isBad ? 'text-red-600/90 dark:text-red-400/80' : 'text-muted-foreground'}`}>
                {reason}
              </p>
            )}

            {isIncomplete && !isEnriched && (
              <button
                type="button"
                onClick={() => enrichItem(i, row)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/60 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-950/30 px-2.5 py-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors disabled:opacity-60"
              >
                {busy
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Fetching details…</>
                  : <><Sparkles className="h-3 w-3" /> Fetch missing details</>}
              </button>
            )}
            {isEnriched && (
              <p className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" /> Details fetched from invoice
              </p>
            )}
          </div>
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
              {displayDx && assessment?.diagnosisInferred && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300 cursor-help">
                      <Sparkles className="h-2.5 w-2.5" /> inferred from billing
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                    No diagnosis was recorded on the claim — this was read from the invoice/procedure codes by the AI. Verify against the clinical record before relying on it.
                  </TooltipContent>
                </Tooltip>
              )}
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
          <p className="text-[10px] text-muted-foreground/70">Try a different AI model, then retry:</p>
          {modelPicker}
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

          {/* Model picker — Claude / Gemini / local, the same menu as Batch
              Upload. Each cloud model has its own daily free-tier quota. */}
          <div className="flex items-center justify-center gap-2">
            <label className="text-[10px] font-semibold text-orange-700/70 dark:text-orange-300/60 uppercase tracking-wide">Model</label>
            <select
              value={selectedModel}
              onChange={e => setModel(e.target.value)}
              className="text-[11px] rounded-lg border border-orange-300/60 dark:border-orange-700/50 bg-white dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 px-2 py-1 outline-none focus:ring-2 focus:ring-orange-400/40"
            >
              {[DEFAULT_MODEL_OPTION, ...models].map(m => (
                <option key={m.id || 'default'} value={m.id} disabled={!m.available}>
                  {m.label}{m.available ? '' : ' (unavailable)'}
                </option>
              ))}
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
              No billed line items could be parsed — usually a low-quality scan, or the chosen AI model was unavailable. Try a different model, or re-process the document.
            </p>
          </div>
          {modelPicker}
          <button
            type="button"
            onClick={() => { setError(null); setForceRefresh(n => n + 1) }}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/50 rounded-lg px-3 py-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      )}

      {/* ── Itemised total ⇄ invoice reconciliation + deductions/net ─────── */}
      {!loading && assessment && (itemsWithAmount > 0 || hasTotals) && (
        <div className={`rounded-xl border px-4 py-2.5 ${
          recDiff == null      ? 'border-border bg-muted/30' :
          reconciles           ? 'border-emerald-200/70 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/15' :
                                 'border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Itemised total{itemsWithAmount < rows.length ? ` · ${itemsWithAmount}/${rows.length} priced` : ''}
              </p>
              <p className="text-lg font-black tabular-nums font-mono text-foreground leading-tight">{fmtKES(itemsTotal)}</p>
            </div>
            {grossRef != null && (
              <div className="text-right shrink-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{refLabel}</p>
                <p className="text-sm font-bold tabular-nums font-mono text-muted-foreground leading-tight">{fmtKES(grossRef)}</p>
              </div>
            )}
          </div>
          {recDiff != null && (
            <div className={`mt-1.5 pt-1.5 border-t flex items-center gap-1.5 text-[11px] font-semibold ${
              reconciles
                ? 'border-emerald-200/50 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-200/50 dark:border-amber-800/30 text-amber-700 dark:text-amber-400'
            }`}>
              {reconciles
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> Line items reconcile with the {refLabel.toLowerCase()}</>
                : <><AlertTriangle className="h-3.5 w-3.5" /> {recDiff > 0 ? 'Items exceed' : 'Items fall short of'} the {refLabel.toLowerCase()} by {fmtKES(Math.abs(recDiff))}</>}
            </div>
          )}
          {ocrAmountDiffers && (
            <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
              Recorded claim amount {fmtKES(invoiceAmount)} differs from the invoice's printed total — verify which is correct.
            </p>
          )}

          {/* Deductions / rebates / net payable — the invoice's totals block.
              Gross is already shown above as the invoice total, so it's omitted here. */}
          {hasDeductions && (
            <div className="mt-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06] space-y-1 text-[11px]">
              {totals!.tax != null && totals!.tax > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>VAT / tax</span>
                  <span className="font-mono tabular-nums">+ {fmtCur(totals!.tax)}</span>
                </div>
              )}
              {totals!.discount != null && totals!.discount > 0 && (
                <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Discount / rebate</span>
                  <span className="font-mono tabular-nums">− {fmtCur(totals!.discount)}</span>
                </div>
              )}
              {totals!.sponsorCoverage != null && totals!.sponsorCoverage > 0 && (
                <div className="flex items-center justify-between text-sky-700 dark:text-sky-400">
                  <span>Sponsor / insurer coverage</span>
                  <span className="font-mono tabular-nums">− {fmtCur(totals!.sponsorCoverage)}</span>
                </div>
              )}
              {totals!.netPayable != null && (
                <div className="flex items-center justify-between pt-1 mt-1 border-t border-black/[0.06] dark:border-white/[0.06] text-foreground font-bold">
                  <span>Final amount payable</span>
                  <span className="font-mono tabular-nums text-base">{fmtCur(totals!.netPayable)}</span>
                </div>
              )}
            </div>
          )}
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
                {displayDx && assessment?.diagnosisInferred && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 align-middle text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                    <Sparkles className="h-2.5 w-2.5" /> inferred from billing
                  </span>
                )}
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
