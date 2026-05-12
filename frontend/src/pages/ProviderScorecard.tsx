import { useState, useEffect } from 'react'
import { RefreshCw, Loader2, BarChart3, TrendingUp, ShieldAlert, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import api from '@/services/api'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

interface ProviderScore {
  providerId: string
  providerName: string
  providerType: string
  totalClaims: number
  approved: number
  rejected: number
  approvalRate: number
  totalAmount: number
  fraudRate: number
  incompleteRate: number
  resubmissionRate: number
  score: number
  riskLevel: 'high' | 'medium' | 'low'
}

function scoreBadge(score: number) {
  if (score >= 80) {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 font-mono">
        {score}/100
      </Badge>
    )
  }
  if (score >= 60) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800 font-mono">
        {score}/100
      </Badge>
    )
  }
  return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800 font-mono">
      {score}/100
    </Badge>
  )
}

function riskBadge(level: 'high' | 'medium' | 'low') {
  if (level === 'high') {
    return <Badge variant="destructive" className="uppercase text-[10px]">High</Badge>
  }
  if (level === 'medium') {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200 uppercase text-[10px]">Medium</Badge>
  }
  return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 uppercase text-[10px]">Low</Badge>
}

function barColor(score: number) {
  if (score >= 80) return '#10b981'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`
}

export default function ProviderScorecard() {
  const [providers, setProviders] = useState<ProviderScore[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/reports/provider-scorecard')
      const sorted = [...(data as ProviderScore[])].sort((a, b) => b.score - a.score)
      setProviders(sorted)
    } catch (err: any) {
      toast.error('Failed to load provider scorecard', {
        description: err?.response?.data?.message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const totalProviders = providers.length
  const avgScore = totalProviders > 0
    ? Math.round(providers.reduce((s, p) => s + p.score, 0) / totalProviders)
    : 0
  const highRiskCount = providers.filter(p => p.riskLevel === 'high').length

  const chartData = providers.slice(0, 10).map(p => ({
    name: p.providerName.length > 16 ? p.providerName.slice(0, 14) + '…' : p.providerName,
    score: p.score,
    fill: barColor(p.score),
  }))

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Provider Scorecard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Performance ranking across all active providers
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={loading}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Providers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{loading ? '—' : totalProviders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {loading ? '—' : `${avgScore}/100`}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">High-Risk Providers</CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">
              {loading ? '—' : highRiskCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : providers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
            <BarChart3 className="h-10 w-10 opacity-30" />
            <p className="text-sm">No provider data available</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Bar chart — top 10 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top 10 Providers by Score</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => [`${value}/100`, 'Score']}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Scorecard table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">All Providers — Ranked by Score</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">Rank</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead className="text-right">Approval Rate</TableHead>
                    <TableHead className="text-right">Fraud Rate</TableHead>
                    <TableHead className="text-right">Incomplete Rate</TableHead>
                    <TableHead className="text-right">Resubmission Rate</TableHead>
                    <TableHead className="text-right">Total Claims</TableHead>
                    <TableHead className="text-center">Risk Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p, idx) => (
                    <TableRow key={p.providerId}>
                      <TableCell className="text-center font-mono text-muted-foreground text-xs">
                        #{idx + 1}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{p.providerName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.providerId}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground capitalize">
                        {p.providerType}
                      </TableCell>
                      <TableCell className="text-center">
                        {scoreBadge(p.score)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{pct(p.approvalRate)}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className={p.fraudRate > 0.05 ? 'text-red-500 font-semibold' : ''}>
                          {pct(p.fraudRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">{pct(p.incompleteRate)}</TableCell>
                      <TableCell className="text-right text-sm">{pct(p.resubmissionRate)}</TableCell>
                      <TableCell className="text-right text-sm">{p.totalClaims.toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        {riskBadge(p.riskLevel)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
