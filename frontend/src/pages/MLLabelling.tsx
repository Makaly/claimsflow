import { useState, useEffect, useCallback } from 'react'
import {
  Database, Download, RefreshCw, CheckCircle, AlertTriangle, ShieldAlert,
  TrendingUp, BarChart3, FileText, FileSpreadsheet, Activity, Target,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

const LABEL_META: Record<string, { icon: any; color: string; bar: string }> = {
  legitimate: { icon: CheckCircle,  color: 'text-green-700 bg-green-50 border-green-200',  bar: 'bg-green-500'  },
  suspicious: { icon: AlertTriangle, color: 'text-amber-700 bg-amber-50 border-amber-200', bar: 'bg-amber-500'  },
  fraud:      { icon: ShieldAlert,  color: 'text-red-700 bg-red-50 border-red-200',        bar: 'bg-red-500'    },
}

function StatBar({ value, max, colour }: { value: number; max: number; colour: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
      <div className={`h-full rounded ${colour}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function MiniBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded overflow-hidden">
      <div className={`h-full rounded ${colour}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

export default function MLLabelling() {
  const [labels, setLabels]           = useState<any[]>([])
  const [distribution, setDistribution] = useState<Record<string, number>>({})
  const [total, setTotal]             = useState(0)
  const [labelFilter, setLabelFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [loading, setLoading]         = useState(false)
  const [factorStats, setFactorStats] = useState<any | null>(null)
  const [analysis, setAnalysis]       = useState<any | null>(null)
  const [activeTab, setActiveTab]     = useState<'dataset' | 'analysis'>('dataset')
  const [exporting, setExporting]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (labelFilter !== 'all') params.set('label', labelFilter)
      if (sourceFilter !== 'all') params.set('source', sourceFilter)

      // Use allSettled so a 403 on one endpoint never blanks the whole page.
      const [labelsRes, factorRes, analysisRes] = await Promise.allSettled([
        api.get(`/claim-labels?${params}`),
        api.get('/claim-labels/ml/factor-effectiveness'),
        api.get('/claim-labels/analysis/deep'),
      ])

      if (labelsRes.status === 'fulfilled') {
        setLabels(labelsRes.value.data.items || [])
        setDistribution(labelsRes.value.data.distribution || {})
        setTotal(labelsRes.value.data.total || 0)
      }
      if (factorRes.status === 'fulfilled') setFactorStats(factorRes.value.data)
      if (analysisRes.status === 'fulfilled') setAnalysis(analysisRes.value.data)
    } finally {
      setLoading(false)
    }
  }, [labelFilter, sourceFilter])

  useEffect(() => { load() }, [load])

  const downloadFile = async (path: string, filename: string) => {
    setExporting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const date = new Date().toISOString().slice(0, 10)

  const updateLabel = async (claimId: string, newLabel: string) => {
    try {
      await api.post(`/claim-labels/${claimId}`, { label: newLabel })
      load()
    } catch {}
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-blue-600" /> ML Labelling
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Training dataset accumulated from workflow decisions — powers fraud scoring and weight calibration
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={exporting}>
                <Download className="h-4 w-4 mr-1" />
                {exporting ? 'Exporting…' : 'Export'}
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => downloadFile('/claim-labels/export/excel', `claim-labels-${date}.xlsx`)}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                Excel (.xlsx) — recommended
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadFile('/claim-labels/export/csv', `claim-labels-${date}.csv`)}>
                <FileText className="h-4 w-4 mr-2 text-blue-600" />
                CSV — universal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadFile('/claim-labels/export', `claim-labels-${date}.json`)}>
                <Database className="h-4 w-4 mr-2 text-gray-600" />
                JSON — ML training
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{total}</div>
            <div className="text-xs text-gray-500">Total labels</div>
            <div className="text-xs text-gray-400 mt-1">
              {total >= 50 ? '✓ Enough to calibrate' : `${50 - total} more needed to calibrate`}
            </div>
          </CardContent>
        </Card>
        {['legitimate', 'suspicious', 'fraud'].map(l => {
          const info = LABEL_META[l]
          const Icon = info.icon
          const cnt = distribution[l] ?? 0
          const pct = total > 0 ? ((cnt / total) * 100).toFixed(0) : '0'
          return (
            <Card key={l} className={`border ${info.color.split(' ')[2]}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${info.color.split(' ')[0]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-2xl font-bold">{cnt}</div>
                  <div className="text-xs text-gray-500 capitalize">{l}</div>
                  <div className="text-xs text-gray-400">{pct}% of dataset</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-4">
        {([
          { key: 'dataset',  label: 'Dataset',        icon: Database  },
          { key: 'analysis', label: 'Deep Analysis',  icon: BarChart3 },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 pb-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── DATASET TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'dataset' && (
        <>
          {/* Factor effectiveness */}
          {factorStats && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Factor Predictive Power
                </CardTitle>
                <CardDescription className="text-xs">
                  {factorStats.message ?? `Based on ${factorStats.sampleSize} labelled claims — higher bar = more predictive of fraud`}
                </CardDescription>
              </CardHeader>
              {factorStats.factors?.length > 0 && (
                <CardContent>
                  <div className="space-y-2">
                    {factorStats.factors.map((f: any) => (
                      <div key={f.name} className="flex items-center gap-3">
                        <div className="w-44 text-xs text-gray-700 capitalize truncate">
                          {f.name.replace(/([A-Z])/g, ' $1')}
                        </div>
                        <StatBar value={f.separation} max={1} colour="bg-blue-500" />
                        <div className="w-14 text-right text-xs font-mono text-gray-600">
                          {(f.separation * 100).toFixed(0)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Filters + table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Labelled Claims</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-3">
                <Select value={labelFilter} onValueChange={setLabelFilter}>
                  <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All labels</SelectItem>
                    <SelectItem value="legitimate">Legitimate</SelectItem>
                    <SelectItem value="suspicious">Suspicious</SelectItem>
                    <SelectItem value="fraud">Fraud</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="manual_review">Manual review</SelectItem>
                    <SelectItem value="auto_approve">Auto (approve)</SelectItem>
                    <SelectItem value="auto_reject">Auto (reject)</SelectItem>
                    <SelectItem value="fraud_confirmed">Fraud confirmed</SelectItem>
                    <SelectItem value="appeal_outcome">Appeal outcome</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim ID</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Invoice Amount</TableHead>
                    <TableHead>Anomaly Score</TableHead>
                    <TableHead>OCR Confidence</TableHead>
                    <TableHead>Fraud Signals</TableHead>
                    <TableHead>Labelled</TableHead>
                    <TableHead>Correct?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labels.map(l => {
                    const f = l.featuresSnapshot ?? {}
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs">{l.claimId.slice(0, 8)}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${LABEL_META[l.label]?.color || ''}`}>
                            {l.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{l.source}</TableCell>
                        <TableCell className="text-sm font-medium">
                          {f.invoiceAmount != null ? `KES ${Number(f.invoiceAmount).toLocaleString()}` : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {f.anomalyScore != null ? (
                            <span className={`font-medium ${f.anomalyScore >= 0.6 ? 'text-red-600' : f.anomalyScore >= 0.3 ? 'text-amber-600' : 'text-green-600'}`}>
                              {Math.round(f.anomalyScore * 100)}%
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {f.ocrConfidence != null ? (
                            <span className={f.ocrConfidence < 0.7 ? 'text-amber-600' : 'text-gray-700'}>
                              {Math.round(f.ocrConfidence * 100)}%
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {f.fraudSignalCritical > 0
                            ? <span className="text-red-600 font-medium">{f.fraudSignalCritical} critical</span>
                            : f.fraudSignalCount > 0
                              ? <span className="text-amber-600">{f.fraudSignalCount} warn</span>
                              : <span className="text-gray-400">none</span>
                          }
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{formatDate(l.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {['legitimate', 'suspicious', 'fraud'].map(opt => (
                              <button
                                key={opt}
                                onClick={() => updateLabel(l.claimId, opt)}
                                title={opt}
                                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                  l.label === opt
                                    ? LABEL_META[opt].color + ' border'
                                    : 'text-gray-400 hover:bg-gray-100'
                                }`}
                              >
                                {opt[0].toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {labels.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-8">
                        No labels yet — auto-labels appear here as claims are approved, rejected, or fraud-reviewed
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── DEEP ANALYSIS TAB ───────────────────────────────────────────── */}
      {activeTab === 'analysis' && analysis && analysis.total > 0 && (
        <div className="space-y-6">

          {/* Per-label feature averages */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" /> Feature Averages by Label Class
              </CardTitle>
              <CardDescription className="text-xs">
                How each label class differs across key features — wider gaps indicate better predictors
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 text-left">
                      <th className="pb-2 font-medium">Metric</th>
                      <th className="pb-2 font-medium text-green-700">Legitimate</th>
                      <th className="pb-2 font-medium text-amber-700">Suspicious</th>
                      <th className="pb-2 font-medium text-red-700">Fraud</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[
                      { key: 'avgAmount',         label: 'Avg Invoice (KES)',      fmt: (v: number) => `KES ${v.toLocaleString()}` },
                      { key: 'avgAnomaly',         label: 'Avg Anomaly Score',      fmt: (v: number) => `${v}%` },
                      { key: 'avgOcrConf',         label: 'Avg OCR Confidence',     fmt: (v: number) => `${v}%` },
                      { key: 'avgFraudSignals',    label: 'Avg Fraud Signals',      fmt: (v: number) => v.toFixed(1) },
                      { key: 'avgCriticalSignals', label: 'Avg Critical Signals',   fmt: (v: number) => v.toFixed(1) },
                    ].map(row => (
                      <tr key={row.key} className="py-1">
                        <td className="py-2 text-xs text-gray-600 font-medium">{row.label}</td>
                        {['legitimate', 'suspicious', 'fraud'].map(lbl => (
                          <td key={lbl} className="py-2 font-mono text-xs">
                            {analysis.labelStats[lbl]
                              ? row.fmt(analysis.labelStats[lbl][row.key])
                              : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 text-xs text-gray-600 font-medium">Count</td>
                      {['legitimate', 'suspicious', 'fraud'].map(lbl => (
                        <td key={lbl} className="py-2 text-xs font-medium">
                          {analysis.labelStats[lbl]?.count ?? 0}
                          {' '}
                          <span className="text-gray-400">({analysis.labelStats[lbl]?.pct ?? 0}%)</span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Monthly trend */}
          {analysis.trend?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Monthly Label Trend
                </CardTitle>
                <CardDescription className="text-xs">
                  Volume and composition of labelled claims over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analysis.trend.map((m: any) => {
                    const monthTotal = (m.legitimate ?? 0) + (m.suspicious ?? 0) + (m.fraud ?? 0)
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <div className="w-16 text-xs text-gray-500 font-mono">{m.month}</div>
                        <div className="flex-1 flex h-4 rounded overflow-hidden gap-px">
                          {monthTotal > 0 ? (
                            ['legitimate', 'suspicious', 'fraud'].map(lbl => {
                              const cnt = m[lbl] ?? 0
                              if (!cnt) return null
                              return (
                                <div
                                  key={lbl}
                                  className={`${LABEL_META[lbl].bar} flex items-center justify-center text-white text-xs`}
                                  style={{ width: `${cnt / monthTotal * 100}%` }}
                                  title={`${lbl}: ${cnt}`}
                                />
                              )
                            })
                          ) : (
                            <div className="flex-1 bg-gray-100 rounded" />
                          )}
                        </div>
                        <div className="w-8 text-right text-xs text-gray-500">{monthTotal}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  {['legitimate', 'suspicious', 'fraud'].map(lbl => (
                    <div key={lbl} className="flex items-center gap-1">
                      <div className={`w-3 h-3 rounded-sm ${LABEL_META[lbl].bar}`} />
                      <span className="capitalize">{lbl}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Invoice amount bands */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Fraud Rate by Invoice Amount
                </CardTitle>
                <CardDescription className="text-xs">
                  Higher-value invoices carry disproportionately higher fraud risk
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.amountBands?.map((b: any) => (
                    <div key={b.band}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">KES {b.band}</span>
                        <span className={`font-medium ${b.fraudRate >= 50 ? 'text-red-600' : b.fraudRate >= 20 ? 'text-amber-600' : 'text-gray-500'}`}>
                          {b.fraudRate}% fraud · {b.total} claims
                        </span>
                      </div>
                      <MiniBar pct={b.fraudRate} colour={b.fraudRate >= 50 ? 'bg-red-500' : b.fraudRate >= 20 ? 'bg-amber-400' : 'bg-green-400'} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* OCR confidence vs fraud */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Fraud Rate by OCR Confidence
                </CardTitle>
                <CardDescription className="text-xs">
                  Low OCR confidence correlates with higher fraud — poor capture quality masks manipulation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.ocrFraudRate?.map((b: any) => (
                    <div key={b.band}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">OCR {b.band}</span>
                        <span className={`font-medium ${b.fraudRate >= 50 ? 'text-red-600' : b.fraudRate >= 20 ? 'text-amber-600' : 'text-gray-500'}`}>
                          {b.fraudRate}% fraud · {b.total} claims
                        </span>
                      </div>
                      <MiniBar pct={b.fraudRate} colour={b.fraudRate >= 50 ? 'bg-red-500' : b.fraudRate >= 20 ? 'bg-amber-400' : 'bg-green-400'} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top fraud signals */}
          {analysis.topSignals?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-500" /> Most Frequent Fraud Signals
                </CardTitle>
                <CardDescription className="text-xs">
                  Signals ranked by frequency — fraud rate shows how often the signal appeared on confirmed fraud/suspicious claims
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Signal</TableHead>
                      <TableHead className="text-xs text-right">Occurrences</TableHead>
                      <TableHead className="text-xs">Fraud Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.topSignals.map((s: any) => (
                      <TableRow key={s.title}>
                        <TableCell className="text-xs font-medium">{s.title}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{s.total}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2">
                            <MiniBar pct={s.fraudRate} colour={s.fraudRate >= 70 ? 'bg-red-500' : s.fraudRate >= 40 ? 'bg-amber-400' : 'bg-gray-300'} />
                            <span className={`w-10 text-right font-mono ${s.fraudRate >= 70 ? 'text-red-600' : s.fraudRate >= 40 ? 'text-amber-600' : 'text-gray-500'}`}>
                              {s.fraudRate}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Label source breakdown */}
          {analysis.sourceCounts && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Label Source Breakdown</CardTitle>
                <CardDescription className="text-xs">
                  Where labels originate — fraud_confirmed and manual_review are the highest-quality sources
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(analysis.sourceCounts as Record<string, number>)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, count]) => (
                      <div key={source} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="text-xs text-gray-600">{source.replace(/_/g, ' ')}</span>
                        <span className="text-sm font-bold">{count as number}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'analysis' && analysis && analysis.total === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No analysis data yet</p>
            <p className="text-sm mt-1">Labels will appear here as claims are processed through the workflow</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
