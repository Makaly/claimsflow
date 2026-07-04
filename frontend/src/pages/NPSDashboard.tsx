import { useState, useEffect } from 'react'
import { BarChart3, RefreshCw, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/services/api'

interface NpsDashboard {
  total: number
  avgScore: number
  npsScore: number
  byClaimType: Record<string, { count: number; avg: number }>
  byProvider: Record<string, { count: number; avg: number }>
  byRejectionReason: Record<string, { count: number; avg: number }>
}

function SegmentTable({ title, data }: { title: string; data: Record<string, { count: number; avg: number }> }) {
  const rows = Object.entries(data).sort((a, b) => a[1].avg - b[1].avg)
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
              <th className="text-right py-1 font-medium text-muted-foreground">Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b last:border-0">
                <td className="py-1 max-w-[200px] truncate">{k}</td>
                <td className="py-1 text-right">{v.count}</td>
                <td className={`py-1 text-right font-medium ${v.avg >= 9 ? 'text-emerald-600' : v.avg >= 7 ? 'text-amber-600' : 'text-red-600'}`}>
                  {v.avg}
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
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fetch = async () => {
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
  }

  useEffect(() => { fetch() }, [])

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
        </div>
      </div>

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Total Responses', value: data.total, icon: BarChart3, color: 'text-blue-600' },
              { label: 'Avg Score', value: data.avgScore, icon: TrendingUp, color: 'text-amber-600' },
              { label: 'NPS Score', value: `${data.npsScore > 0 ? '+' : ''}${data.npsScore}`, icon: TrendingUp, color: data.npsScore >= 50 ? 'text-emerald-600' : data.npsScore >= 0 ? 'text-amber-600' : 'text-red-600' },
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

          <div className="grid gap-4 md:grid-cols-3">
            <SegmentTable title="By Claim Type" data={data.byClaimType} />
            <SegmentTable title="By Provider" data={data.byProvider} />
            <SegmentTable title="By Rejection Reason" data={data.byRejectionReason} />
          </div>
        </>
      )}

      {!data && !loading && (
        <p className="text-muted-foreground text-sm">No NPS data available yet.</p>
      )}
    </div>
  )
}
