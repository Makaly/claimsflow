import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Trash2, Copy, ChevronUp, ChevronDown, Brain, GripVertical } from 'lucide-react'
import {
  jobSetupApi,
  lookupApi,
  BUILTIN_SOURCE_COLUMNS,
  type JobSetup,
  type JobSetupField,
  type FieldType,
  type FieldSource,
  type LookupSource,
} from '@/services/jobSetupService'

const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'currency', 'boolean', 'textarea']
const FIELD_SOURCES: FieldSource[] = ['manual', 'extraction', 'lookup']

const blankField = (i: number): JobSetupField => ({
  key: '',
  label: '',
  type: 'text',
  required: false,
  source: 'manual',
  sortOrder: i,
  options: [],
  autoPopulate: false,
})

export default function JobSetups() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<JobSetup> | null>(null)

  const { data: setups = [], isLoading } = useQuery({ queryKey: ['job-setups'], queryFn: () => jobSetupApi.list() })
  const { data: sources = [] } = useQuery({ queryKey: ['lookup-sources'], queryFn: () => lookupApi.listSources() })

  const save = useMutation({
    mutationFn: (s: Partial<JobSetup>) =>
      s.id ? jobSetupApi.update(s.id, s) : jobSetupApi.create(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-setups'] })
      setEditing(null)
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => jobSetupApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-setups'] }),
  })
  const clone = useMutation({
    mutationFn: (id: string) => jobSetupApi.clone(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-setups'] }),
  })

  if (isLoading) return <div className="p-6">Loading job setups…</div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" /> Job Setups
          </h1>
          <p className="text-sm text-muted-foreground">
            Document-type profiles users pick when uploading. Each owns its own custom index fields,
            auto-populate lookups, and an isolated learning model.
          </p>
        </div>
        <button
          onClick={() =>
            setEditing({
              name: '',
              isActive: true,
              learningEnabled: true,
              autoPopulateFromHistory: true,
              color: '#2563eb',
              fields: [blankField(0)],
            })
          }
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium flex items-center gap-1"
        >
          <Plus className="h-4 w-4" /> New Setup
        </button>
      </div>

      {editing && (
        <SetupEditor
          value={editing}
          sources={sources}
          onChange={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
          error={(save.error as any)?.response?.data?.message}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {setups.map((s) => (
          <div key={s.id} className="border rounded-lg p-4" style={{ borderLeftColor: s.color ?? undefined, borderLeftWidth: s.color ? 4 : undefined }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{s.name}</h3>
                  {!s.isActive && <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">inactive</span>}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{s.slug}</p>
                {s.description && <p className="text-sm mt-1 text-muted-foreground">{s.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => clone.mutate(s.id)} title="Clone" className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={() => confirm(`Delete "${s.name}"?`) && del.mutate(s.id)} title="Delete" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-3">
              {s.fields.map((f) => (
                <span
                  key={f.key}
                  className="text-[11px] border px-2 py-0.5 rounded-full"
                  title={`${f.label} · ${f.source}${f.autoPopulate ? ' · auto' : ''}`}
                >
                  {f.label}
                  {f.required && <span className="text-destructive">*</span>}
                  {f.source === 'lookup' && ' 🔗'}
                  {f.source === 'extraction' && ' 🤖'}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Brain className="h-3 w-3" />
                {s.learningEnabled ? `learning on · ${s._count?.knowledge ?? 0} values` : 'learning off'}
              </span>
              <button onClick={() => setEditing(s)} className="text-primary hover:underline">
                Configure
              </button>
            </div>
          </div>
        ))}
        {setups.length === 0 && (
          <p className="text-sm text-muted-foreground">No job setups yet. Create one to get started.</p>
        )}
      </div>
    </div>
  )
}

function SetupEditor({
  value,
  sources,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: Partial<JobSetup>
  sources: LookupSource[]
  onChange: (v: Partial<JobSetup>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error?: string
}) {
  const fields = value.fields ?? []
  const set = (patch: Partial<JobSetup>) => onChange({ ...value, ...patch })
  const setFields = (f: JobSetupField[]) => set({ fields: f.map((x, i) => ({ ...x, sortOrder: i })) })
  const updateField = (i: number, patch: Partial<JobSetupField>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    setFields(next)
  }

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-muted/40">
      <h3 className="font-semibold text-lg">{value.id ? 'Configure setup' : 'New job setup'}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input className="w-full border rounded px-3 py-1.5 text-sm mt-1" value={value.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Document type</span>
          <input className="w-full border rounded px-3 py-1.5 text-sm mt-1" placeholder="invoice, discharge_summary…" value={value.documentType ?? ''} onChange={(e) => set({ documentType: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Accent color</span>
          <input type="color" className="w-full border rounded px-2 py-0.5 h-9 mt-1" value={value.color ?? '#2563eb'} onChange={(e) => set({ color: e.target.value })} />
        </label>
      </div>
      <label className="text-sm block">
        <span className="text-muted-foreground">Description</span>
        <input className="w-full border rounded px-3 py-1.5 text-sm mt-1" value={value.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </label>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.isActive ?? true} onChange={(e) => set({ isActive: e.target.checked })} /> Active
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.learningEnabled ?? true} onChange={(e) => set({ learningEnabled: e.target.checked })} /> Learn from this setup
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.autoPopulateFromHistory ?? true} onChange={(e) => set({ autoPopulateFromHistory: e.target.checked })} /> Auto-fill from learned history
        </label>
      </div>

      {/* ── Field builder ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">Index fields</h4>
          <button
            onClick={() => setFields([...fields, blankField(fields.length)])}
            className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-background"
          >
            <Plus className="h-3 w-3" /> Add field
          </button>
        </div>

        {fields.map((f, i) => (
          <FieldRow
            key={i}
            field={f}
            index={i}
            allFields={fields}
            sources={sources}
            onChange={(patch) => updateField(i, patch)}
            onRemove={() => setFields(fields.filter((_, idx) => idx !== i))}
            onMove={(dir) => move(i, dir)}
          />
        ))}
        {fields.length === 0 && <p className="text-xs text-muted-foreground">No fields yet — add at least one.</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !value.name} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save setup'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border rounded text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}

function FieldRow({
  field,
  index,
  allFields,
  sources,
  onChange,
  onRemove,
  onMove,
}: {
  field: JobSetupField
  index: number
  allFields: JobSetupField[]
  sources: LookupSource[]
  onChange: (patch: Partial<JobSetupField>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const selectedSource = sources.find((s) => s.id === field.lookupSourceId)
  const returnColumns: string[] = selectedSource
    ? BUILTIN_SOURCE_COLUMNS[selectedSource.type] ?? selectedSource.columns.map((c) => c.name)
    : []
  // candidate key fields = other fields in this setup
  const otherFields = allFields.filter((f) => f.key && f.key !== field.key)

  return (
    <div className="border rounded-md p-3 bg-background space-y-2">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          className="border rounded px-2 py-1 text-sm w-32"
          placeholder="key"
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value.replace(/\s+/g, '') })}
        />
        <input
          className="border rounded px-2 py-1 text-sm flex-1"
          placeholder="Label"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select className="border rounded px-2 py-1 text-sm" value={field.type} onChange={(e) => onChange({ type: e.target.value as FieldType })}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} /> req
        </label>
        <div className="flex flex-col">
          <button onClick={() => onMove(-1)} className="text-muted-foreground hover:text-foreground"><ChevronUp className="h-3 w-3" /></button>
          <button onClick={() => onMove(1)} className="text-muted-foreground hover:text-foreground"><ChevronDown className="h-3 w-3" /></button>
        </div>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-6">
        <span className="text-xs text-muted-foreground">Populate via</span>
        <select className="border rounded px-2 py-1 text-sm" value={field.source} onChange={(e) => onChange({ source: e.target.value as FieldSource })}>
          {FIELD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {field.source === 'extraction' && (
          <input
            className="border rounded px-2 py-1 text-sm w-48"
            placeholder="OCR key (e.g. invoiceNumber)"
            value={field.extractionKey ?? ''}
            onChange={(e) => onChange({ extractionKey: e.target.value })}
          />
        )}

        {field.source === 'lookup' && (
          <>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={field.lookupSourceId ?? ''}
              onChange={(e) => onChange({ lookupSourceId: e.target.value, lookupReturn: '' })}
            >
              <option value="">— source —</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">keyed by</span>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={field.lookupKeyField ?? ''}
              onChange={(e) => onChange({ lookupKeyField: e.target.value })}
            >
              <option value="">— field —</option>
              {otherFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label || f.key}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">returns</span>
            {returnColumns.length > 0 ? (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={field.lookupReturn ?? ''}
                onChange={(e) => onChange({ lookupReturn: e.target.value })}
              >
                <option value="">— column —</option>
                {returnColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="border rounded px-2 py-1 text-sm w-36"
                placeholder="return column"
                value={field.lookupReturn ?? ''}
                onChange={(e) => onChange({ lookupReturn: e.target.value })}
              />
            )}
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={field.autoPopulate} onChange={(e) => onChange({ autoPopulate: e.target.checked })} /> auto
            </label>
          </>
        )}

        {field.type === 'select' && (
          <input
            className="border rounded px-2 py-1 text-sm flex-1 min-w-48"
            placeholder="options, comma-separated"
            value={(field.options ?? []).map((o) => o.label).join(', ')}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((v) => ({ value: v, label: v })),
              })
            }
          />
        )}
      </div>
    </div>
  )
}
