import { useState, useEffect, useCallback } from 'react'
import { BarChart3, RefreshCw, TrendingUp, Download, MessageSquare, Smile, Meh, Frown } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/services/api'

interface SegmentStat { count: number; avg: number; nps: number }
interface NpsDashboard {
  total: number
  avgScore: number
  npsScore: number
  breakdown: {
    promoters: { count: number; pct: number }
    passives: { count: number; pct: number }
    detractors: { count: number; pct: number }
  }
  distribution: { score: number; count: number }[]
  trend: { date: string; count: number; nps: number; avg: number }[]
  byClaimType: Record<string, SegmentStat>
  byProvider: Record<string, SegmentStat>
  byRejectionReason: Record<string, SegmentStat>
  recentComments: {
    id: string; score: number; comment: string | null
    bucket: 'promoter' | 'passive' | 'detractor'; channel: string; createdAt: string
  }[]
}

const npsColor = (n: number) => (n >= 50 ? 'text-emerald-600' : n >= 0 ? 'text-amber-600' : 'text-red-600')
const scoreColor = (s: number) => (s >= 9 ? '#10b981' : s >= 7 ? '#f59e0b' : '#ef4444')

function SegmentTable({ title, data }: { title: string; data: Record<string, SegmentStat> }) {
  const rows = Object.entries(data).sort((a, b) => a[1].nps - b[1].nps)
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 font-medium text-muted-foreground">Segment</th>
              <th className="text-right py-1 font-medium text-muted-foreground">Count</th>
              <th className="text-right py-1 font-medium text-muted-foreground">Avg</th>
              <th className="text-right py-1 font-medium text-muted-foreground">NPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b last:border-0">
                <td className="py-1 max-w-[160px] truncate" title={k}>{k}</td>
                <td className="py-1 text-right tabular-nums">{v.count}</td>
                <td className="py-1 text-right tabular-nums">{v.avg}</td>
                <td className={`py-1 text-right font-medium tabular-nums ${npsColor(v.nps)}`}>
                  {v.nps > 0 ? '+' : ''}{v.nps}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export default function NPSDashboard() {
  const [data, setData] = useState<NpsDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const { data: d } = await api.get(`/nps/dashboard?${params}`)
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { fetch() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await api.get(`/nps/export?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nps-responses-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const hasData = !!data && data.total > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">NPS Dashboard</h1>
          <p className="text-muted-foreground">Net Promoter Score by claim type, provider, and rejection reason</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36 text-xs h-8" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36 text-xs h-8" />
          <Button size="sm" onClick={fetch} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting || !hasData}>
            <Download className={`h-3.5 w-3.5 mr-1 ${exporting ? 'animate-pulse' : ''}`} /> Export CSV
          </Button>
        </div>
      </div>

      {data && (
        <>
          {/* ── Headline KPIs ──────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Total Responses', value: data.total, icon: BarChart3, color: 'text-blue-600' },
              { label: 'Avg Score', value: data.avgScore, icon: TrendingUp, color: 'text-amber-600' },
              { label: 'NPS Score', value: `${data.npsScore > 0 ? '+' : ''}${data.npsScore}`, icon: TrendingUp, color: npsColor(data.npsScore) },
            ].map(s => (
              <Card key={s.label}>
                <CardHeader className="pb-1 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </CardHeader>
                <CardContent>
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Promoter / Passive / Detractor split ───────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Respondent breakdown</CardTitle>
              <CardDescription>Promoters (9–10) · Passives (7–8) · Detractors (0–6)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className="bg-emerald-500" style={{ width: `${data.breakdown.promoters.pct}%` }} title={`Promoters ${data.breakdown.promoters.pct}%`} />
                <div className="bg-amber-400" style={{ width: `${data.breakdown.passives.pct}%` }} title={`Passives ${data.breakdown.passives.pct}%`} />
                <div className="bg-red-400" style={{ width: `${data.breakdown.detractors.pct}%` }} title={`Detractors ${data.breakdown.detractors.pct}%`} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Promoters', icon: Smile, count: data.breakdown.promoters.count, pct: data.breakdown.promoters.pct, color: 'text-emerald-600' },
                  { label: 'Passives', icon: Meh, count: data.breakdown.passives.count, pct: data.breakdown.passives.pct, color: 'text-amber-600' },
                  { label: 'Detractors', icon: Frown, count: data.breakdown.detractors.count, pct: data.breakdown.detractors.pct, color: 'text-red-600' },
                ].map(b => (
                  <div key={b.label} className="rounded-lg border p-2">
                    <b.icon className={`h-4 w-4 mx-auto mb-1 ${b.color}`} />
                    <p className={`text-xl font-bold ${b.color}`}>{b.count}</p>
                    <p className="text-[11px] text-muted-foreground">{b.label} · {b.pct}%</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Trend + distribution charts ────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">NPS trend</CardTitle>
                <CardDescription>Daily NPS over the selected range</CardDescription>
              </CardHeader>
              <CardContent>
                {data.trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis domain={[-100, 100]} tick={{ fontSize: 10 }} />
                      <ReferenceLine y={0} className="stroke-muted-foreground" strokeDasharray="2 2" />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(v: number, name: string) => [v, name === 'nps' ? 'NPS' : name]}
                      />
                      <Line type="monotone" dataKey="nps" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="text-xs text-muted-foreground py-8 text-center">Not enough data for a trend yet.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Score distribution</CardTitle>
                <CardDescription>How many respondents gave each score 0–10</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.distribution} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="score" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {data.distribution.map((d) => <Cell key={d.score} fill={scoreColor(d.score)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* ── Segment breakdowns ─────────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-3">
            <SegmentTable title="By Claim Type" data={data.byClaimType} />
            <SegmentTable title="By Provider" data={data.byProvider} />
            <SegmentTable title="By Rejection Reason" data={data.byRejectionReason} />
          </div>

          {/* ── Recent verbatims ───────────────────────────────────────────── */}
          {data.recentComments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-violet-600" /> Recent comments
                </CardTitle>
                <CardDescription>Latest member verbatims</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.recentComments.map(c => (
                  <div key={c.id} className="flex items-start gap-3 rounded-lg border p-2.5">
                    <div
                      className="shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: scoreColor(c.score) }}
                    >
                      {c.score}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm">{c.comment}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                        {c.bucket} · {c.channel.replace('_', ' ')} · {new Date(c.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!hasData && !loading && (
        <p className="text-muted-foreground text-sm">No NPS data available yet.</p>
      )}
    </div>
  )
}
