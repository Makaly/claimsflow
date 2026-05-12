import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
  FileText, CheckCircle, XCircle, Clock, Building2,
  TrendingUp, DollarSign, Sparkles,
  Package, BarChart3, Layers, RefreshCw, Activity,
  TrendingDown, Percent,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, Legend, LineChart, Line, ComposedChart,
} from 'recharts'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import { useClaimsStore } from '@/store/claimsStore'
import { useAuthStore } from '@/store/authStore'
import ProviderDashboard from './ProviderDashboard'

const STATUS_COLORS: Record<string, string> = {
  approved:     'hsl(160,60%,45%)',
  paid:         'hsl(160,80%,35%)',
  under_review: 'hsl(220,70%,55%)',
  submitted:    'hsl(220,60%,65%)',
  incomplete:   'hsl(30,80%,55%)',
  rejected:     'hsl(0,72%,55%)',
}

const STATUS_LABELS: Record<string, string> = {
  approved:     'Approved',
  paid:         'Paid',
  under_review: 'Under Review',
  submitted:    'Submitted',
  incomplete:   'Incomplete',
  rejected:     'Rejected',
}

const CHART_COLORS = ['hsl(220,70%,50%)', 'hsl(160,60%,45%)', 'hsl(30,80%,55%)', 'hsl(280,65%,60%)', 'hsl(340,75%,55%)', 'hsl(190,70%,45%)']

interface ServerStats {
  total: number
  approved: number
  pending: number
  rejected: number
  totalAmount: number
  // workflow
  initial_review?: number
  maker_review?: number
  checker_review?: number
  final_approval?: number
}

const AUTO_REFRESH_SECS = 60

export default function Dashboard() {
  const { user } = useAuthStore()

  // Provider roles get their own focused dashboard
  if (user?.role === 'provider_admin' || user?.role === 'provider_user') {
    return <ProviderDashboard />
  }

  return <CICDashboard />
}

function CICDashboard() {
  const { claims } = useClaimsStore()
  const [serverStats, setServerStats] = useState<ServerStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECS)

  const fetchStats = useCallback(async () => {
    setRefreshing(true)
    const token = localStorage.getItem('token')
    const h = { Authorization: `Bearer ${token}` }
    try {
      const [cRes, wRes] = await Promise.all([
        fetch('/api/claims/statistics', { headers: h }),
        fetch('/api/workflow/statistics', { headers: h }),
      ])
      const s: ServerStats = { total: 0, approved: 0, pending: 0, rejected: 0, totalAmount: 0 }
      if (cRes.ok) {
        const d = await cRes.json()
        s.total = d.total ?? 0
        s.approved = (d.approved ?? 0) + (d.processing ?? 0)
        s.pending = d.pending ?? 0
        s.rejected = d.rejected ?? 0
        s.totalAmount = d.totalAmount ?? 0
      }
      if (wRes.ok) {
        const w = await wRes.json()
        s.initial_review = w.initial_review
        s.maker_review = w.maker_review
        s.checker_review = w.checker_review
        s.final_approval = w.final_approval
      }
      if (cRes.ok || wRes.ok) {
        setServerStats(s)
        setLastRefresh(new Date())
        setCountdown(AUTO_REFRESH_SECS)
      }
    } catch { /* keep local stats */ }
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  // Auto-refresh countdown
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchStats(); return AUTO_REFRESH_SECS }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [fetchStats])

  // ── Core stats ───────────────────────────────────────────────────────────
  const totalClaims    = claims.length
  const approvedClaims = claims.filter(c => c.status === 'approved' || c.status === 'paid').length
  const pendingClaims  = claims.filter(c => ['submitted', 'under_review', 'incomplete'].includes(c.status)).length
  const rejectedClaims = claims.filter(c => c.status === 'rejected').length
  const totalAmount    = claims.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
  const aiExtractedCount = claims.filter(c => c.aiExtracted).length

  // ── Workflow stage counts ─────────────────────────────────────────────────
  const initialReview  = claims.filter(c => c.workflowStage === 'initial_review').length
  const makerReview    = claims.filter(c => c.workflowStage === 'maker_review').length
  const checkerReview  = claims.filter(c => c.workflowStage === 'checker_review').length
  const finalApproval  = claims.filter(c => c.workflowStage === 'final_approval').length
  const completed      = claims.filter(c => c.workflowStage === 'completed').length

  // ── Batch stats ───────────────────────────────────────────────────────────
  const batchMap = useMemo(() => {
    const m = new Map<string, { batchNumber: string; uploadedBy: string; date: string; claims: typeof claims; amount: number; providers: Set<string> }>()
    claims.forEach(c => {
      if (!c.batchId) return
      if (!m.has(c.batchId)) {
        m.set(c.batchId, {
          batchNumber: c.batchNumber || c.batchId,
          uploadedBy:  c.uploadedBy  || '—',
          date:        c.submittedAt,
          claims:      [],
          amount:      0,
          providers:   new Set(),
        })
      }
      const b = m.get(c.batchId)!
      b.claims.push(c)
      b.amount += c.invoiceAmount || 0
      if (c.provider?.name) b.providers.add(c.provider.name)
      if (c.submittedAt < b.date) b.date = c.submittedAt
    })
    return m
  }, [claims])

  const batches       = Array.from(batchMap.values())
  const totalBatches  = batches.length
  const avgPerBatch   = totalBatches > 0 ? (claims.filter(c => c.batchId).length / totalBatches).toFixed(1) : '—'
  const latestBatch   = batches.sort((a, b) => b.date.localeCompare(a.date))[0]
  const recentBatches = Array.from(new Map(batches.map(b => [b.batchNumber, b])).values()).slice(0, 8)

  // ── Per-provider stats ────────────────────────────────────────────────────
  const providerMap = useMemo(() => {
    const m = new Map<string, Record<string, number> & { total: number; amount: number }>()
    claims.forEach(c => {
      const prov = c.provider?.name || 'Unknown'
      if (!m.has(prov)) m.set(prov, { total: 0, amount: 0, approved: 0, paid: 0, submitted: 0, under_review: 0, incomplete: 0, rejected: 0 })
      const p = m.get(prov)!
      p.total++
      p.amount += c.invoiceAmount || 0
      if (p[c.status] !== undefined) p[c.status]++
      else p[c.status] = 1
    })
    return m
  }, [claims])

  interface ProviderRow { name: string; fullName: string; total: number; amount: number; [status: string]: number | string }
  const providerChartData = Array.from(providerMap.entries()).map(([pname, stats]) => ({
    name: pname.length > 22 ? pname.slice(0, 20) + '…' : pname,
    fullName: pname,
    ...stats,
  } as ProviderRow)).sort((a, b) => (b.total as number) - (a.total as number))

  const providerTableData = providerChartData.map(p => ({
    ...p,
    approvalRate: (p.total as number) > 0
      ? Math.round((((p['approved'] as number ?? 0) + (p['paid'] as number ?? 0)) / (p.total as number)) * 100)
      : 0,
  }))

  // Which statuses actually appear across all claims
  const activeStatuses = useMemo(() => {
    const s = new Set<string>()
    claims.forEach(c => s.add(c.status))
    return Array.from(s)
  }, [claims])

  // ── Status pie ────────────────────────────────────────────────────────────
  const statusPieData = [
    { name: 'Approved/Paid', value: approvedClaims },
    { name: 'Pending',       value: pendingClaims  },
    { name: 'Rejected',      value: rejectedClaims },
  ].filter(d => d.value > 0)

  // ── Monthly trend — stable, no random values ─────────────────────────────
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthlyData = useMemo(() => {
    const map = new Map<string, { claims: number; approved: number; amount: number }>()
    claims.forEach(c => {
      const d   = new Date(c.submittedAt)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
      if (!map.has(key)) map.set(key, { claims: 0, approved: 0, amount: 0 })
      const m = map.get(key)!
      m.claims++
      if (c.status === 'approved' || c.status === 'paid') m.approved++
      m.amount += c.invoiceAmount || 0
    })
    // Always show last 6 calendar months — fill missing months with zeros
    const now = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
      return { month: monthNames[d.getMonth()], ...(map.get(key) ?? { claims: 0, approved: 0, amount: 0 }) }
    })
  }, [claims])

  // ── Recent claims ─────────────────────────────────────────────────────────
  const recentClaims = [...claims]
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 8)

  const uniqueProviders = new Set(claims.map(c => c.provider?.name)).size
  const approvalRate = totalClaims > 0 ? ((approvedClaims / totalClaims) * 100).toFixed(1) : '0.0'
  const avgAmount = totalClaims > 0 ? totalAmount / totalClaims : 0

  // ── Daily submissions — last 14 days ─────────────────────────────────────
  const dailyData = useMemo(() => {
    const days: { date: string; label: string; submitted: number; approved: number; rejected: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      const label = `${d.getDate()}/${d.getMonth() + 1}`
      days.push({ date: key, label, submitted: 0, approved: 0, rejected: 0 })
    }
    claims.forEach(c => {
      const key = new Date(c.submittedAt).toISOString().split('T')[0]
      const day = days.find(d => d.date === key)
      if (day) {
        day.submitted++
        if (c.status === 'approved' || c.status === 'paid') day.approved++
        if (c.status === 'rejected') day.rejected++
      }
    })
    return days
  }, [claims])

  // ── Amount by provider (top 6) ────────────────────────────────────────────
  const amountByProvider = providerChartData.slice(0, 6).map(p => ({
    name: p.name,
    amount: p.amount as number,
  }))

  // ── Stat cards — prefer server stats for accurate totals ─────────────────
  const sc = serverStats
  const statCards = [
    { title: 'Total Claims',   value: (sc?.total ?? totalClaims).toLocaleString(),      icon: FileText,     color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-950/30'    },
    { title: 'Approved',       value: (sc?.approved ?? approvedClaims).toLocaleString(), icon: CheckCircle, color: 'text-emerald-600',  bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { title: 'Pending',        value: (sc?.pending ?? pendingClaims).toLocaleString(),   icon: Clock,       color: 'text-amber-600',    bg: 'bg-amber-50 dark:bg-amber-950/30'    },
    { title: 'Rejected',       value: (sc?.rejected ?? rejectedClaims).toLocaleString(), icon: XCircle,     color: 'text-red-600',      bg: 'bg-red-50 dark:bg-red-950/30'        },
    { title: 'Total Amount',   value: formatCurrency(sc?.totalAmount ?? totalAmount),    icon: DollarSign,  color: 'text-primary',      bg: 'bg-primary/5'                        },
    { title: 'Approval Rate',  value: `${approvalRate}%`,                                icon: Percent,     color: 'text-teal-600',     bg: 'bg-teal-50 dark:bg-teal-950/30'      },
    { title: 'Avg Claim',      value: formatCurrency(avgAmount),                         icon: Activity,    color: 'text-indigo-600',   bg: 'bg-indigo-50 dark:bg-indigo-950/30'  },
    { title: 'Providers',      value: String(uniqueProviders),                           icon: Building2,   color: 'text-violet-600',   bg: 'bg-violet-50 dark:bg-violet-950/30'  },
    { title: 'Total Batches',  value: String(totalBatches),                              icon: Package,     color: 'text-sky-600',      bg: 'bg-sky-50 dark:bg-sky-950/30'        },
    { title: 'AI Extracted',   value: aiExtractedCount.toLocaleString(),                 icon: Sparkles,    color: 'text-fuchsia-600',  bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/30'},
  ]

  // ── Custom tooltip for provider bar chart ─────────────────────────────────
  const ProviderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const data = providerChartData.find(p => p.name === label)
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-sm min-w-[200px]">
        <p className="font-semibold text-foreground mb-2">{data?.fullName || label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.fill }} />
              <span className="text-muted-foreground">{STATUS_LABELS[p.dataKey] || p.dataKey}</span>
            </div>
            <span className="font-medium">{p.value}</span>
          </div>
        ))}
        <div className="border-t border-border mt-2 pt-2 flex justify-between">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{data?.total}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Real-time overview of claims processing performance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live · refreshes in {countdown}s
          </div>
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat) => (
          <Card key={stat.title} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <div className={`p-2 rounded-md ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Trend + Pie ────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-blue-500" /> Claims Trend</CardTitle>
            <CardDescription>Submission and approval volume over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="claims"   stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.12} strokeWidth={2} name="Total"    />
                <Area type="monotone" dataKey="approved" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.12} strokeWidth={2} name="Approved" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-violet-500" /> Status Distribution</CardTitle>
            <CardDescription>Current claims by overall status</CardDescription>
          </CardHeader>
          <CardContent>
            {statusPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={4} dataKey="value"
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {statusPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">No claims data yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Daily Volume + Amount by Provider ────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-sky-500" /> Daily Submission Volume</CardTitle>
            <CardDescription>Claims submitted per day — last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 10 }} />
                <YAxis className="text-xs" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                <Bar dataKey="submitted" name="Submitted" fill={CHART_COLORS[0]} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                <Bar dataKey="approved" name="Approved" fill={CHART_COLORS[1]} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                <Bar dataKey="rejected" name="Rejected" fill="hsl(0,72%,55%)" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                <Legend />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-500" /> Amount by Provider (Top 6)</CardTitle>
            <CardDescription>Total invoice value per provider</CardDescription>
          </CardHeader>
          <CardContent>
            {amountByProvider.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={amountByProvider} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" className="text-xs" tick={{ fontSize: 10 }}
                    tickFormatter={v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                  <YAxis type="category" dataKey="name" className="text-xs" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Bar dataKey="amount" name="Amount" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground">No provider data yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Per-Provider Analysis ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-violet-500" /> Provider Analysis</CardTitle>
              <CardDescription>Claims volume and status breakdown per provider</CardDescription>
            </div>
            <Badge variant="secondary">{uniqueProviders} Provider{uniqueProviders !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chart">
            <TabsList className="mb-4">
              <TabsTrigger value="chart">Stacked Chart</TabsTrigger>
              <TabsTrigger value="table">Summary Table</TabsTrigger>
            </TabsList>

            <TabsContent value="chart">
              {providerChartData.length > 0 ? (
                <div className="space-y-4">
                  {/* Top-mounted legend — decoupled from chart so it can't overlap axis labels */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                    {activeStatuses.map((status) => {
                      const count = providerChartData.reduce(
                        (sum, p) => sum + ((p[status] as number) || 0),
                        0,
                      )
                      return (
                        <div key={status} className="flex items-center gap-2 text-xs">
                          <span
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{ background: STATUS_COLORS[status] || 'hsl(220,60%,60%)' }}
                          />
                          <span className="font-medium text-foreground">
                            {STATUS_LABELS[status] || status}
                          </span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                      )
                    })}
                  </div>

                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(240, providerChartData.length * 44 + 40)}
                  >
                    <BarChart
                      data={providerChartData}
                      layout="vertical"
                      margin={{ top: 8, right: 32, left: 8, bottom: 8 }}
                      barCategoryGap={12}
                    >
                      <CartesianGrid
                        horizontal={false}
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        className="text-xs"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={180}
                        tick={{ fontSize: 12 }}
                        className="text-xs"
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                        content={<ProviderTooltip />}
                      />
                      {activeStatuses.map((status, i) => {
                        const isFirst = i === 0
                        const isLast = i === activeStatuses.length - 1
                        return (
                          <Bar
                            key={status}
                            dataKey={status}
                            stackId="providers"
                            fill={STATUS_COLORS[status] || 'hsl(220,60%,60%)'}
                            name={STATUS_LABELS[status] || status}
                            radius={
                              isFirst && isLast
                                ? [6, 6, 6, 6]
                                : isFirst
                                ? [6, 0, 0, 6]
                                : isLast
                                ? [0, 6, 6, 0]
                                : [0, 0, 0, 0]
                            }
                          />
                        )
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[320px] text-muted-foreground">No provider data yet</div>
              )}
            </TabsContent>

            <TabsContent value="table">
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Amount (KES)</TableHead>
                      <TableHead className="text-right w-40">Approval Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerTableData.map((p) => {
                      const r = p as Record<string, unknown>
                      const n = (k: string) => (r[k] as number) ?? 0
                      return (
                        <TableRow key={p.fullName}>
                          <TableCell className="font-medium">{p.fullName}</TableCell>
                          <TableCell className="text-right font-semibold">{p.total}</TableCell>
                          <TableCell className="text-right text-emerald-600">{n('approved') + n('paid')}</TableCell>
                          <TableCell className="text-right text-amber-600">{n('submitted') + n('under_review') + n('incomplete')}</TableCell>
                          <TableCell className="text-right text-red-600">{n('rejected')}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <Progress value={p.approvalRate} className="h-1.5 w-20" />
                              <span className="text-xs font-medium w-8">{p.approvalRate}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {providerTableData.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No provider data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Batch Summary + Workflow ───────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Batch stats cards */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-sky-500" /> Batch Overview</CardTitle>
            <CardDescription>Bulk upload batch statistics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Total Batches</div>
                <div className="text-2xl font-bold text-sky-700 dark:text-sky-300">{totalBatches}</div>
              </div>
              <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Avg per Batch</div>
                <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{avgPerBatch}</div>
              </div>
            </div>
            {latestBatch && (
              <div className="border rounded-lg p-3 space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Latest Batch</div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">{latestBatch.batchNumber}</span>
                  <Badge variant="outline" className="text-xs">{latestBatch.claims.length} claims</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{formatDate(latestBatch.date)}</div>
                <div className="text-xs text-muted-foreground">by {latestBatch.uploadedBy}</div>
                <div className="font-medium text-sm">{formatCurrency(latestBatch.amount)}</div>
                {latestBatch.providers.size > 1 && (
                  <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200" variant="outline">
                    Mixed — {latestBatch.providers.size} providers
                  </Badge>
                )}
              </div>
            )}
            {totalBatches === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">No batches uploaded yet</div>
            )}
          </CardContent>
        </Card>

        {/* Workflow pipeline */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-blue-500" /> Workflow Pipeline</CardTitle>
            <CardDescription>Claims at each processing stage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { stage: 'Initial Review', count: initialReview,  color: 'bg-blue-500'   },
                { stage: 'Maker Review',   count: makerReview,    color: 'bg-violet-500' },
                { stage: 'Checker Review', count: checkerReview,  color: 'bg-amber-500'  },
                { stage: 'Final Approval', count: finalApproval,  color: 'bg-orange-500' },
                { stage: 'Completed',      count: completed,      color: 'bg-emerald-500'},
              ].map((item) => (
                <div key={item.stage} className="flex items-center gap-3">
                  <div className="w-32 text-sm font-medium">{item.stage}</div>
                  <div className="flex-1">
                    <Progress value={totalClaims > 0 ? (item.count / totalClaims) * 100 : 0} className="h-2" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span className="w-8 text-right text-sm font-medium">{item.count}</span>
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {totalClaims > 0 ? `${((item.count / totalClaims) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent Batches ─────────────────────────────────────────────── */}
      {totalBatches > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-sky-500" /> Recent Batches</CardTitle>
            <CardDescription>Latest bulk upload batches with provider breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Batch Number</TableHead>
                    <TableHead>Uploaded By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Claims</TableHead>
                    <TableHead className="text-right">Amount (KES)</TableHead>
                    <TableHead>Providers</TableHead>
                    <TableHead>Status Breakdown</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentBatches.map((batch, idx) => {
                    const approved = batch.claims.filter(c => c.status === 'approved' || c.status === 'paid').length
                    const pending  = batch.claims.filter(c => ['submitted','under_review','incomplete'].includes(c.status)).length
                    const rejected = batch.claims.filter(c => c.status === 'rejected').length
                    return (
                      <TableRow key={`${batch.batchNumber}-${idx}`}>
                        <TableCell>
                          <span className="font-mono font-medium text-sm">{batch.batchNumber}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{batch.uploadedBy}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(batch.date)}</TableCell>
                        <TableCell className="text-right font-semibold">{batch.claims.length}</TableCell>
                        <TableCell className="text-right">{formatCurrency(batch.amount)}</TableCell>
                        <TableCell>
                          {batch.providers.size > 1 ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs" variant="outline">
                              Mixed ({batch.providers.size})
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">{Array.from(batch.providers)[0] || '—'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs">
                            {approved > 0 && <span className="text-emerald-600 font-medium">{approved} approved</span>}
                            {pending  > 0 && <span className="text-amber-600">{pending} pending</span>}
                            {rejected > 0 && <span className="text-red-600">{rejected} rejected</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recent Claims ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-500" /> Recent Claims</CardTitle>
          <CardDescription>Latest claims across all channels ({claims.length} total)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Claim Number</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentClaims.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {claim.claimNumber}
                        {claim.aiExtracted && <Sparkles className="h-3 w-3 text-violet-400" />}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{claim.memberName}</TableCell>
                    <TableCell className="text-sm">{claim.provider?.name}</TableCell>
                    <TableCell>
                      {claim.batchNumber ? (
                        <span className="font-mono text-xs bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded">
                          {claim.batchNumber}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Single</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(claim.invoiceAmount)}</TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(claim.status)} variant="secondary">
                        {claim.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(claim.submittedAt)}</TableCell>
                  </TableRow>
                ))}
                {recentClaims.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No claims yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
