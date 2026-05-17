import { useState, useEffect, useCallback } from 'react'
import {
  ScanBarcode, RefreshCw, TrendingUp, AlertTriangle, CheckCircle,
  BarChart3, Target, Database, Eye, ThumbsUp, ThumbsDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

function MiniBar({ value, max = 100, colour }: { value: number; max?: number; colour: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function ConfBadge({ conf }: { conf: number | null }) {
  if (conf === null) return <span className="text-gray-400 text-xs">—</span>
  const colour = conf >= 85 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
               : conf >= 70 ? 'text-amber-700 bg-amber-50 border-amber-200'
               : 'text-red-700 bg-red-50 border-red-200'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full border font-mono font-medium ${colour}`}>
      {conf}%
    </span>
  )
}

export default function ZoneAnalytics() {
  const [data, setData]         = useState<any | null>(null)
  const [loading, setLoading]   = useState(false)
  const [templateFilter, setTemplateFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = templateFilter !== 'all' ? `?templateId=${templateFilter}` : ''
      const res = await api.get(`/document-classifier/zone-analytics${params}`)
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }, [templateFilter])

  useEffect(() => { load() }, [load])

  const confirm = async (hitId: string) => {
    await api.patch(`/document-classifier/zone-hits/${hitId}/confirm`)
    load()
  }

  const summary = data?.summary
  const templates: any[] = data?.templates ?? []
  const fields: any[]    = data?.fields    ?? []
  const trend: any[]     = data?.trend     ?? []
  const recentHits: any[]= data?.recentHits ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScanBarcode className="h-6 w-6 text-cyan-600" /> OCR Zone Analytics
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Per-zone extraction accuracy, confidence trends, and correction feedback — the knowledge base for improving future captures
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger className="w-52 h-8 text-xs">
              <SelectValue placeholder="All templates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              {templates.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: 'Total Extractions', value: summary.totalHits.toLocaleString(), icon: Database, colour: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Avg Confidence',    value: `${summary.avgConfidence}%`,        icon: Target,   colour: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Correction Rate',   value: `${summary.correctionRate}%`,       icon: AlertTriangle, colour: summary.correctionRate > 15 ? 'text-red-600' : 'text-amber-600', bg: summary.correctionRate > 15 ? 'bg-red-50' : 'bg-amber-50' },
            { label: 'Unverified Hits',   value: summary.unverifiedHits.toLocaleString(), icon: Eye, colour: 'text-violet-600', bg: 'bg-violet-50' },
            { label: 'Active Templates',  value: summary.templatesActive.toLocaleString(), icon: BarChart3, colour: 'text-sky-600', bg: 'bg-sky-50' },
          ].map(card => (
            <Card key={card.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`${card.bg} p-2 rounded-lg`}>
                  <card.icon className={`h-5 w-5 ${card.colour}`} />
                </div>
                <div>
                  <div className={`text-xl font-bold ${card.colour}`}>{card.value}</div>
                  <div className="text-xs text-gray-500">{card.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Template performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Template Performance
            </CardTitle>
            <CardDescription className="text-xs">
              Usage count, success rate, and zone coverage per template
            </CardDescription>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No templates with extraction history yet</p>
            ) : (
              <div className="space-y-3">
                {templates.map(t => (
                  <div key={t.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.name}</p>
                        <p className="text-xs text-gray-400">{t.documentType}{t.provider ? ` · ${t.provider}` : ''} · {t.zoneCount} zones</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-500 font-mono">{t.usageCount} uses</span>
                        {t.accuracy !== null && (
                          <ConfBadge conf={t.accuracy} />
                        )}
                      </div>
                    </div>
                    {t.accuracy !== null && (
                      <MiniBar
                        value={t.accuracy}
                        colour={t.accuracy >= 85 ? 'bg-emerald-500' : t.accuracy >= 70 ? 'bg-amber-400' : 'bg-red-400'}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confidence trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Confidence Trend
            </CardTitle>
            <CardDescription className="text-xs">
              Weekly average confidence and correction rate across all zones
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No trend data yet — run more extractions to populate</p>
            ) : (
              <div className="space-y-2">
                {trend.map(t => (
                  <div key={t.week}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-500 font-mono">{t.week}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-emerald-600">{t.avgConfidence}% conf</span>
                        {t.correctionRate > 0 && (
                          <span className="text-red-500">{t.correctionRate}% corrected</span>
                        )}
                        <span className="text-gray-400">{t.hits} hits</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${t.avgConfidence}%` }}
                      />
                      {t.correctionRate > 0 && (
                        <div
                          className="absolute top-0 right-0 h-full bg-red-400 rounded-r-full opacity-70"
                          style={{ width: `${Math.min(t.correctionRate, 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-field accuracy table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" /> Field-Level Accuracy
          </CardTitle>
          <CardDescription className="text-xs">
            Per-zone extraction statistics — fields marked "Needs Attention" have low confidence or high correction rates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Field</TableHead>
                <TableHead className="text-xs">Template</TableHead>
                <TableHead className="text-xs text-right">Extractions</TableHead>
                <TableHead className="text-xs">Avg Confidence</TableHead>
                <TableHead className="text-xs">Correction Rate</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-400 py-8 text-xs">
                    No zone hit data yet — data appears here as documents are processed
                  </TableCell>
                </TableRow>
              ) : (
                fields.map((f, i) => (
                  <TableRow key={i} className={f.needsAttention ? 'bg-red-50/30' : ''}>
                    <TableCell>
                      <p className="text-sm font-medium">{f.fieldLabel}</p>
                      <p className="text-xs text-gray-400 font-mono">{f.fieldName}</p>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">{f.templateName}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{f.totalExtractions}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MiniBar
                          value={f.avgConfidence ?? 0}
                          colour={!f.avgConfidence ? 'bg-gray-200' : f.avgConfidence >= 85 ? 'bg-emerald-500' : f.avgConfidence >= 70 ? 'bg-amber-400' : 'bg-red-400'}
                        />
                        <ConfBadge conf={f.avgConfidence} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MiniBar
                          value={f.correctionRate}
                          colour={f.correctionRate > 20 ? 'bg-red-500' : f.correctionRate > 10 ? 'bg-amber-400' : 'bg-gray-300'}
                        />
                        <span className={`text-xs font-mono ${f.correctionRate > 20 ? 'text-red-600' : f.correctionRate > 10 ? 'text-amber-600' : 'text-gray-500'}`}>
                          {f.correctionRate}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {f.needsAttention ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">
                          Needs Attention
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          Good
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent hits with feedback */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4" /> Recent Extraction Log
          </CardTitle>
          <CardDescription className="text-xs">
            Latest zone hits — confirm correct extractions or flag corrections to build the knowledge base
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Field</TableHead>
                <TableHead className="text-xs">Extracted Value</TableHead>
                <TableHead className="text-xs">Confidence</TableHead>
                <TableHead className="text-xs">Engine</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Feedback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentHits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-400 py-8 text-xs">
                    No extraction history yet
                  </TableCell>
                </TableRow>
              ) : (
                recentHits.map((h: any) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{h.fieldLabel}</p>
                      <p className="text-xs text-gray-400 font-mono">{h.fieldName}</p>
                    </TableCell>
                    <TableCell className="text-xs font-mono max-w-48 truncate">
                      {h.extractedValue || <span className="text-gray-400 italic">empty</span>}
                    </TableCell>
                    <TableCell><ConfBadge conf={h.confidence} /></TableCell>
                    <TableCell>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        h.engine === 'anthropic' ? 'bg-orange-100 text-orange-700'
                        : h.engine === 'gemini'  ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {h.engine ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {h.wasCorrect === true  && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Confirmed</span>}
                      {h.wasCorrect === false && <span className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Corrected</span>}
                      {h.wasCorrect === null  && <span className="text-xs text-gray-400">Unverified</span>}
                    </TableCell>
                    <TableCell className="text-xs text-gray-400">{formatDate(h.createdAt)}</TableCell>
                    <TableCell>
                      {h.wasCorrect === null && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => confirm(h.id)}
                            title="Confirm correct"
                            className="p-1 rounded hover:bg-emerald-50 text-emerald-600 transition-colors"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              const corrected = window.prompt(`Correct value for "${h.fieldLabel}":`, h.extractedValue ?? '')
                              if (corrected !== null) {
                                api.patch(`/document-classifier/zone-hits/${h.id}/correct`, { correctedValue: corrected }).then(load)
                              }
                            }}
                            title="Mark as incorrect"
                            className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
