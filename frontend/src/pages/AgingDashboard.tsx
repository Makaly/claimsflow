import { useState, useEffect, useCallback } from 'react'
import { Clock, AlertTriangle, RefreshCw, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

const STAGE_LABELS: Record<string, string> = {
  initial_review: 'Initial Review',
  maker_review: 'Maker Review',
  checker_review: 'Checker Review',
  final_approval: 'Final Approval',
}

const BUCKET_COLORS = ['#22c55e', '#f59e0b', '#f97316', '#ef4444']

export default function AgingDashboard() {
  const [data, setData] = useState<any>(null)
  const [sla, setSla] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [stageFilter, setStageFilter] = useState('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [agingRes, slaRes] = await Promise.all([
        api.get(`/workflow/sla/aging${stageFilter !== 'all' ? `?stage=${stageFilter}` : ''}`),
        api.get('/workflow/sla/summary'),
      ])
      setData(agingRes.data)
      setSla(slaRes.data)
    } finally {
      setLoading(false)
    }
  }, [stageFilter])

  useEffect(() => { load() }, [load])

  const bucketData = data ? Object.entries(data.buckets).map(([name, value], i) => ({ name, value, color: BUCKET_COLORS[i] })) : []
  const stageData = data ? Object.entries(data.stageBreakdown || {}).map(([stage, info]: any) => ({
    stage: STAGE_LABELS[stage] ?? stage,
    total: info.count,
    breached: info.breached,
  })) : []

  const claims = data?.claims ?? []
  const pageClaims = claims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(claims.length / PAGE_SIZE)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6 text-blue-600" /> Claims Aging</h1>
          <p className="text-gray-500 text-sm mt-1">Real-time view of active claims by time-in-queue</p>
        </div>
        <div className="flex gap-2">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="initial_review">Initial Review</SelectItem>
              <SelectItem value="maker_review">Maker Review</SelectItem>
              <SelectItem value="checker_review">Checker Review</SelectItem>
              <SelectItem value="final_approval">Final Approval</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {sla && (
        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <div className="text-2xl font-bold">{sla.total}</div>
            <div className="text-xs text-gray-500">Active claims</div>
          </CardContent></Card>
          <Card className="border-green-200"><CardContent className="p-4">
            <div className="text-2xl font-bold text-green-700">{sla.onTrack}</div>
            <div className="text-xs text-gray-500">On track</div>
          </CardContent></Card>
          <Card className="border-amber-200"><CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-700">{sla.atRisk}</div>
            <div className="text-xs text-gray-500">At risk (&gt;36h)</div>
          </CardContent></Card>
          <Card className="border-red-200"><CardContent className="p-4">
            <div className="text-2xl font-bold text-red-700">{sla.breached}</div>
            <div className="text-xs text-gray-500">SLA breached</div>
          </CardContent></Card>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Claims by Time-in-Queue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bucketData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {bucketData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Breaches by Stage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="total" name="Total" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="breached" name="Breached" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Active Claims ({claims.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Days Elapsed</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageClaims.map((c: any) => (
                <TableRow key={c.claimId} className={c.slaBreached ? 'bg-red-50' : ''}>
                  <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                  <TableCell className="text-sm">{c.providerName}</TableCell>
                  <TableCell className="text-xs">{STAGE_LABELS[c.workflowStage] ?? c.workflowStage}</TableCell>
                  <TableCell className="text-sm">{c.assignedTo}</TableCell>
                  <TableCell>
                    <span className={`font-medium ${c.daysElapsed > 5 ? 'text-red-600' : c.daysElapsed > 2 ? 'text-amber-600' : 'text-green-600'}`}>
                      {c.daysElapsed}d
                    </span>
                  </TableCell>
                  <TableCell>
                    {c.slaBreached ? (
                      <Badge className="bg-red-100 text-red-800 text-xs">Breached</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 text-xs">OK</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{formatDate(c.submittedAt)}</TableCell>
                </TableRow>
              ))}
              {pageClaims.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No active claims found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 p-3 border-t">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="text-sm text-gray-500 self-center">Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
