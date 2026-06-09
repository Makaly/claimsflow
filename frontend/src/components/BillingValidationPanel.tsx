import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, HelpCircle, Stethoscope, AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import api from '@/services/api'

interface BillingItem {
  name: string
  match: 'match' | 'mismatch' | 'uncertain'
  score: number
  reason: string
}

interface BillingAssessment {
  diagnosis: string
  items: BillingItem[]
  overall: 'match' | 'partial' | 'mismatch' | 'uncertain'
  overallScore: number
  summary: string
  fromLineItems: boolean
}

const MATCH_CONFIG = {
  match:     { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50', label: 'Appropriate' },
  mismatch:  { icon: XCircle,      color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50',             label: 'Questionable' },
  uncertain: { icon: HelpCircle,   color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50',     label: 'Uncertain' },
}

const OVERALL_CONFIG = {
  match:     { label: 'All items appropriate',       variant: 'default'      as const, color: 'bg-emerald-600' },
  partial:   { label: 'Some items questionable',     variant: 'secondary'    as const, color: 'bg-amber-500'   },
  mismatch:  { label: 'Items do not match diagnosis',variant: 'destructive'  as const, color: 'bg-red-600'     },
  uncertain: { label: 'Unable to assess',            variant: 'outline'      as const, color: 'bg-gray-400'    },
}

interface InlineData {
  diagnosis?: string
  treatment?: string
  rawText?: string
  lineItems?: { description: string; procedureCode?: string | null }[]
}

export default function BillingValidationPanel({
  claimId,
  inline,
}: {
  claimId?: string
  inline?: InlineData
}) {
  const [data, setData]       = useState<BillingAssessment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const req = claimId
      ? api.get<BillingAssessment>(`/claims/${claimId}/billing-validation`)
      : api.post<BillingAssessment>('/claims/billing-validation/assess', {
          diagnosis:  inline?.diagnosis,
          treatment:  inline?.treatment,
          rawText:    inline?.rawText,
          lineItems:  inline?.lineItems,
        })
    req
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'Could not load billing validation'))
      .finally(() => setLoading(false))
  }, [claimId, inline?.diagnosis, inline?.treatment])

  if (loading) return (
    <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Assessing billing vs diagnosis…
    </div>
  )

  if (error) return (
    <div className="py-4 text-sm text-muted-foreground text-center">{error}</div>
  )

  // Determine the best diagnosis label — from API response or from inline prop
  const displayDiagnosis = data?.diagnosis || inline?.diagnosis || ''

  if (!data && !displayDiagnosis) return (
    <div className="py-6 text-center text-muted-foreground text-sm">
      <Stethoscope className="h-6 w-6 mx-auto mb-2 opacity-30" />
      No diagnosis recorded — cannot assess billing correspondence.
    </div>
  )

  // We have a diagnosis but no items (Gemini failed) — show what we know
  if (!data || data.items.length === 0) return (
    <div className="rounded-lg border bg-card px-3 py-2.5 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
        <Stethoscope className="h-3 w-3" /> Patient Diagnosis
      </p>
      <p className="text-sm font-semibold text-foreground">{displayDiagnosis}</p>
      <p className="text-xs text-muted-foreground italic">{data?.summary || 'Assessment pending — AI is processing the invoice.'}</p>
    </div>
  )

  const overallCfg = OVERALL_CONFIG[data.overall]
  const matchCount    = data.items.filter(i => i.match === 'match').length
  const mismatchCount = data.items.filter(i => i.match === 'mismatch').length

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">

        {/* Diagnosis header */}
        <div className="rounded-lg border bg-card px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5 flex items-center gap-1">
            <Stethoscope className="h-3 w-3" /> Patient Diagnosis
          </p>
          <p className="text-sm font-semibold text-foreground leading-snug">{displayDiagnosis}</p>
        </div>

        {/* Overall verdict */}
        <div className={`rounded-lg border px-3 py-2.5 ${
          data.overall === 'match'    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50' :
          data.overall === 'mismatch' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50' :
          data.overall === 'partial'  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50' :
          'bg-muted/30 border-border'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Overall Assessment</span>
            <Badge variant={overallCfg.variant} className="text-[10px] h-5 px-2">{overallCfg.label}</Badge>
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">{data.summary}</p>
          {data.items.length > 0 && (
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />{matchCount} appropriate
              </span>
              {mismatchCount > 0 && (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />{mismatchCount} questionable
                </span>
              )}
              <div className="flex-1">
                <Progress value={data.overallScore * 100} className="h-1.5" />
              </div>
            </div>
          )}
        </div>

        {/* Per-item assessments */}
        {data.items.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-0.5">
              Billed Items ({data.items.length})
            </p>
            {data.items.map((item, i) => {
              const cfg = MATCH_CONFIG[item.match]
              const Icon = cfg.icon
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <Card className={`border cursor-help transition-colors hover:opacity-90 ${cfg.bg}`}>
                      <CardContent className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-foreground leading-snug truncate">{item.name}</p>
                              <span className={`text-[10px] font-semibold shrink-0 ${cfg.color}`}>{cfg.label}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{item.reason}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[260px] text-xs">
                    <p className="font-semibold mb-1">{item.name}</p>
                    <p>{item.reason}</p>
                    <p className="text-muted-foreground mt-1">Confidence: {Math.round(item.score * 100)}%</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}

        {!data.fromLineItems && (
          <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
            Assessment based on OCR-extracted diagnosis and treatment data
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}
