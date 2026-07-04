import { useEffect, useMemo, useState } from 'react'
import { UserCog, RefreshCw, CheckCircle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  assignmentRulesService,
  type AssignableUser,
  type AssignmentStrategy,
  type ProviderRuleRow,
} from '@/services/assignmentRulesService'

const selectClass =
  'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function userLabel(u: AssignableUser) {
  return u.isOnLeave ? `${u.name} (on leave)` : u.name
}

export default function AssignmentRules() {
  const [providers, setProviders] = useState<ProviderRuleRow[]>([])
  const [makers, setMakers] = useState<AssignableUser[]>([])
  const [officers, setOfficers] = useState<AssignableUser[]>([])
  const [strategy, setStrategy] = useState<AssignmentStrategy>('workload')
  const [loading, setLoading] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    void load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, strat, makerRes, officerRes] = await Promise.all([
        assignmentRulesService.list(),
        assignmentRulesService.getStrategy(),
        assignmentRulesService.assignable('maker_checker'),
        assignmentRulesService.assignable('claims_officer'),
      ])
      setProviders(list.providers || [])
      setStrategy(strat.strategy)
      setMakers(makerRes.users || [])
      setOfficers(officerRes.users || [])
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load assignment rules')
    } finally {
      setLoading(false)
    }
  }

  const flash = (key: string) => {
    setSavedKey(key)
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500)
  }

  const saveStrategy = async (next: AssignmentStrategy) => {
    const prev = strategy
    setStrategy(next)
    try {
      await assignmentRulesService.setStrategy(next)
      flash('strategy')
    } catch (e: any) {
      setStrategy(prev)
      setError(e?.response?.data?.message || 'Failed to save strategy')
    }
  }

  const savePin = async (
    provider: ProviderRuleRow,
    field: 'makerCheckerId' | 'claimsOfficerId',
    value: string,
  ) => {
    const id = value || null
    // optimistic local update
    setProviders((rows) =>
      rows.map((r) =>
        r.id === provider.id
          ? {
              ...r,
              assignmentRule: {
                makerCheckerId: field === 'makerCheckerId' ? id : r.assignmentRule?.makerCheckerId ?? null,
                claimsOfficerId: field === 'claimsOfficerId' ? id : r.assignmentRule?.claimsOfficerId ?? null,
                makerChecker: r.assignmentRule?.makerChecker ?? null,
                claimsOfficer: r.assignmentRule?.claimsOfficer ?? null,
                updatedAt: new Date().toISOString(),
              },
            }
          : r,
      ),
    )
    try {
      await assignmentRulesService.upsert(provider.id, { [field]: id })
      flash(`${provider.id}:${field}`)
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save pin')
      void load() // reload to reconcile on failure
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return providers
    return providers.filter((p) => p.name.toLowerCase().includes(q))
  }, [providers, search])

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center gap-3">
        <UserCog className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Assignment Rules</h1>
          <p className="text-sm text-muted-foreground">
            Configure how claims are auto-assigned to maker-checkers and claims officers.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Default strategy</CardTitle>
          <CardDescription>
            Used when a provider has no dedicated reviewer. Pins always take priority; when the pinned
            person is on leave the claim goes to their reliever, then falls back to this strategy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <select
            className={`${selectClass} max-w-xs`}
            value={strategy}
            onChange={(e) => saveStrategy(e.target.value as AssignmentStrategy)}
          >
            <option value="workload">Least-loaded (balance by open workload)</option>
            <option value="fifo">Round-robin (rotate evenly)</option>
          </select>
          {savedKey === 'strategy' && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" /> Saved
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Per-provider dedicated reviewers</CardTitle>
              <CardDescription>
                Pin a specific maker-checker and/or claims officer to a provider. Leave as
                “— Auto —” to use the default strategy.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <input
                className={`${selectClass} w-56`}
                placeholder="Search providers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                onClick={() => load()}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Changes apply to newly assigned claims and to the periodic re-routing sweep; claims already
            being worked are not reassigned automatically.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="w-72">Dedicated maker-checker</TableHead>
                <TableHead className="w-72">Dedicated claims officer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const makerId = p.assignmentRule?.makerCheckerId ?? ''
                const officerId = p.assignmentRule?.claimsOfficerId ?? ''
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <select
                          className={selectClass}
                          value={makerId}
                          onChange={(e) => savePin(p, 'makerCheckerId', e.target.value)}
                        >
                          <option value="">— Auto —</option>
                          {makers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {userLabel(u)}
                            </option>
                          ))}
                        </select>
                        {savedKey === `${p.id}:makerCheckerId` && (
                          <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <select
                          className={selectClass}
                          value={officerId}
                          onChange={(e) => savePin(p, 'claimsOfficerId', e.target.value)}
                        >
                          <option value="">— Auto —</option>
                          {officers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {userLabel(u)}
                            </option>
                          ))}
                        </select>
                        {savedKey === `${p.id}:claimsOfficerId` && (
                          <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    No providers found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
