import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, AlertTriangle, Calculator } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import api from '@/services/api'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdjudicationResult {
  memberFound: boolean
  planName?: string
  benefitCategory?: string
  benefitLimit?: number
  benefitUsed?: number
  benefitRemaining?: number
  claimAmount: number
  excessDeducted: number
  copayDeducted: number
  eligibleAmount: number
  netPayable: number
  reasons: string[]
  warnings: string[]
}

interface Props {
  memberNumber?: string
  invoiceAmount: number
  claimType?: 'inpatient' | 'outpatient' | 'dental' | 'optical' | 'maternity'
  dateOfService?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtKES(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'KES 0'
  return `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

// ─── Skeleton row ───────────────────────────────────────────────────────────

function SkeletonLine({ width = 'w-24' }: { width?: string }) {
  return <div className={`h-3 ${width} animate-pulse rounded bg-gray-200`} />
}

// ─── Main component ────────────────────────────────────────────────────────

export function AdjudicationPanel({
  memberNumber,
  invoiceAmount,
  claimType,
  dateOfService,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<AdjudicationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .post('/policy/adjudicate', {
        memberNumber,
        invoiceAmount,
        claimType,
        dateOfService,
      })
      .then(res => {
        if (!alive) return
        setResult(res.data as AdjudicationResult)
      })
      .catch(e => {
        if (!alive) return
        setError(e.response?.data?.message || 'Adjudication failed')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [memberNumber, invoiceAmount, claimType, dateOfService])

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4 text-blue-600" />
            Adjudication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SkeletonLine width="w-1/2" />
          <SkeletonLine width="w-full" />
          <SkeletonLine width="w-2/3" />
          <SkeletonLine width="w-3/4" />
        </CardContent>
      </Card>
    )
  }

  // ── Error fallback ───────────────────────────────────────────────────────
  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </CardContent>
      </Card>
    )
  }

  if (!result) return null

  // ── Member not found ─────────────────────────────────────────────────────
  if (!result.memberFound) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-red-800">
            <AlertCircle className="h-4 w-4" />
            Cannot Adjudicate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-red-700">
          {result.reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="leading-relaxed">{r}</span>
            </div>
          ))}
          {result.warnings.map((w, i) => (
            <div key={`w-${i}`} className="flex items-start gap-1.5 text-amber-700 mt-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{w}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  const limit = result.benefitLimit ?? 0
  const used = result.benefitUsed ?? 0
  const usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const netClass = result.netPayable > 0 ? 'text-green-700' : 'text-red-700'

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="h-4 w-4 text-blue-600" />
          Adjudication —{' '}
          <span className="font-normal text-gray-700">{result.planName}</span>
          {result.benefitCategory && (
            <Badge variant="secondary" className="ml-auto capitalize">
              {result.benefitCategory}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Benefit usage bar */}
        {limit > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600">
                Used {fmtKES(used)} of {fmtKES(limit)}
              </span>
              <span className="font-medium text-gray-900">
                Remaining {fmtKES(result.benefitRemaining ?? 0)}
              </span>
            </div>
            <Progress value={usedPct} className="h-2" />
          </div>
        )}

        {/* Breakdown table */}
        <div className="rounded border bg-gray-50/50">
          <div className="flex justify-between px-3 py-1.5 text-xs border-b">
            <span className="text-gray-600">Claim amount</span>
            <span className="font-mono">{fmtKES(result.claimAmount)}</span>
          </div>
          <div className="flex justify-between px-3 py-1.5 text-xs border-b">
            <span className="text-gray-600">Eligible amount</span>
            <span className="font-mono">{fmtKES(result.eligibleAmount)}</span>
          </div>
          <div className="flex justify-between px-3 py-1.5 text-xs border-b">
            <span className="text-gray-600">− Excess deducted</span>
            <span className="font-mono text-red-600">
              {fmtKES(result.excessDeducted)}
            </span>
          </div>
          <div className="flex justify-between px-3 py-1.5 text-xs border-b">
            <span className="text-gray-600">− Co-pay deducted</span>
            <span className="font-mono text-red-600">
              {fmtKES(result.copayDeducted)}
            </span>
          </div>
          <div className="flex justify-between px-3 py-2 text-sm bg-white">
            <span className="font-semibold text-gray-900 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Net Payable
            </span>
            <span className={`font-mono font-bold ${netClass}`}>
              {fmtKES(result.netPayable)}
            </span>
          </div>
        </div>

        {/* Reasons */}
        {result.reasons.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-700 flex items-center gap-1">
              <Info className="h-3.5 w-3.5" /> Notes
            </div>
            <ul className="text-xs text-gray-600 space-y-0.5 pl-5 list-disc">
              {result.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="rounded bg-amber-50 border border-amber-200 p-2 space-y-1">
            <div className="text-xs font-medium text-amber-800 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Warnings
            </div>
            <ul className="text-xs text-amber-700 space-y-0.5 pl-5 list-disc">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default AdjudicationPanel
