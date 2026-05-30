import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Wand2, Loader2 } from 'lucide-react'
import { jobSetupApi, type JobSetup, type JobSetupField } from '@/services/jobSetupService'
import { cn } from '@/lib/utils'

type Provenance = Record<string, 'lookup' | 'history' | 'extraction' | 'manual'>

/**
 * Renders a job setup's custom index fields and auto-populates them:
 *  - fields with source=extraction are pre-filled from the OCR payload (extracted prop);
 *  - lookup-bound fields resolve when their key field changes (and via "Auto-fill");
 *  - empty fields can be filled from the setup's own learned history.
 * On save, confirmed values are sent back so the setup learns (isolated per setup).
 */
export function DynamicIndexForm({
  setup,
  values,
  onChange,
  extracted,
  className,
}: {
  setup: JobSetup
  values: Record<string, any>
  onChange: (values: Record<string, any>) => void
  extracted?: Record<string, any>
  className?: string
}) {
  const [provenance, setProvenance] = useState<Provenance>({})
  const [resolving, setResolving] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  const fields = useMemo(
    () => [...setup.fields].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [setup.fields],
  )

  // Seed extraction-sourced fields from the OCR payload once, when empty.
  useEffect(() => {
    if (!extracted) return
    const seeded: Record<string, any> = {}
    const prov: Provenance = {}
    for (const f of fields) {
      if (f.source === 'extraction' && f.extractionKey && extracted[f.extractionKey] != null) {
        const cur = values[f.key]
        if (cur === undefined || cur === null || cur === '') {
          seeded[f.key] = extracted[f.extractionKey]
          prov[f.key] = 'extraction'
        }
      }
    }
    if (Object.keys(seeded).length) {
      onChange({ ...values, ...seeded })
      setProvenance((p) => ({ ...p, ...prov }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted, setup.id])

  // Which field keys, when changed, should trigger a lookup?
  const keyFields = useMemo(() => {
    const keys = new Set<string>()
    for (const f of fields) {
      if (f.source === 'lookup' && f.autoPopulate && f.lookupKeyField) keys.add(f.lookupKeyField)
    }
    return keys
  }, [fields])

  async function runResolve(onlyField?: string) {
    setResolving(true)
    setWarnings([])
    try {
      const res = await jobSetupApi.resolve(setup.id, values, onlyField)
      const prov: Provenance = {}
      for (const [k, info] of Object.entries(res.filled)) prov[k] = info.via
      onChange(res.values)
      setProvenance((p) => ({ ...p, ...prov }))
      setWarnings(res.warnings ?? [])
    } catch {
      /* non-fatal — lookups are best-effort */
    } finally {
      setResolving(false)
    }
  }

  function setField(key: string, val: any) {
    onChange({ ...values, [key]: val })
    setProvenance((p) => ({ ...p, [key]: 'manual' }))
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{setup.name} — index fields</h3>
        <button
          type="button"
          onClick={() => runResolve()}
          disabled={resolving}
          className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
        >
          {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          Auto-fill
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key]}
            via={provenance[f.key]}
            setupId={setup.id}
            onChange={(v) => setField(f.key, v)}
            onCommit={() => {
              if (keyFields.has(f.key)) runResolve()
            }}
          />
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="text-xs text-amber-600 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function viaBadge(via?: string) {
  if (!via || via === 'manual') return null
  const map: Record<string, { label: string; cls: string }> = {
    lookup: { label: 'looked up', cls: 'bg-blue-100 text-blue-700' },
    history: { label: 'from history', cls: 'bg-purple-100 text-purple-700' },
    extraction: { label: 'extracted', cls: 'bg-green-100 text-green-700' },
  }
  const m = map[via]
  if (!m) return null
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5', m.cls)}>
      <Sparkles className="h-2.5 w-2.5" />
      {m.label}
    </span>
  )
}

function FieldInput({
  field,
  value,
  via,
  setupId,
  onChange,
  onCommit,
}: {
  field: JobSetupField
  value: any
  via?: string
  setupId: string
  onChange: (v: any) => void
  onCommit: () => void
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const listId = `sugg-${setupId}-${field.key}`
  const base = 'w-full border rounded px-3 py-1.5 text-sm mt-1'

  async function loadSuggestions(prefix: string) {
    try {
      const s = await jobSetupApi.suggest(setupId, field.key, prefix)
      setSuggestions(s.map((x) => x.value))
    } catch {
      /* ignore */
    }
  }

  const label = (
    <span className="text-muted-foreground flex items-center gap-2">
      {field.label}
      {field.required && <span className="text-destructive">*</span>}
      {viaBadge(via)}
    </span>
  )

  if (field.type === 'boolean') {
    return (
      <label className="text-sm flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <label className="text-sm">
        {label}
        <select className={base} value={value ?? ''} onChange={(e) => { onChange(e.target.value); onCommit() }}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label className="text-sm sm:col-span-2">
        {label}
        <textarea
          className={cn(base, 'resize-none')}
          rows={3}
          placeholder={field.placeholder ?? ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      </label>
    )
  }

  const inputType = field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'date' ? 'date' : 'text'

  return (
    <label className="text-sm">
      {label}
      <input
        className={base}
        type={inputType}
        list={listId}
        placeholder={field.placeholder ?? ''}
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value)
          if (inputType === 'text') loadSuggestions(e.target.value)
        }}
        onFocus={() => inputType === 'text' && loadSuggestions('')}
        onBlur={onCommit}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </label>
  )
}
