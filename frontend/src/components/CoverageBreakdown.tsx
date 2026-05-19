import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck, Loader2, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import api from '@/services/api'

interface BreakdownLine {
  description: string
  category: string
  gross: number
  subLimitCap: number
  deductible: number
  coPay: number
  netPayable: number
  limitHit: boolean
}

interface CoverageResult {
  memberId: string
  planCode: string
  gross: number
  subLimitCap: number
  deductible: number
  coPay: number
  netPayable: number
  limitHit: boolean
  breakdownPerLine: BreakdownLine[]
}

interface Props {
  memberId: string
  claimId: string
  invoiceAmount?: number | null
}

export function CoverageBreakdown({ memberId, claimId, invoiceAmount }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CoverageResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || result) return
    setLoading(true)
    setError(null)

    // Fetch line items for this claim; fall back to single invoice line if none
    api.get(`/claims/${claimId}/line-items`)
      .then(({ data }) => {
        const lines = Array.isArray(data) && data.length > 0
          ? data.map((l: any) => ({ description: l.description || l.itemName, category: l.category, totalPrice: l.totalPrice ?? l.unitPrice ?? 0 }))
          : [{ description: 'Invoice total', category: 'outpatient', totalPrice: invoiceAmount ?? 0 }]
        return api.post('/coverage-calculator/calculate', { memberId, lines })
      })
      .then(({ data }) => setResult(data))
      .catch((e) => setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load coverage breakdown'))
      .finally(() => setLoading(false))
  }, [open, memberId, claimId, invoiceAmount, result])

  return (
    <Card className="mt-2">
      <CardHeader
        className="py-2 px-3 cursor-pointer flex flex-row items-center gap-2 select-none"
        onClick={() => setOpen(o => !o)}
      >
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <CardTitle className="text-xs font-semibold flex-1">Coverage Breakdown</CardTitle>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </CardHeader>

      {open && (
        <CardContent className="px-3 pb-3 pt-0">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-1.5 text-xs text-destructive py-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {error}
            </div>
          )}
          {result && (
            <div className="space-y-2">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Gross Invoice', value: result.gross },
                  { label: 'Deductible/Excess', value: result.deductible },
                  { label: 'Co-pay', value: result.coPay },
                  { label: 'Limit Deducted', value: result.subLimitCap },
                  { label: 'Net Payable', value: result.netPayable, bold: true },
                ].map(s => (
                  <div key={s.label} className="rounded-md bg-muted/40 p-1.5 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                    <p className={`text-xs ${s.bold ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-medium'}`}>
                      {formatCurrency(s.value)}
                    </p>
                  </div>
                ))}
                <div className="rounded-md bg-muted/40 p-1.5 text-center">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Plan</p>
                  <p className="text-[10px] font-mono font-medium">{result.planCode}</p>
                </div>
              </div>

              {result.limitHit && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                  One or more benefit sub-limits were reached for this claim.
                </div>
              )}

              {/* Per-line table */}
              {result.breakdownPerLine.length > 1 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1 font-medium text-muted-foreground">Description</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">Gross</th>
                        <th className="text-right py-1 font-medium text-muted-foreground">Net</th>
                        <th className="text-center py-1 font-medium text-muted-foreground">Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.breakdownPerLine.map((l, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 max-w-[140px] truncate" title={l.description}>{l.description}</td>
                          <td className="py-1 text-right">{formatCurrency(l.gross)}</td>
                          <td className="py-1 text-right font-medium">{formatCurrency(l.netPayable)}</td>
                          <td className="py-1 text-center">
                            {l.limitHit && (
                              <Badge variant="secondary" className="text-[9px] bg-amber-100 text-amber-700">Hit</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
