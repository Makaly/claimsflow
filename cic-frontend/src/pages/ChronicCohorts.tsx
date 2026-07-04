import { useState, useEffect } from 'react'
import { Heart, Users, AlertTriangle, RefreshCw, Loader2, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import api from '@/services/api'

interface ChronicCondition {
  code: string
  name: string
}

interface MemberStatus {
  id: string
  memberNumber: string
  conditionCode: string
  confidence: number
  firstObservedAt: string
  lastObservedAt: string
  status: string
  condition: ChronicCondition
}

interface CareGap {
  memberNumber: string
  conditionCode: string
  conditionName: string
  gapDescription: string
}

interface SummaryRow {
  conditionCode: string
  status: string
  _count: number
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-100 text-red-700',
  suspected: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
}

export default function ChronicCohorts() {
  const [conditions, setConditions] = useState<ChronicCondition[]>([])
  const [cohort, setCohort] = useState<MemberStatus[]>([])
  const [careGaps, setCareGaps] = useState<CareGap[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [selectedCondition, setSelectedCondition] = useState('all')
  const [memberSearch, setMemberSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [activeTab, setActiveTab] = useState<'cohort' | 'gaps'>('cohort')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [condRes, summRes, gapRes] = await Promise.all([
        api.get('/chronic-disease/conditions'),
        api.get('/chronic-disease/summary'),
        api.get('/chronic-disease/care-gaps'),
      ])
      setConditions(condRes.data)
      setSummary(summRes.data)
      setCareGaps(gapRes.data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function loadCohort() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedCondition !== 'all') params.set('conditionCode', selectedCondition)
      const res = await api.get(`/chronic-disease/cohort?${params}`)
      setCohort(res.data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function runScan() {
    setScanning(true)
    try {
      await api.post('/chronic-disease/scan')
      await loadAll()
    } catch {
      alert('Scan failed')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    loadCohort()
  }, [selectedCondition])

  // Build chart data from summary
  const chartData = conditions.map((c) => {
    const active = summary.find(s => s.conditionCode === c.code && s.status === 'active')?._count ?? 0
    const suspected = summary.find(s => s.conditionCode === c.code && s.status === 'suspected')?._count ?? 0
    return { name: c.name.split(' ')[0], active, suspected }
  })

  const filtered = cohort.filter((m) =>
    !memberSearch || m.memberNumber.toLowerCase().includes(memberSearch.toLowerCase())
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Heart className="h-6 w-6 text-red-500" />
          <div>
            <h1 className="text-2xl font-bold">Chronic Disease Cohorts</h1>
            <p className="text-muted-foreground text-sm">Member cohort tracking and care-gap detection</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={runScan} disabled={scanning}>
            {scanning ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Scanning...</> : 'Run Scan'}
          </Button>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cohort Size by Condition</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip />
                <Bar dataKey="active" fill="hsl(0,70%,50%)" name="Active" radius={[4,4,0,0]} />
                <Bar dataKey="suspected" fill="hsl(40,80%,55%)" name="Suspected" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Button variant={activeTab === 'cohort' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('cohort')}>
          <Users className="h-4 w-4 mr-1" /> Cohort ({cohort.length})
        </Button>
        <Button variant={activeTab === 'gaps' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('gaps')}>
          <AlertTriangle className="h-4 w-4 mr-1" /> Care Gaps ({careGaps.length})
        </Button>
      </div>

      {activeTab === 'cohort' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedCondition} onValueChange={setSelectedCondition}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Conditions</SelectItem>
                  {conditions.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 flex-1">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Filter by member number..."
                  className="max-w-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading && <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            <div className="space-y-2">
              {filtered.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <span className="font-medium text-sm">{m.memberNumber}</span>
                    <div className="text-xs text-muted-foreground">
                      {m.condition.name} &middot; confidence: {(m.confidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last observed: {new Date(m.lastObservedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge className={STATUS_COLORS[m.status] ?? ''}>{m.status}</Badge>
                </div>
              ))}
              {filtered.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground text-center py-4">No members found.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'gaps' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Care Gaps</CardTitle>
            <CardDescription>Members with no qualifying encounter in 180+ days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {careGaps.length === 0 && (
              <p className="text-sm text-muted-foreground">No care gaps detected.</p>
            )}
            {careGaps.map((g, i) => (
              <div key={i} className="flex items-start gap-3 p-3 border border-amber-200 rounded-lg bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-sm">{g.memberNumber}</span>
                  <span className="text-xs text-muted-foreground ml-2">{g.conditionName}</span>
                  <p className="text-xs text-amber-700 mt-0.5">{g.gapDescription}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
