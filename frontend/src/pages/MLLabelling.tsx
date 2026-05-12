import { useState, useEffect, useCallback } from 'react'
import { Database, Download, RefreshCw, CheckCircle, AlertTriangle, ShieldAlert, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

const LABEL_META: Record<string, { icon: any; color: string }> = {
  legitimate: { icon: CheckCircle, color: 'text-green-700 bg-green-50 border-green-200' },
  suspicious: { icon: AlertTriangle, color: 'text-amber-700 bg-amber-50 border-amber-200' },
  fraud: { icon: ShieldAlert, color: 'text-red-700 bg-red-50 border-red-200' },
}

export default function MLLabelling() {
  const [labels, setLabels] = useState<any[]>([])
  const [distribution, setDistribution] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [labelFilter, setLabelFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [factorStats, setFactorStats] = useState<any | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (labelFilter !== 'all') params.set('label', labelFilter)
      if (sourceFilter !== 'all') params.set('source', sourceFilter)
      const [labelsRes, factorRes] = await Promise.all([
        api.get(`/claim-labels?${params}`),
        api.get('/claims/ml/factor-effectiveness'),
      ])
      setLabels(labelsRes.data.items || [])
      setDistribution(labelsRes.data.distribution || {})
      setTotal(labelsRes.data.total || 0)
      setFactorStats(factorRes.data)
    } finally {
      setLoading(false)
    }
  }, [labelFilter, sourceFilter])

  useEffect(() => { load() }, [load])

  const exportDataset = async () => {
    const res = await fetch('/api/claim-labels/export', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `claim-labels-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateLabel = async (claimId: string, newLabel: string) => {
    try {
      await api.post(`/claim-labels/${claimId}`, { label: newLabel })
      load()
    } catch {}
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6 text-blue-600" /> ML Labelling</h1>
          <p className="text-gray-500 text-sm mt-1">Claim labels accumulated from workflow decisions — training dataset for future ML model</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" onClick={exportDataset}>
            <Download className="h-4 w-4 mr-1" /> Export Dataset
          </Button>
        </div>
      </div>

      {/* Distribution cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="text-2xl font-bold">{total}</div>
          <div className="text-xs text-gray-500">Total labels</div>
        </CardContent></Card>
        {['legitimate', 'suspicious', 'fraud'].map(l => {
          const info = LABEL_META[l]
          const Icon = info.icon
          return (
            <Card key={l} className={`border ${info.color.split(' ')[2]}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${info.color.split(' ')[0]}`} />
                <div>
                  <div className="text-2xl font-bold">{distribution[l] ?? 0}</div>
                  <div className="text-xs text-gray-500 capitalize">{l}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Factor effectiveness */}
      {factorStats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Factor Effectiveness</CardTitle>
            <CardDescription className="text-xs">{factorStats.message ?? `Trained on ${factorStats.sampleSize} labelled claims — higher separation = more predictive`}</CardDescription>
          </CardHeader>
          {factorStats.factors?.length > 0 && (
            <CardContent>
              <div className="space-y-2">
                {factorStats.factors.map((f: any) => (
                  <div key={f.name} className="flex items-center gap-3">
                    <div className="w-40 text-sm capitalize">{f.name.replace(/([A-Z])/g, ' $1')}</div>
                    <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 rounded" style={{ width: `${Math.min(100, f.separation * 100)}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs font-mono">{(f.separation * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Filters */}
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
                <TableHead>Labelled</TableHead>
                <TableHead>Correct?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.claimId.slice(0, 8)}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${LABEL_META[l.label]?.color || ''}`}>{l.label}</span>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{l.source}</TableCell>
                  <TableCell className="text-sm">KES {(l.featuresSnapshot?.invoiceAmount ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{l.featuresSnapshot?.anomalyScore != null ? `${Math.round(l.featuresSnapshot.anomalyScore * 100)}%` : '—'}</TableCell>
                  <TableCell className="text-xs text-gray-500">{formatDate(l.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {['legitimate', 'suspicious', 'fraud'].map(opt => (
                        <button
                          key={opt}
                          onClick={() => updateLabel(l.claimId, opt)}
                          className={`px-2 py-0.5 rounded text-xs ${l.label === opt ? LABEL_META[opt].color + ' font-medium' : 'text-gray-400 hover:bg-gray-100'}`}
                        >
                          {opt[0].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {labels.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No labels yet — auto-labels will appear here as claims are approved/rejected</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
