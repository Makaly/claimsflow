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
  Flag, RefreshCw, Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  name:   string
  match:  'match' | 'mismatch' | 'uncertain'
  score:  number
  reason: string
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
  claimId, diagnosis, treatment, lineItems, rawText,
}: Props) {
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [forceRefresh, setForceRefresh] = useState(0)

  const keyRef = useRef('')
  const newKey = claimId
    ? `claim:${claimId}:${forceRefresh}`
    : `inline:${diagnosis}|${treatment}|${(lineItems ?? []).map(l => l.description).join(',')}|${rawText?.slice(0,80) ?? ''}`

  const runAssessment = useCallback(() => {
    const hasData = claimId || diagnosis || treatment || rawText || (lineItems && lineItems.length > 0)
    if (!hasData) return
    setLoading(true)
    setError(null)
    setAssessment(null)

    const req = claimId
      ? api.get<Assessment>(`/claims/${claimId}/billing-validation`)
      : api.post<Assessment>('/claims/billing-validation/assess', {
          diagnosis, treatment, rawText,
          lineItems: lineItems?.map(li => ({
            description: li.description,
            procedureCode: li.procedureCode ?? undefined,
          })),
        })

    req
      .then(r => setAssessment(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'Assessment unavailable'))
      .finally(() => setLoading(false))
  }, [claimId, diagnosis, treatment, rawText, lineItems, forceRefresh]) // eslint-disable-line

  useEffect(() => {
    if (newKey === keyRef.current && forceRefresh === 0) return
    keyRef.current = newKey
    runAssessment()
  }, [newKey]) // eslint-disable-line

  // ── merge receipt items with assessment ───────────────────────────────────

  const rows: MergedRow[] = (() => {
    if (lineItems && lineItems.length > 0 && assessment) {
      return lineItems.map((li, i) => ({ ...li, assessed: assessment.items[i] }))
    }
    if (assessment && assessment.items.length > 0) {
      return assessment.items.map(it => ({ description: it.name, assessed: it }))
    }
    if (lineItems && lineItems.length > 0) return lineItems.map(li => ({ ...li }))
    return []
  })()

  const mismatchRows  = rows.filter(r => r.assessed?.match === 'mismatch')
  const matchCount    = rows.filter(r => r.assessed?.match === 'match').length
  const mismatchTotal = mismatchRows.reduce((s, r) => s + (r.totalPrice ?? 0), 0)
  const displayDx     = assessment?.diagnosis || diagnosis || ''

  if (!claimId && !diagnosis && !treatment && !rawText && (!lineItems || lineItems.length === 0)) return null

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

          {/* Overall status pill + refresh */}
          <div className="flex items-center gap-2 shrink-0">
            {assessment && !loading && (
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

        {/* Summary + cache timestamp */}
        {assessment && !loading && (
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

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-center">
          <p className="text-xs text-destructive/80">{error}</p>
        </div>
      )}

      {/* ── Invoice audit table ──────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="space-y-1.5">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_auto_auto] px-2 pb-1
                          text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">
            <span>Item on Invoice</span>
            <span className="text-right pr-4 w-28">Amount</span>
            <span className="text-center w-24">Verdict</span>
          </div>

          {rows.map((row, i) => {
            const cfg      = row.assessed ? MATCH[row.assessed.match] : null
            const Icon     = cfg?.icon
            const isBad    = row.assessed?.match === 'mismatch'
            const hasArith = row.quantity != null && row.unitPrice != null && row.totalPrice != null
              && Math.abs(row.quantity * row.unitPrice - row.totalPrice) > 0.5

            return (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  cfg ? cfg.bg : 'border-border bg-card'
                }`}
              >
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
                  {/* Description */}
                  <div className="min-w-0">
                    <div className="flex items-start gap-1.5">
                      {isBad && <Flag className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />}
                      <p className={`text-sm font-medium leading-snug ${isBad ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                        {row.description}
                      </p>
                    </div>
                    {/* Qty × rate */}
                    {(row.quantity != null && row.unitPrice != null) && (
                      <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        {row.quantity} × {fmtKES(row.unitPrice)}
                      </p>
                    )}
                    {row.procedureCode && (
                      <span className="inline-block mt-0.5 text-[10px] font-mono text-muted-foreground/60 border border-border rounded px-1.5 py-0">
                        {row.procedureCode}
                      </span>
                    )}
                    {hasArith && (
                      <p className="flex items-center gap-1 text-[10px] text-red-500 mt-0.5">
                        <AlertTriangle className="h-3 w-3" /> qty × rate ≠ total
                      </p>
                    )}
                    {/* Clinical reason */}
                    {row.assessed?.reason && (
                      <p className={`text-[11px] italic mt-1 leading-snug ${isBad ? 'text-red-600/80 dark:text-red-400/80' : 'text-muted-foreground'}`}>
                        {row.assessed.reason}
                      </p>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="text-right w-28 shrink-0">
                    {row.totalPrice != null ? (
                      <span className={`text-sm font-semibold font-mono tabular-nums ${
                        isBad ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                      }`}>
                        {fmtKES(row.totalPrice)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                    {row.taxAmount != null && row.taxAmount > 0 && (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        +VAT {fmtKES(row.taxAmount)}
                      </p>
                    )}
                  </div>

                  {/* Verdict pill */}
                  <div className="w-24 flex justify-end shrink-0">
                    {cfg && Icon ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={`inline-flex items-center gap-1 cursor-default rounded-full px-2.5 py-1 text-[10px] font-bold ${cfg.pill}`}>
                            <Icon className={`h-3 w-3 ${cfg.color}`} />
                            {cfg.label}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[220px] text-xs">
                          <p className="font-semibold mb-0.5">{row.description}</p>
                          <p>{row.assessed?.reason}</p>
                          <p className="text-muted-foreground mt-1">
                            Confidence: {Math.round((row.assessed?.score ?? 0) * 100)}%
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/30" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── No items ─────────────────────────────────────────────────────── */}
      {!loading && !error && rows.length === 0 && displayDx && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground/60">
            No line items extracted from this invoice yet.
          </p>
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

      {/* ── Clean bill ───────────────────────────────────────────────────── */}
      {!loading && assessment && mismatchRows.length === 0 && rows.length > 0 && (
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

    </div>
    </TooltipProvider>
  )
}
