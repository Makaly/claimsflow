import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Building2, DollarSign, RefreshCw, Search } from 'lucide-react'
import api from '@/services/api'
import ScanMeteringEditor, { type ScanMeteringSettings } from '@/components/ScanMeteringEditor'

interface Row extends ScanMeteringSettings {
  providerName: string
  providerType?: string
}

export default function ScanMeteringTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/scan-metering/settings')
      setRows(data?.settings ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.providerName.toLowerCase().includes(q) || r.providerId.toLowerCase().includes(q),
    )
  }, [rows, query])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" /> Scan Billing
        </CardTitle>
        <CardDescription>
          Set the amount charged per successful scan for each provider. Disabled organizations
          can't start scans; cost changes apply to future scans only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search providers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading providers…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {rows.length === 0 ? 'No providers found.' : 'No providers match your search.'}
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((r) => {
            const isOpen = expanded === r.providerId
            return (
              <div key={r.providerId} className="rounded-lg border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.providerId)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.providerName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{r.providerId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">
                      {r.currency} {Number(r.costPerScan).toFixed(2)}
                    </span>
                    {r.enabled
                      ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t bg-muted/10">
                    <div className="pt-3">
                      <ScanMeteringEditor
                        providerId={r.providerId}
                        initial={r}
                        variant="inline"
                        onSaved={(next) => {
                          setRows((prev) =>
                            prev.map((row) =>
                              row.providerId === next.providerId
                                ? { ...row, ...next, providerName: row.providerName }
                                : row,
                            ),
                          )
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
