import { useState, useEffect } from 'react'
import {
  AlertTriangle, CheckCircle2, XCircle, HelpCircle,
  ChevronDown, ChevronUp, Calculator, TrendingUp, ShieldAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import api from '@/services/api'
import { formatCurrency } from '@/lib/utils'

interface LineItem {
  id: string
  lineNumber: number | null
  description: string
  category: string | null
  quantity: number | null
  unitPrice: number | null
  totalPrice: number | null
  taxAmount: number | null
  discount: number | null
  currency: string
  serviceDate: string | null
  procedureCode: string | null
  ocrConfidence: number | null
  overallConfidence: number | null
  fraudRisk: 'low' | 'medium' | 'high' | null
  fraudRiskScore: number | null
  fraudFlags: string[]
  arithmeticValid: boolean | null
}

interface LineItemsResponse {
  invoice_id: string
  vendor: string
  line_items: LineItem[]
  invoice_total: number
  calculated_total: number
  discrepancy_flag: boolean
}

interface Props {
  claimId: string
  invoiceTotal?: number
}

const RISK_CONFIG = {
  high:   { bg: 'bg-red-50',    border: 'border-red-200',    badge: 'destructive' as const,   icon: XCircle,      label: 'High Risk'   },
  medium: { bg: 'bg-amber-50',  border: 'border-amber-200',  badge: 'secondary'  as const,   icon: AlertTriangle, label: 'Medium Risk' },
  low:    { bg: 'bg-green-50',  border: 'border-green-200',  badge: 'default'    as const,   icon: CheckCircle2,  label: 'Low Risk'    },
}

function ConfidenceDot({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>
  const pct  = Math.round(score * 100)
  const color = pct >= 80 ? 'text-green-600' : pct >= 55 ? 'text-amber-600' : 'text-red-600'
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>
}

function ArithmeticBadge({ valid, qty, unit, total }: {
  valid: boolean | null
  qty: number | null
  unit: number | null
  total: number | null
}) {
  if (valid == null || (qty == null && unit == null)) return null
  const expected = qty != null && unit != null ? qty * unit : null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 text-xs ${valid ? 'text-green-600' : 'text-red-600'}`}>
            <Calculator className="h-3 w-3" />
            {valid ? 'OK' : 'ERR'}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {valid
            ? `Arithmetic checks out: ${qty} × ${unit?.toFixed(2)} = ${total?.toFixed(2)}`
            : `Mismatch: ${qty} × ${unit?.toFixed(2)} = ${expected?.toFixed(2)}, billed ${total?.toFixed(2)}`
          }
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function LineItemsTable({ claimId, invoiceTotal }: Props) {
  const [data, setData]         = useState<LineItemsResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    api.get<LineItemsResponse>(`/claims/${claimId}/line-items`)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'Failed to load line items'))
      .finally(() => setLoading(false))
  }, [claimId])

  if (loading) return (
    <Card>
      <CardContent className="py-6 text-center text-muted-foreground text-sm animate-pulse">
        Loading line items…
      </CardContent>
    </Card>
  )

  if (error) return (
    <Card>
      <CardContent className="py-4 text-sm text-muted-foreground">{error}</CardContent>
    </Card>
  )

  if (!data || data.line_items.length === 0) return (
    <Card>
      <CardContent className="py-6 text-center text-muted-foreground text-sm">
        No line items extracted for this invoice.
      </CardContent>
    </Card>
  )

  const items        = data.line_items
  const highCount    = items.filter(i => i.fraudRisk === 'high').length
  const mediumCount  = items.filter(i => i.fraudRisk === 'medium').length
  const arithmeticOk = items.every(i => i.arithmeticValid !== false)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="text-muted-foreground">{items.length} line item{items.length !== 1 ? 's' : ''}</span>
        {highCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            {highCount} high risk
          </Badge>
        )}
        {mediumCount > 0 && (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {mediumCount} medium risk
          </Badge>
        )}
        {!arithmeticOk && (
          <Badge variant="destructive" className="gap-1">
            <Calculator className="h-3 w-3" />
            Arithmetic errors
          </Badge>
        )}
        {data.discrepancy_flag && (
          <Badge variant="destructive" className="gap-1">
            <TrendingUp className="h-3 w-3" />
            Total discrepancy: {formatCurrency(Math.abs((invoiceTotal ?? data.invoice_total) - data.calculated_total))}
          </Badge>
        )}
      </div>

      {/* Totals reconciliation */}
      <Card className={data.discrepancy_flag ? 'border-red-300 bg-red-50' : 'border-green-200 bg-green-50'}>
        <CardContent className="py-3 px-4 flex items-center justify-between text-sm">
          <div className="flex gap-6">
            <div>
              <span className="text-muted-foreground">Invoice total </span>
              <span className="font-semibold">{formatCurrency(invoiceTotal ?? data.invoice_total)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Calculated total </span>
              <span className="font-semibold">{formatCurrency(data.calculated_total)}</span>
            </div>
          </div>
          {data.discrepancy_flag
            ? <span className="text-red-600 font-medium flex items-center gap-1"><XCircle className="h-4 w-4" /> Discrepancy detected</span>
            : <span className="text-green-700 font-medium flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Totals match</span>
          }
        </CardContent>
      </Card>

      {/* Line items table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 pl-3">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="text-right w-28">Unit Price</TableHead>
                <TableHead className="text-right w-28">Total</TableHead>
                <TableHead className="w-16 text-center">Chk</TableHead>
                <TableHead className="w-24 text-center">Conf</TableHead>
                <TableHead className="w-28 text-center">Risk</TableHead>
                <TableHead className="w-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const risk   = item.fraudRisk ?? 'low'
                const cfg    = RISK_CONFIG[risk]
                const isOpen = expanded.has(item.id)
                const RiskIcon = cfg.icon

                return (
                  <>
                    <TableRow
                      key={item.id}
                      className={`${cfg.bg} cursor-pointer hover:opacity-90`}
                      onClick={() => toggleExpand(item.id)}
                    >
                      <TableCell className="pl-3 text-muted-foreground text-xs">
                        {item.lineNumber ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="truncate font-medium text-sm">{item.description}</div>
                        {item.procedureCode && (
                          <div className="text-xs text-muted-foreground font-mono">{item.procedureCode}</div>
                        )}
                        {item.category && (
                          <div className="text-xs text-muted-foreground capitalize">{item.category}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {item.quantity != null ? item.quantity : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {item.unitPrice != null ? formatCurrency(item.unitPrice) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono font-medium">
                        {item.totalPrice != null ? formatCurrency(item.totalPrice) : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <ArithmeticBadge
                          valid={item.arithmeticValid}
                          qty={item.quantity}
                          unit={item.unitPrice}
                          total={item.totalPrice}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <ConfidenceDot score={item.overallConfidence ?? item.ocrConfidence} />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium
                          ${risk === 'high' ? 'text-red-700' : risk === 'medium' ? 'text-amber-700' : 'text-green-700'}`}>
                          <RiskIcon className="h-3.5 w-3.5" />
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="pr-2 text-muted-foreground">
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </TableCell>
                    </TableRow>

                    {/* Expanded detail row */}
                    {isOpen && (
                      <TableRow key={`${item.id}-detail`} className={cfg.bg}>
                        <TableCell colSpan={9} className="pb-3 px-4">
                          <div className="space-y-2 pl-4 border-l-2 border-muted">
                            {item.fraudFlags.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                                  <ShieldAlert className="h-3.5 w-3.5" /> Fraud Flags
                                </p>
                                <ul className="space-y-0.5">
                                  {item.fraudFlags.map((flag, fi) => (
                                    <li key={fi} className="text-xs text-red-700 flex items-start gap-1.5">
                                      <span className="mt-0.5">•</span>
                                      {flag}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              {item.taxAmount != null && (
                                <div>
                                  <span className="text-muted-foreground">Tax / VAT: </span>
                                  <span className="font-mono">{formatCurrency(item.taxAmount)}</span>
                                </div>
                              )}
                              {item.discount != null && (
                                <div>
                                  <span className="text-muted-foreground">Discount: </span>
                                  <span className="font-mono">{formatCurrency(item.discount)}</span>
                                </div>
                              )}
                              {item.serviceDate && (
                                <div>
                                  <span className="text-muted-foreground">Service date: </span>
                                  <span>{item.serviceDate}</span>
                                </div>
                              )}
                              {item.fraudRiskScore != null && (
                                <div className="col-span-3">
                                  <span className="text-muted-foreground">Fraud risk score: </span>
                                  <span className="font-mono">{Math.round(item.fraudRiskScore * 100)}%</span>
                                  <Progress
                                    value={item.fraudRiskScore * 100}
                                    className="h-1.5 mt-1 max-w-[160px]"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
