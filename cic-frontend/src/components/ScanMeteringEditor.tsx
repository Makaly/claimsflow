import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DollarSign, RotateCcw, Save } from 'lucide-react'
import api from '@/services/api'

export interface ScanMeteringSettings {
  providerId: string
  providerName?: string
  enabled: boolean
  costPerScan: number
  currency: string
  updatedAt?: string
}

interface Props {
  providerId: string
  initial?: ScanMeteringSettings
  variant?: 'card' | 'inline'
  onSaved?: (next: ScanMeteringSettings) => void
}

const CURRENCIES = ['KES', 'UGX', 'TZS', 'USD', 'EUR', 'GBP']

export default function ScanMeteringEditor({
  providerId,
  initial,
  variant = 'card',
  onSaved,
}: Props) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [costPerScan, setCostPerScan] = useState<string>(
    initial ? String(initial.costPerScan) : '5',
  )
  const [currency, setCurrency] = useState(initial?.currency ?? 'KES')
  const [loading, setLoading] = useState(!initial)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(initial?.updatedAt)

  useEffect(() => {
    if (initial) {
      setEnabled(initial.enabled)
      setCostPerScan(String(initial.costPerScan))
      setCurrency(initial.currency)
      setUpdatedAt(initial.updatedAt)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/scan-metering/settings')
        if (cancelled) return
        const row = data?.settings?.find?.(
          (s: ScanMeteringSettings) => s.providerId === providerId,
        )
        if (row) {
          setEnabled(row.enabled)
          setCostPerScan(String(row.costPerScan))
          setCurrency(row.currency)
          setUpdatedAt(row.updatedAt)
        }
      } catch {
        // Falls back to defaults; user can still save to create the row.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [providerId, initial])

  const handleSave = async () => {
    const parsed = Number(costPerScan)
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Cost per scan must be a non-negative number')
      return
    }
    if (parsed > 100_000) {
      toast.error('Cost per scan cannot exceed 100,000')
      return
    }
    setSaving(true)
    try {
      const { data } = await api.patch(`/scan-metering/settings/${providerId}`, {
        enabled,
        costPerScan: parsed,
        currency,
      })
      const next: ScanMeteringSettings = {
        providerId,
        enabled: data.enabled,
        costPerScan: Number(data.costPerScan),
        currency: data.currency,
        updatedAt: data.updatedAt,
      }
      setUpdatedAt(next.updatedAt)
      toast.success(`Per-scan rate saved: ${next.currency} ${next.costPerScan.toFixed(2)}`)
      onSaved?.(next)
    } catch (err: any) {
      toast.error(
        `Save failed: ${err?.response?.data?.message || err?.message || 'unknown error'}`,
      )
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Scanning enabled</p>
          <p className="text-xs text-muted-foreground">
            When disabled, users in this organization cannot start scans (camera or hardware).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {enabled
            ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>
            : <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>}
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={loading} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Cost per scan</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={costPerScan}
            onChange={(e) => setCostPerScan(e.target.value)}
            disabled={loading}
            placeholder="5.00"
          />
          <p className="text-[11px] text-muted-foreground">
            Charged once per successful scan event. Existing scan history is not retroactively re-priced.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency} disabled={loading}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-muted-foreground">
          {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}` : 'No saved value yet — defaults shown.'}
        </p>
        <Button onClick={handleSave} disabled={loading || saving} size="sm">
          {saving
            ? <><RotateCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</>
            : <><Save className="mr-1.5 h-3.5 w-3.5" />Save</>}
        </Button>
      </div>
    </div>
  )

  if (variant === 'inline') return body

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-amber-500/5 flex items-center gap-2">
        <DollarSign className="h-3.5 w-3.5 text-amber-500 opacity-70" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Scan Billing
        </span>
      </div>
      <div className="p-4">{body}</div>
    </div>
  )
}
