import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Wand2, Loader2, AlertCircle } from 'lucide-react'
import { jobSetupApi, validateFieldValues, type JobSetup, type JobSetupField } from '@/services/jobSetupService'
import { cn } from '@/lib/utils'

type Provenance = Record<string, 'lookup' | 'history' | 'extraction' | 'system' | 'manual'>

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
  onValidityChange,
}: {
  setup: JobSetup
  values: Record<string, any>
  onChange: (values: Record<string, any>) => void
  extracted?: Record<string, any>
  className?: string
  /** Called whenever validation state changes — true when all rules pass. */
  onValidityChange?: (valid: boolean, errors: Record<string, string>) => void
}) {
  const [provenance, setProvenance] = useState<Provenance>({})
  const [resolving, setResolving] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  // Blind re-key confirmations for fields with verifyDoubleKey.
  const [confirmValues, setConfirmValues] = useState<Record<string, string>>({})

  const fields = useMemo(
    () => [...setup.fields].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [setup.fields],
  )

  // ── Validation (mirrors the server rules) ───────────────────────────────────
  const errors = useMemo(() => {
    const errs = validateFieldValues(fields, values)
    // Double-key: a verified field must match its blind re-key.
    for (const f of fields) {
      if (!f.verifyDoubleKey) continue
      const v = values[f.key]
      if (v == null || String(v).trim() === '') continue
      if (String(confirmValues[f.key] ?? '') !== String(v)) {
        errs[f.key] = `${f.label || f.key} confirmation does not match`
      }
    }
    return errs
  }, [fields, values, confirmValues])

  useEffect(() => {
    onValidityChange?.(Object.keys(errors).length === 0, errors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors])

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
            error={errors[f.key]}
            confirmValue={confirmValues[f.key] ?? ''}
            onConfirmChange={(v) => setConfirmValues((c) => ({ ...c, [f.key]: v }))}
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
    lookup:     { label: 'looked up',    cls: 'bg-brand-100 text-brand-700 dark:bg-brand-950/50 dark:text-brand-400' },
    history:    { label: 'from history', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400' },
    extraction: { label: 'extracted',    cls: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400' },
    system:     { label: 'system',       cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' },
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
  error,
  confirmValue,
  onConfirmChange,
  onChange,
  onCommit,
}: {
  field: JobSetupField
  value: any
  via?: string
  setupId: string
  error?: string
  confirmValue: string
  onConfirmChange: (v: string) => void
  onChange: (v: any) => void
  onCommit: () => void
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [touched, setTouched] = useState(false)
  const listId = `sugg-${setupId}-${field.key}`
  const showError = touched && !!error
  const base = cn(
    'w-full border rounded px-3 py-1.5 text-sm mt-1 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
    showError ? 'border-destructive' : 'border-input',
  )

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

  const commit = () => { setTouched(true); onCommit() }
  const errorNode = showError ? (
    <span className="text-[11px] text-destructive flex items-center gap-1 mt-1">
      <AlertCircle className="h-3 w-3" /> {error}
    </span>
  ) : null
  const confirmNode = field.verifyDoubleKey ? (
    <input
      className={cn(base, 'mt-1')}
      type={field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      placeholder="re-enter to confirm"
      value={confirmValue}
      onChange={(e) => onConfirmChange(e.target.value)}
      onBlur={() => setTouched(true)}
    />
  ) : null

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
      <label className="text-sm flex flex-col">
        {label}
        <select className={base} value={value ?? ''} onChange={(e) => { onChange(e.target.value); commit() }}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {errorNode}
      </label>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label className="text-sm sm:col-span-2 flex flex-col">
        {label}
        <textarea
          className={cn(base, 'resize-none')}
          rows={3}
          placeholder={field.placeholder ?? ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
        />
        {errorNode}
      </label>
    )
  }

  const inputType = field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'date' ? 'date' : 'text'

  return (
    <label className="text-sm flex flex-col">
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
        onBlur={commit}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {confirmNode}
      {errorNode}
    </label>
  )
}
