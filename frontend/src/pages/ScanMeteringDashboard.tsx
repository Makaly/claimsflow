import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Activity, ScanLine, DollarSign, Building2, Smartphone, Laptop, Camera,
  CheckCircle, XCircle, RefreshCw, Save, AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { formatCurrency } from '@/lib/utils'

interface AggregateBucket { scans: number; charges: number }
interface PerProviderRow {
  providerId: string
  providerName: string
  scansThisMonth: number
  chargesThisMonth: number
  currency: string
}
interface RecentEvent {
  id: string
  createdAt: string
  deviceClass: 'desktop' | 'mobile' | 'camera'
  os: string | null
  machineHostname: string | null
  scannerName: string | null
  pages: number | null
  costAtScan: number
  currency: string
  success: boolean
  user: { id: string; name: string; email: string }
  provider: { id: string; name: string } | null
  branch: { id: string; name: string } | null
}
interface DashboardData {
  today: AggregateBucket
  week: AggregateBucket
  month: AggregateBucket
  perProvider: PerProviderRow[]
  recentEvents: RecentEvent[]
}
interface SettingsRow {
  providerId: string
  providerName: string
  providerType: string
  enabled: boolean
  costPerScan: number
  currency: string
  updatedAt: string
}

const DEVICE_ICON: Record<RecentEvent['deviceClass'], typeof Laptop> = {
  desktop: Laptop,
  mobile: Smartphone,
  camera: Camera,
}

function KpiCard({
  icon: Icon, label, value, sublabel, accent,
}: {
  icon: typeof ScanLine; label: string; value: string | number; sublabel?: string
  accent: 'violet' | 'green' | 'amber' | 'blue'
}) {
  const accents = {
    violet: 'from-violet-500 to-purple-600',
    green:  'from-emerald-500 to-green-600',
    amber:  'from-amber-500 to-orange-600',
    blue:   'from-blue-500 to-cyan-600',
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${accents[accent]} flex items-center justify-center shadow-sm`}>
            <Icon className="h-4 w-4 text-white" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
      </CardContent>
    </Card>
  )
}

export default function ScanMeteringDashboard() {
  const { user } = useAuthStore()
  const isAdmin   = user?.role === 'admin'
  const canSeeAll = user?.role === 'admin' || user?.role === 'finance'

  const [data, setData] = useState<DashboardData | null>(null)
  const [settings, setSettings] = useState<SettingsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [draftPrice, setDraftPrice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [d, s] = await Promise.all([
        api.get<DashboardData>('/scan-metering/dashboard'),
        canSeeAll ? api.get<{ settings: SettingsRow[] }>('/scan-metering/settings') : Promise.resolve(null),
      ])
      setData(d.data)
      if (s) setSettings(s.data.settings)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to load scan metering data')
    } finally {
      setLoading(false)
    }
  }, [canSeeAll])

  useEffect(() => { load() }, [load])

  const toggleEnabled = async (row: SettingsRow, next: boolean) => {
    setSavingId(row.providerId)
    try {
      await api.patch(`/scan-metering/settings/${row.providerId}`, { enabled: next })
      setSettings((prev) => prev.map((r) =>
        r.providerId === row.providerId ? { ...r, enabled: next } : r,
      ))
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to update setting')
    } finally {
      setSavingId(null)
    }
  }

  const savePrice = async (row: SettingsRow) => {
    const raw = draftPrice[row.providerId]
    if (raw === undefined) return
    const cost = parseFloat(raw)
    if (Number.isNaN(cost) || cost < 0 || cost > 100000) {
      setError('Price must be between 0 and 100 000.')
      return
    }
    setSavingId(row.providerId)
    try {
      await api.patch(`/scan-metering/settings/${row.providerId}`, { costPerScan: cost })
      setSettings((prev) => prev.map((r) =>
        r.providerId === row.providerId ? { ...r, costPerScan: cost } : r,
      ))
      setDraftPrice((d) => { const n = { ...d }; delete n[row.providerId]; return n })
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to update price')
    } finally {
      setSavingId(null)
    }
  }

  const currency = useMemo(() => {
    const c = data?.recentEvents.find(e => e.currency)?.currency
      ?? settings.find(s => s.currency)?.currency
      ?? 'KES'
    return c
  }, [data, settings])

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-[1400px] mx-auto">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScanLine className="h-6 w-6 text-violet-600" />
            Scan Metering & Billing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canSeeAll
              ? 'Track scan usage across every organization, manage pricing, and toggle scanning on/off.'
              : 'Your organization\'s scan usage and charges.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/60 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Activity}    label="Scans today"      value={data?.today.scans ?? '—'}  sublabel={data ? `${formatCurrency(data.today.charges, currency)} billed` : undefined} accent="violet" />
        <KpiCard icon={ScanLine}    label="Last 7 days"      value={data?.week.scans  ?? '—'}  sublabel={data ? `${formatCurrency(data.week.charges,  currency)} billed` : undefined} accent="blue"   />
        <KpiCard icon={DollarSign}  label="Last 30 days"     value={data?.month.scans ?? '—'}  sublabel={data ? `${formatCurrency(data.month.charges, currency)} billed` : undefined} accent="green"  />
        <KpiCard icon={Building2}   label={canSeeAll ? 'Organizations' : 'Your branches'}
                 value={canSeeAll ? (data?.perProvider.length ?? '—') : (data?.recentEvents.reduce((acc, e) => acc + (e.branch ? 1 : 0), 0) ?? '—')}
                 sublabel={canSeeAll ? 'with recent activity' : 'with recent scans'} accent="amber" />
      </div>

      {/* ── Per-org breakdown + enable toggles (admin/finance only) ────────── */}
      {canSeeAll && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-violet-600" />
              Organizations
            </CardTitle>
            <CardDescription>Enable/disable scanning, set price, view this month's usage.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Scans (30 days)</TableHead>
                    <TableHead className="text-right">Charges (30 days)</TableHead>
                    <TableHead>Price per scan</TableHead>
                    <TableHead className="text-center">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {loading ? 'Loading…' : 'No organizations configured yet. Settings are created on first scan.'}
                    </TableCell></TableRow>
                  )}
                  {settings.map((row) => {
                    const usage = data?.perProvider.find(p => p.providerId === row.providerId)
                    const draft = draftPrice[row.providerId]
                    const draftDirty = draft !== undefined && parseFloat(draft) !== row.costPerScan
                    return (
                      <TableRow key={row.providerId}>
                        <TableCell className="font-medium">{row.providerName}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{row.providerType}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{usage?.scansThisMonth ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(usage?.chargesThisMonth ?? 0, row.currency)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{row.currency}</span>
                            <Input
                              type="number" step="0.01" min={0}
                              value={draft ?? row.costPerScan.toFixed(2)}
                              onChange={(e) => setDraftPrice((d) => ({ ...d, [row.providerId]: e.target.value }))}
                              disabled={!isAdmin}
                              className="h-8 w-24 text-xs tabular-nums"
                            />
                            {draftDirty && isAdmin && (
                              <Button size="sm" variant="ghost" className="h-7 px-2"
                                      disabled={savingId === row.providerId}
                                      onClick={() => savePrice(row)}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={row.enabled}
                            disabled={!isAdmin || savingId === row.providerId}
                            onCheckedChange={(v) => toggleEnabled(row, v)}
                          />
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

      {/* ── Recent events ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-600" />
            Recent scans
          </CardTitle>
          <CardDescription>
            Last 50 events. {canSeeAll ? 'Across all organizations.' : 'Your organization only.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  {canSeeAll && <TableHead>Organization</TableHead>}
                  <TableHead>Branch</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-center">OK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.recentEvents ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={canSeeAll ? 8 : 7} className="text-center text-muted-foreground py-8">
                    {loading ? 'Loading…' : 'No scans recorded yet.'}
                  </TableCell></TableRow>
                )}
                {(data?.recentEvents ?? []).map((ev) => {
                  const Icon = DEVICE_ICON[ev.deviceClass]
                  return (
                    <TableRow key={ev.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(ev.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{ev.user.name}</div>
                        <div className="text-[10px] text-muted-foreground">{ev.user.email}</div>
                      </TableCell>
                      {canSeeAll && <TableCell className="text-xs">{ev.provider?.name ?? '—'}</TableCell>}
                      <TableCell className="text-xs">{ev.branch?.name ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-violet-600" />
                          <span className="text-xs capitalize">{ev.deviceClass}</span>
                          {ev.scannerName && <span className="text-[10px] text-muted-foreground">· {ev.scannerName}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">{ev.machineHostname ?? '—'}</div>
                        <div className="text-[10px] text-muted-foreground">{ev.os ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatCurrency(ev.costAtScan, ev.currency)}
                      </TableCell>
                      <TableCell className="text-center">
                        {ev.success
                          ? <CheckCircle className="h-4 w-4 text-emerald-500 inline" />
                          : <XCircle    className="h-4 w-4 text-red-500 inline" />}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
