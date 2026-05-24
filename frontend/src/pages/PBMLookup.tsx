import { useState } from 'react'
import { Pill, Plus, Trash2, Search, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import api from '@/services/api'

interface DrugResult {
  drugCode: string
  covered: boolean
  formularyTier: number
  genericAlt: string | null
  copayAmount: number
  ddInteractionWarnings: string[]
}

const TIER_LABELS: Record<number, string> = {
  1: 'Preferred (Tier 1)',
  2: 'Non-Preferred (Tier 2)',
  3: 'Specialty (Tier 3)',
}

const TIER_COLORS: Record<number, string> = {
  1: 'bg-emerald-100 text-emerald-700',
  2: 'bg-amber-100 text-amber-700',
  3: 'bg-red-100 text-red-700',
}

export default function PBMLookup() {
  const [codes, setCodes] = useState<string[]>([''])
  const [results, setResults] = useState<DrugResult[]>([])
  const [loading, setLoading] = useState(false)

  function addCode() {
    setCodes((prev) => [...prev, ''])
  }

  function removeCode(i: number) {
    setCodes((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateCode(i: number, val: string) {
    setCodes((prev) => prev.map((c, idx) => (idx === i ? val.toUpperCase() : c)))
  }

  async function check() {
    const drugCodes = codes.filter(Boolean)
    if (drugCodes.length === 0) return
    setLoading(true)
    try {
      const res = await api.post('/pbm/eligibility', { drugCodes })
      setResults(res.data)
    } catch {
      alert('PBM check failed')
    } finally {
      setLoading(false)
    }
  }

  const totalInteractions = results.reduce((n, r) => n + r.ddInteractionWarnings.length, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Pill className="h-6 w-6 text-purple-500" />
        <div>
          <h1 className="text-2xl font-bold">Pharmacy Benefit Manager (PBM)</h1>
          <p className="text-muted-foreground text-sm">Check drug coverage, formulary tier, and interaction warnings</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drug Code Lookup</CardTitle>
            <CardDescription>Enter drug codes from the formulary (e.g. MET500, ATV40)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {codes.map((code, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => updateCode(i, e.target.value)}
                  placeholder="Drug code"
                  className="font-mono"
                />
                {codes.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeCode(i)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addCode} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> Add Drug
            </Button>
            <Button className="w-full" onClick={check} disabled={loading || codes.every(c => !c)}>
              {loading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking...</>
                : <><Search className="h-4 w-4 mr-2" /> Check Eligibility</>}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Results</CardTitle>
              {totalInteractions > 0 && (
                <Badge className="bg-red-100 text-red-700">
                  <AlertTriangle className="h-3 w-3 mr-1" /> {totalInteractions} interaction(s)
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.length === 0 && (
              <p className="text-sm text-muted-foreground">Run a check to see results.</p>
            )}
            {results.map((r) => (
              <div key={r.drugCode} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold">{r.drugCode}</span>
                  {r.covered
                    ? <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle className="h-3 w-3 mr-1" /> Covered</Badge>
                    : <Badge className="bg-red-100 text-red-700"><XCircle className="h-3 w-3 mr-1" /> Not Covered</Badge>}
                </div>
                {r.covered && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge className={TIER_COLORS[r.formularyTier] ?? ''}>{TIER_LABELS[r.formularyTier] ?? `Tier ${r.formularyTier}`}</Badge>
                    <span className="text-muted-foreground">Copay: KES {r.copayAmount.toFixed(0)}</span>
                    {r.genericAlt && <span className="text-blue-600">Generic alt: {r.genericAlt}</span>}
                  </div>
                )}
                {r.ddInteractionWarnings.map((w, j) => (
                  <div key={j} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded p-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
