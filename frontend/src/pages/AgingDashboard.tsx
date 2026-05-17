import { useState, useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { Clock, AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

const STAGE_LABELS: Record<string, string> = {
  initial_review:        'Initial Review',
  maker_checker_review:  'Maker-Checker',
  claims_officer_review: 'Claims Officer',
  fraud_review:          'Fraud Review',
  payment_pending:       'Payment Pending',
}

// SLA budget per stage in hours — kept in sync with the backend default
const SLA_HOURS: Record<string, number> = {
  initial_review:        4,
  maker_checker_review:  24,
  claims_officer_review: 8,
  fraud_review:          48,
}

const BUCKET_COLORS = ['#22c55e', '#f59e0b', '#f97316', '#ef4444']
const POLL_INTERVAL_MS = 60_000

// Build the socket.io origin from the same env var the REST client uses
function resolveSocketOrigin(): string {
  const raw = (import.meta as any).env?.VITE_API_URL as string | undefined
  if (!raw) return window.location.origin
  const stripped = raw.replace(/\/api\/?$/, '')
  return stripped || window.location.origin
}

// Format elapsed hours as a short human string
function fmtElapsed(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

// Compute a 0-100 progress value toward the SLA deadline
function slaProgress(hoursElapsed: number, stage: string): number {
  const budget = SLA_HOURS[stage] ?? 48
  return Math.min(100, Math.round((hoursElapsed / budget) * 100))
}

export default function AgingDashboard() {
  const [data, setData]           = useState<any>(null)
  const [sla, setSla]             = useState<any>(null)
  const [loading, setLoading]     = useState(false)
  const [stageFilter, setStageFilter] = useState('all')
  const [page, setPage]           = useState(1)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [timeSince, setTimeSince] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  // Track IDs that became breached since last silent refresh (flash animation)
  const [flashIds, setFlashIds]   = useState<Set<string>>(new Set())
  // Live delta-hours added on top of server snapshot so elapsed ticks every minute
  const [deltaHours, setDeltaHours] = useState(0)

  const prevBreachedRef = useRef<Set<string>>(new Set())
  const fetchedAtRef    = useRef<number>(Date.now())
  const PAGE_SIZE = 20

  // ── Core data fetch ────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [agingRes, slaRes] = await Promise.all([
        api.get('/workflow/sla/aging'),
        api.get('/workflow/sla/summary'),
      ])

      const incoming: any[] = agingRes.data?.claims ?? []

      // Detect newly-breached claims and flash them
      const nowBreached = new Set(
        incoming.filter((c: any) => c.slaBreached).map((c: any) => c.claimId),
      )
      const freshlyBreached = [...nowBreached].filter(
        id => !prevBreachedRef.current.has(id),
      )
      if (freshlyBreached.length > 0) {
        setFlashIds(new Set(freshlyBreached))
        setTimeout(() => setFlashIds(new Set()), 2500)
      }
      prevBreachedRef.current = nowBreached

      setData(agingRes.data)
      setSla(slaRes.data)
      setLastUpdated(new Date())
      fetchedAtRef.current = Date.now()
      setDeltaHours(0) // reset live-tick accumulator
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { load() }, [load])

  // Auto-poll every 60 s
  useEffect(() => {
    const id = setInterval(() => load(true), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  // ── Live elapsed-time ticker ───────────────────────────────────────────────
  // Every 60 s add 1/60 h to deltaHours so the displayed elapsed time ticks
  // without requiring a server round-trip.
  useEffect(() => {
    const id = setInterval(() => {
      setDeltaHours(d => d + 1 / 60)
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // ── "Updated X ago" ticker ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!lastUpdated) return
      const secs = Math.round((Date.now() - lastUpdated.getTime()) / 1000)
      setTimeSince(secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`)
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // ── WebSocket — instant SLA breach alert ───────────────────────────────────
  useEffect(() => {
    const origin = resolveSocketOrigin()
    const fallback = localStorage.getItem('token') || undefined
    const socket: Socket = io(`${origin}/events`, {
      auth: fallback ? { token: fallback } : undefined,
      withCredentials: true,
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30_000,
    })

    socket.on('connect',    () => setWsConnected(true))
    socket.on('disconnect', () => setWsConnected(false))

    // A breach event means the server just marked a claim — refresh immediately
    socket.on('sla:breach', () => load(true))

    // A status change might move a claim out of the aging list
    socket.on('claim:status', () => load(true))

    return () => { socket.disconnect() }
  }, [load])

  // ── Derived data ───────────────────────────────────────────────────────────
  const allClaims: any[] = data?.claims ?? []

  const filteredClaims = stageFilter === 'all'
    ? allClaims
    : allClaims.filter((c: any) => c.workflowStage === stageFilter)

  const pageClaims = filteredClaims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filteredClaims.length / PAGE_SIZE)

  const bucketData = data
    ? Object.entries(data.buckets).map(([name, value], i) => ({
        name, value, color: BUCKET_COLORS[i],
      }))
    : []

  // Compute stage breakdown from claims (backend omits stageBreakdown)
  const stageData = (() => {
    const acc: Record<string, { count: number; breached: number }> = {}
    for (const c of allClaims) {
      if (!acc[c.workflowStage]) acc[c.workflowStage] = { count: 0, breached: 0 }
      acc[c.workflowStage].count++
      if (c.slaBreached) acc[c.workflowStage].breached++
    }
    return Object.entries(acc).map(([stage, info]) => ({
      stage: STAGE_LABELS[stage] ?? stage,
      total: info.count,
      breached: info.breached,
    }))
  })()

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="h-6 w-6 text-blue-600" /> Claims Aging
          </h1>
          <p className="text-gray-500 text-sm mt-1 flex items-center gap-2">
            Live view of active claims by time-in-queue
            {lastUpdated && (
              <span className="text-gray-400">· updated {timeSince}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <span
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${
              wsConnected
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            {wsConnected ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <Wifi className="h-3 w-3" /> Live
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" /> Offline
              </>
            )}
          </span>

          <Select value={stageFilter} onValueChange={v => { setStageFilter(v); setPage(1) }}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="initial_review">Initial Review</SelectItem>
              <SelectItem value="maker_checker_review">Maker-Checker</SelectItem>
              <SelectItem value="claims_officer_review">Claims Officer</SelectItem>
              <SelectItem value="fraud_review">Fraud Review</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Summary KPI cards ── */}
      {sla && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{sla.total}</div>
              <div className="text-xs text-gray-500">Active claims</div>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-700">{sla.onTrack}</div>
              <div className="text-xs text-gray-500">On track</div>
            </CardContent>
          </Card>
          <Card className="border-amber-200">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-amber-700">{sla.atRisk}</div>
              <div className="text-xs text-gray-500">At risk (&gt;36h)</div>
            </CardContent>
          </Card>
          <Card className={`border-red-200 ${sla.breached > 0 ? 'ring-1 ring-red-400' : ''}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-red-700">{sla.breached}</div>
                <div className="text-xs text-gray-500">SLA breached</div>
              </div>
              {sla.breached > 0 && (
                <AlertTriangle className="h-6 w-6 text-red-500 animate-pulse" />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Charts ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Claims by Time-in-Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bucketData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {bucketData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Breaches by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="total"    name="Total"    fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="breached" name="Breached" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Claims table ── */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">
            Active Claims ({filteredClaims.length}
            {stageFilter !== 'all' && ` · ${STAGE_LABELS[stageFilter] ?? stageFilter}`})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Elapsed</TableHead>
                <TableHead>SLA Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageClaims.map((c: any) => {
                const liveHours   = c.hoursElapsed + deltaHours
                const progress    = slaProgress(liveHours, c.workflowStage)
                const isFlashing  = flashIds.has(c.claimId)
                const rowCls = [
                  c.slaBreached ? 'bg-red-50' : '',
                  isFlashing    ? 'animate-pulse ring-2 ring-inset ring-red-400' : '',
                ].join(' ')

                return (
                  <TableRow key={c.claimId} className={rowCls}>
                    <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                    <TableCell className="text-sm">{c.providerName}</TableCell>
                    <TableCell className="text-xs">
                      {STAGE_LABELS[c.workflowStage] ?? c.workflowStage}
                    </TableCell>
                    <TableCell className="text-sm">{c.assignedTo}</TableCell>
                    <TableCell>
                      <span
                        className={`font-medium tabular-nums ${
                          liveHours > (SLA_HOURS[c.workflowStage] ?? 48)
                            ? 'text-red-600'
                            : liveHours > (SLA_HOURS[c.workflowStage] ?? 48) * 0.75
                            ? 'text-amber-600'
                            : 'text-green-600'
                        }`}
                      >
                        {fmtElapsed(liveHours)}
                      </span>
                    </TableCell>
                    <TableCell className="w-28">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              progress >= 100 ? 'bg-red-500' :
                              progress >= 75  ? 'bg-amber-400' : 'bg-green-500'
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 tabular-nums w-8">{progress}%</span>
                      </div>
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
                )
              })}
              {pageClaims.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-400 py-8">
                    {loading ? 'Loading…' : 'No active claims found'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 p-3 border-t">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Prev
              </Button>
              <span className="text-sm text-gray-500 self-center">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
