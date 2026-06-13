import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layers, Plus, Trash2, Copy, ChevronUp, ChevronDown, Brain, GripVertical,
  Settings2, Scan, Scissors, ListChecks, Crop, FileOutput, Users, X, Search,
  UserCheck,
} from 'lucide-react'
import {
  jobSetupApi,
  lookupApi,
  BUILTIN_SOURCE_COLUMNS,
  SYSTEM_VALUE_LABELS,
  type JobSetup,
  type JobSetupField,
  type FieldType,
  type FieldSource,
  type SystemValue,
  type LookupSource,
  type SeparationMethod,
  type OutputTarget,
  type OutputFormat,
} from '@/services/jobSetupService'
import { userService } from '@/services/userService'

const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'currency', 'boolean', 'textarea']
const FIELD_SOURCES: FieldSource[] = ['manual', 'extraction', 'lookup', 'system', 'barcode', 'ocrZone']
const SYSTEM_VALUES = Object.keys(SYSTEM_VALUE_LABELS) as SystemValue[]
const SEPARATION_METHODS: SeparationMethod[] = ['none', 'fixedCount', 'blankPage', 'barcode', 'patchcode', 'ocrPhrase']
const OUTPUT_FORMATS: OutputFormat[] = ['csv', 'xml', 'json', 'searchablePdf']

type TabKey = 'general' | 'capture' | 'separation' | 'fields' | 'zones' | 'output' | 'users'
const TABS: { key: TabKey; label: string; icon: typeof Settings2 }[] = [
  { key: 'general',    label: 'General',      icon: Settings2 },
  { key: 'capture',    label: 'Capture',      icon: Scan },
  { key: 'separation', label: 'Separation',   icon: Scissors },
  { key: 'fields',     label: 'Index Fields', icon: ListChecks },
  { key: 'zones',      label: 'OCR Zones',    icon: Crop },
  { key: 'output',     label: 'Output',       icon: FileOutput },
  { key: 'users',      label: 'Assigned Users', icon: Users },
]

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
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  {s.learningEnabled ? `learning on · ${s._count?.knowledge ?? 0} values` : 'learning off'}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {(s._count as any)?.assignments > 0
                    ? `${(s._count as any).assignments} user${(s._count as any).assignments !== 1 ? 's' : ''}`
                    : 'all users'}
                </span>
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

const fieldClass = 'w-full border rounded px-3 py-1.5 text-sm mt-1 bg-background'

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
  const [tab, setTab] = useState<TabKey>('general')
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

  const zoneFields = fields.filter((f) => f.source === 'ocrZone')

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-muted/40">
      <h3 className="font-semibold text-lg">{value.id ? 'Configure setup' : 'New job setup'}</h3>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          const count = t.key === 'fields' ? fields.length : t.key === 'zones' ? zoneFields.length : t.key === 'users' ? (value._count as any)?.assignments : undefined
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${
                active ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
              {count != null && <span className="text-[10px] bg-muted rounded-full px-1.5">{count}</span>}
            </button>
          )
        })}
      </div>

      {tab === 'general' && <GeneralTab value={value} set={set} />}
      {tab === 'capture' && <CaptureTab value={value} set={set} />}
      {tab === 'separation' && <SeparationTab value={value} set={set} />}
      {tab === 'fields' && (
        <FieldsTab
          fields={fields}
          sources={sources}
          onAdd={() => setFields([...fields, blankField(fields.length)])}
          updateField={updateField}
          removeField={(i) => setFields(fields.filter((_, idx) => idx !== i))}
          move={move}
        />
      )}
      {tab === 'zones' && (
        <ZonesTab zoneFields={zoneFields} fields={fields} updateField={updateField} />
      )}
      {tab === 'output' && <OutputTab value={value} set={set} fields={fields} />}
      {tab === 'users' && <UsersTab setupId={value.id} />}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 border-t pt-3">
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

// ── General tab ───────────────────────────────────────────────────────────────
function GeneralTab({ value, set }: { value: Partial<JobSetup>; set: (p: Partial<JobSetup>) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input className={fieldClass} value={value.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Document type</span>
          <input className={fieldClass} placeholder="invoice, discharge_summary…" value={value.documentType ?? ''} onChange={(e) => set({ documentType: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Accent color</span>
          <input type="color" className="w-full border rounded px-2 py-0.5 h-9 mt-1" value={value.color ?? '#2563eb'} onChange={(e) => set({ color: e.target.value })} />
        </label>
      </div>
      <label className="text-sm block">
        <span className="text-muted-foreground">Description</span>
        <input className={fieldClass} value={value.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
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

      {/* Naming patterns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Batch name pattern</span>
          <input className={`${fieldClass} font-mono`} placeholder="{date}-{batchCounter}" value={value.naming?.batchPattern ?? ''} onChange={(e) => set({ naming: { ...value.naming, batchPattern: e.target.value } })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Document name pattern</span>
          <input className={`${fieldClass} font-mono`} placeholder="{field:memberNumber}-{docCounter}" value={value.naming?.documentPattern ?? ''} onChange={(e) => set({ naming: { ...value.naming, documentPattern: e.target.value } })} />
        </label>
        <p className="text-[11px] text-muted-foreground md:col-span-2">
          Tokens: <code>{'{date}'}</code> <code>{'{batchCounter}'}</code> <code>{'{docCounter}'}</code> <code>{'{sequence}'}</code> <code>{'{field:KEY}'}</code>
        </p>
      </div>
    </div>
  )
}

// ── Capture tab (Phase 5 execution; config editable now) ──────────────────────
function CaptureTab({ value, set }: { value: Partial<JobSetup>; set: (p: Partial<JobSetup>) => void }) {
  const c = value.captureSettings ?? {}
  const setC = (patch: Partial<typeof c>) => set({ captureSettings: { ...c, ...patch } })
  const toggle = (k: keyof typeof c, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!(c as any)[k]} onChange={(e) => setC({ [k]: e.target.checked } as any)} /> {label}
    </label>
  )
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Scan & image settings applied to captured/uploaded pages. Hardware-only options pass through to the scan agent where supported.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Resolution (DPI)</span>
          <input type="number" className={fieldClass} value={c.dpi ?? ''} placeholder="300" onChange={(e) => setC({ dpi: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Color mode</span>
          <select className={fieldClass} value={c.colorMode ?? 'color'} onChange={(e) => setC({ colorMode: e.target.value as any })}>
            <option value="bw">Black &amp; white</option>
            <option value="gray">Grayscale</option>
            <option value="color">Color</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Page size</span>
          <input className={fieldClass} placeholder="A4, Letter…" value={c.pageSize ?? ''} onChange={(e) => setC({ pageSize: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Imprint text</span>
          <input className={fieldClass} placeholder="endorser string" value={c.imprintText ?? ''} onChange={(e) => setC({ imprintText: e.target.value })} />
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 border-t pt-3">
        {toggle('duplex', 'Duplex (both sides)')}
        {toggle('deskew', 'Deskew')}
        {toggle('despeckle', 'Despeckle')}
        {toggle('autoCrop', 'Auto-crop')}
        {toggle('borderCrop', 'Border crop')}
        {toggle('holeFill', 'Hole fill')}
      </div>
      <div className="flex items-center gap-3 border-t pt-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!c.blankPageRemoval?.enabled} onChange={(e) => setC({ blankPageRemoval: { ...c.blankPageRemoval, enabled: e.target.checked } })} /> Drop blank pages
        </label>
        {c.blankPageRemoval?.enabled && (
          <label className="flex items-center gap-2 text-muted-foreground">
            threshold
            <input type="number" step="0.01" min="0" max="1" className="border rounded px-2 py-1 text-sm w-24 bg-background" value={c.blankPageRemoval?.threshold ?? 0.99} onChange={(e) => setC({ blankPageRemoval: { ...c.blankPageRemoval, threshold: Number(e.target.value) } })} />
          </label>
        )}
      </div>
    </div>
  )
}

// ── Separation tab (Phase 3 execution; config editable now) ───────────────────
function SeparationTab({ value, set }: { value: Partial<JobSetup>; set: (p: Partial<JobSetup>) => void }) {
  const r = value.separationRules ?? { method: 'none' as SeparationMethod }
  const setR = (patch: Partial<typeof r>) => set({ separationRules: { ...r, ...patch } })
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        How a multi-page upload is split into separate documents/claims.
      </p>
      <label className="text-sm block max-w-xs">
        <span className="text-muted-foreground">Separation method</span>
        <select className={fieldClass} value={r.method} onChange={(e) => setR({ method: e.target.value as SeparationMethod })}>
          {SEPARATION_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      {r.method === 'fixedCount' && (
        <label className="text-sm block max-w-xs">
          <span className="text-muted-foreground">Pages per document</span>
          <input type="number" min={1} className={fieldClass} value={r.pagesPerDoc ?? 1} onChange={(e) => setR({ pagesPerDoc: Number(e.target.value) })} />
        </label>
      )}
      {r.method === 'barcode' && (
        <label className="text-sm block max-w-xs">
          <span className="text-muted-foreground">Barcode prefix that starts a new doc</span>
          <input className={fieldClass} placeholder="CIC-" value={r.barcodePrefix ?? ''} onChange={(e) => setR({ barcodePrefix: e.target.value })} />
        </label>
      )}
      {r.method === 'ocrPhrase' && (
        <label className="text-sm block max-w-md">
          <span className="text-muted-foreground">Header phrase that starts a new doc</span>
          <input className={fieldClass} placeholder="INVOICE / TAX INVOICE" value={r.ocrPhrase ?? ''} onChange={(e) => setR({ ocrPhrase: e.target.value })} />
        </label>
      )}
      <label className="text-sm block max-w-xs">
        <span className="text-muted-foreground">Max pages per document (optional)</span>
        <input type="number" min={1} className={fieldClass} value={r.maxPages ?? ''} onChange={(e) => setR({ maxPages: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
    </div>
  )
}

// ── Index Fields tab ──────────────────────────────────────────────────────────
function FieldsTab({
  fields, sources, onAdd, updateField, removeField, move,
}: {
  fields: JobSetupField[]
  sources: LookupSource[]
  onAdd: () => void
  updateField: (i: number, patch: Partial<JobSetupField>) => void
  removeField: (i: number) => void
  move: (i: number, dir: -1 | 1) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">Index fields</h4>
        <button onClick={onAdd} className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-background">
          <Plus className="h-3 w-3" /> Add field
        </button>
      </div>
      {fields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          allFields={fields}
          sources={sources}
          onChange={(patch) => updateField(i, patch)}
          onRemove={() => removeField(i)}
          onMove={(dir) => move(i, dir)}
        />
      ))}
      {fields.length === 0 && <p className="text-xs text-muted-foreground">No fields yet — add at least one.</p>}
    </div>
  )
}

// ── OCR Zones tab ─────────────────────────────────────────────────────────────
function ZonesTab({
  zoneFields, fields, updateField,
}: {
  zoneFields: JobSetupField[]
  fields: JobSetupField[]
  updateField: (i: number, patch: Partial<JobSetupField>) => void
}) {
  const [sampleUrl, setSampleUrl] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(zoneFields[0]?.key ?? null)

  if (zoneFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No OCR-zone fields. In <strong>Index Fields</strong>, set a field's “Populate via” to <code>ocrZone</code> to bind it to a page region here.
      </p>
    )
  }

  const activeIdx = activeKey ? fields.findIndex((f) => f.key === activeKey) : -1

  function onDraw(rect: { x: number; y: number; w: number; h: number }) {
    if (activeIdx < 0) return
    const prev = fields[activeIdx].zone ?? {}
    updateField(activeIdx, {
      zone: { ...prev, xPercent: rect.x, yPercent: rect.y, widthPercent: rect.w, heightPercent: rect.h },
    })
  }

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      {/* Sample page + draw surface */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <label className="border rounded px-2 py-1 cursor-pointer hover:bg-background">
            Load sample page…
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setSampleUrl(URL.createObjectURL(file))
            }} />
          </label>
          {activeKey && <span className="text-muted-foreground">Drawing zone for <strong>{fields[activeIdx]?.label || activeKey}</strong></span>}
        </div>
        <ZoneCanvas
          sampleUrl={sampleUrl}
          zones={zoneFields.map((f) => ({ key: f.key, label: f.label || f.key, zone: f.zone ?? null, active: f.key === activeKey }))}
          onDraw={onDraw}
        />
        <p className="text-[11px] text-muted-foreground">
          Load a representative page, pick a field on the right, then drag a box over the value. Coordinates are stored as page percentages.
        </p>
      </div>

      {/* Field list + numeric fine-tune */}
      <div className="space-y-2">
        {zoneFields.map((f) => {
          const idx = fields.indexOf(f)
          const z = f.zone ?? { xPercent: 10, yPercent: 10, widthPercent: 30, heightPercent: 8 }
          const setZ = (patch: Partial<typeof z>) => updateField(idx, { zone: { ...z, ...patch } })
          const active = f.key === activeKey
          return (
            <div key={f.key || idx} className={`border rounded-md p-2 space-y-2 cursor-pointer ${active ? 'border-primary bg-primary/5' : 'bg-background'}`} onClick={() => setActiveKey(f.key)}>
              <div className="font-medium text-sm flex items-center gap-2">
                <Crop className="h-3.5 w-3.5" /> {f.label || f.key || '(unnamed)'}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['xPercent', 'yPercent', 'widthPercent', 'heightPercent'] as const).map((k) => (
                  <label key={k} className="text-[10px]">
                    <span className="text-muted-foreground">{k.replace('Percent', '')}</span>
                    <input type="number" min={0} max={100} className="w-full border rounded px-1 py-0.5 text-xs mt-0.5 bg-background" value={Math.round((z as any)[k] ?? 0)} onChange={(e) => setZ({ [k]: Number(e.target.value) } as any)} onClick={(e) => e.stopPropagation()} />
                  </label>
                ))}
              </div>
              <div className="flex gap-1">
                <input type="number" min={1} title="page" className="border rounded px-1 py-0.5 text-xs w-14 bg-background" value={z.page ?? 1} onChange={(e) => setZ({ page: Number(e.target.value) })} onClick={(e) => e.stopPropagation()} />
                <input className="border rounded px-1 py-0.5 text-xs flex-1 bg-background" placeholder="anchor phrase" value={z.searchPhrase ?? ''} onChange={(e) => setZ({ searchPhrase: e.target.value })} onClick={(e) => e.stopPropagation()} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Drag-to-draw rectangle surface over a sample page (percentage coords).
function ZoneCanvas({
  sampleUrl, zones, onDraw,
}: {
  sampleUrl: string | null
  zones: { key: string; label: string; zone: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } | null; active: boolean }[]
  onDraw: (rect: { x: number; y: number; w: number; h: number }) => void
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  function pct(e: ReactMouseEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
    }
  }
  const rectOf = (d: NonNullable<typeof drag>) => ({
    x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
    w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0),
  })

  return (
    <div
      className="relative border rounded bg-muted/40 overflow-hidden select-none"
      style={{ aspectRatio: '0.7072', minHeight: 320 }}
      onMouseDown={(e) => { const p = pct(e, e.currentTarget); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }}
      onMouseMove={(e) => { if (drag) { const p = pct(e, e.currentTarget); setDrag({ ...drag, x1: p.x, y1: p.y }) } }}
      onMouseUp={() => { if (drag) { const r = rectOf(drag); if (r.w > 1 && r.h > 1) onDraw(r); setDrag(null) } }}
      onMouseLeave={() => setDrag(null)}
    >
      {sampleUrl
        ? <img src={sampleUrl} alt="sample page" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Load a sample page to draw zones</div>}
      {/* existing zones */}
      {zones.filter((z) => z.zone).map((z) => (
        <div key={z.key}
          className={`absolute border-2 ${z.active ? 'border-primary bg-primary/15' : 'border-amber-500/70 bg-amber-500/10'}`}
          style={{ left: `${z.zone!.xPercent}%`, top: `${z.zone!.yPercent}%`, width: `${z.zone!.widthPercent}%`, height: `${z.zone!.heightPercent}%` }}>
          <span className="absolute -top-4 left-0 text-[9px] bg-background/80 px-1 rounded whitespace-nowrap">{z.label}</span>
        </div>
      ))}
      {/* live drag rectangle */}
      {drag && (() => { const r = rectOf(drag); return (
        <div className="absolute border-2 border-primary bg-primary/20" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
      ) })()}
    </div>
  )
}

// ── Output tab (Phase 4 execution; config editable now) ───────────────────────
function OutputTab({
  value, set, fields,
}: {
  value: Partial<JobSetup>
  set: (p: Partial<JobSetup>) => void
  fields: JobSetupField[]
}) {
  const targets = value.outputTargets ?? []
  const setTargets = (t: OutputTarget[]) => set({ outputTargets: t })
  const update = (i: number, patch: Partial<OutputTarget>) =>
    setTargets(targets.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  const addTarget = () =>
    setTargets([...targets, { id: `t${targets.length + 1}`, type: 'csv', namePattern: '{batchName}', fields: [] }])
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Export destinations produced for a completed batch.</p>
        <button onClick={addTarget} className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-background">
          <Plus className="h-3 w-3" /> Add target
        </button>
      </div>
      {targets.map((t, i) => (
        <div key={t.id} className="border rounded-md p-3 bg-background space-y-2">
          <div className="flex items-center gap-2">
            <select className="border rounded px-2 py-1 text-sm" value={t.type} onChange={(e) => update(i, { type: e.target.value as OutputFormat })}>
              {OUTPUT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <input className="border rounded px-2 py-1 text-sm flex-1 font-mono" placeholder="name pattern e.g. {batchName}-{docCounter}" value={t.namePattern ?? ''} onChange={(e) => update(i, { namePattern: e.target.value })} />
            <button onClick={() => setTargets(targets.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">subfolder by</label>
            <select className="border rounded px-2 py-1 text-sm" value={t.subfolderBy ?? ''} onChange={(e) => update(i, { subfolderBy: e.target.value || undefined })}>
              <option value="">— none —</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
            </select>
            <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="destination folder (optional)" value={t.destination ?? ''} onChange={(e) => update(i, { destination: e.target.value })} />
          </div>
        </div>
      ))}
      {targets.length === 0 && <p className="text-xs text-muted-foreground">No export targets configured.</p>}
    </div>
  )
}

// ── Users / assignment tab ────────────────────────────────────────────────────
function UsersTab({ setupId }: { setupId?: string }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  const { data: assignments = [], isLoading: loadingAssign } = useQuery({
    queryKey: ['job-setup-assignments', setupId],
    queryFn: () => jobSetupApi.getAssignments(setupId!),
    enabled: !!setupId,
  })

  const { data: allUsers = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => userService.getAll().then((r: any) => r?.users ?? r ?? []),
  })

  const saveMutation = useMutation({
    mutationFn: (userIds: string[]) => jobSetupApi.setAssignments(setupId!, userIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-setup-assignments', setupId] })
      qc.invalidateQueries({ queryKey: ['job-setups'] })
    },
  })

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!setupId) {
    return <p className="text-sm text-muted-foreground">Save the setup first, then come back to assign users.</p>
  }

  if (loadingAssign || loadingUsers)
    return <p className="text-sm text-muted-foreground">Loading…</p>

  const assignedIds = new Set(assignments.map((a) => a.userId))
  const filtered = (allUsers as any[]).filter(
    (u) =>
      !assignedIds.has(u.id) &&
      (!search ||
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())),
  )

  const remove = (userId: string) => {
    saveMutation.mutate(assignments.filter((a) => a.userId !== userId).map((a) => a.userId))
  }

  const add = (u: any) => {
    saveMutation.mutate([...Array.from(assignedIds), u.id])
    setSearch('')
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Restrict this setup to specific users. If no users are assigned, all authenticated users can see it.
      </p>

      {/* Assigned list */}
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No restrictions — visible to all users.</p>
      ) : (
        <div className="space-y-1">
          {assignments.map((a) => (
            <div key={a.userId} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">{a.user.name}</p>
                  <p className="text-xs text-muted-foreground">{a.user.email} · {a.user.role}</p>
                </div>
              </div>
              <button type="button" onClick={() => remove(a.userId)} className="text-muted-foreground hover:text-destructive" title="Remove">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Dropdown search picker */}
      <div className="border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Add user</p>
        <div className="relative" ref={dropdownRef}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              className="w-full border rounded-md pl-8 pr-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Search by name or email…"
              value={search}
              onFocus={() => setOpen(true)}
              onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
            />
          </div>

          {open && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-muted-foreground">
                  {search ? 'No matching users' : 'All users already assigned'}
                </p>
              ) : (
                filtered.slice(0, 30).map((u: any) => (
                  <button
                    type="button"
                    key={u.id}
                    onMouseDown={(e) => { e.preventDefault(); add(u) }}
                    className="w-full text-left px-3 py-2 hover:bg-muted/60 text-sm flex items-center gap-3 border-b last:border-0"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full shrink-0">{u.role}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── A single index-field editor row ───────────────────────────────────────────
function FieldRow({
  field,
  allFields,
  sources,
  onChange,
  onRemove,
  onMove,
}: {
  field: JobSetupField
  allFields: JobSetupField[]
  sources: LookupSource[]
  onChange: (patch: Partial<JobSetupField>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const [showRules, setShowRules] = useState(false)
  const selectedSource = sources.find((s) => s.id === field.lookupSourceId)
  const returnColumns: string[] = selectedSource
    ? BUILTIN_SOURCE_COLUMNS[selectedSource.type] ?? selectedSource.columns.map((c) => c.name)
    : []
  const otherFields = allFields.filter((f) => f.key && f.key !== field.key)
  const v = field.validation ?? {}
  const setV = (patch: Partial<typeof v>) => onChange({ validation: { ...v, ...patch } })

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
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} /> req
        </label>
        <button onClick={() => setShowRules((s) => !s)} title="Validation & options" className={`text-xs ${showRules ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
          <Settings2 className="h-4 w-4" />
        </button>
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
            <option key={s} value={s}>{s}</option>
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

        {field.source === 'system' && (
          <select className="border rounded px-2 py-1 text-sm" value={field.systemValue ?? ''} onChange={(e) => onChange({ systemValue: e.target.value as SystemValue })}>
            <option value="">— system value —</option>
            {SYSTEM_VALUES.map((s) => (
              <option key={s} value={s}>{SYSTEM_VALUE_LABELS[s]}</option>
            ))}
          </select>
        )}

        {field.source === 'ocrZone' && (
          <span className="text-xs text-muted-foreground italic">Define the region in the “OCR Zones” tab.</span>
        )}

        {field.source === 'barcode' && (
          <span className="text-xs text-muted-foreground italic">Filled from the page barcode at capture.</span>
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
                <option key={s.id} value={s.id}>{s.name}</option>
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
                <option key={f.key} value={f.key}>{f.label || f.key}</option>
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
                  <option key={c} value={c}>{c}</option>
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
                  .map((vv) => ({ value: vv, label: vv })),
              })
            }
          />
        )}
      </div>

      {/* ── Validation / advanced rules ──────────────────────────────── */}
      {showRules && (
        <div className="pl-6 pt-2 mt-1 border-t space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input className="border rounded px-2 py-1 w-36" placeholder="default value" value={field.defaultValue ?? ''} onChange={(e) => onChange({ defaultValue: e.target.value })} />
            <input className="border rounded px-2 py-1 w-40 font-mono" placeholder="input mask ###-##" value={field.inputMask ?? ''} onChange={(e) => onChange({ inputMask: e.target.value })} />
            <input className="border rounded px-2 py-1 flex-1 min-w-40 font-mono" placeholder="regex pattern" value={v.regex ?? field.validationRegex ?? ''} onChange={(e) => setV({ regex: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input className="border rounded px-2 py-1 w-20" type="number" placeholder="min" value={v.min ?? ''} onChange={(e) => setV({ min: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className="border rounded px-2 py-1 w-20" type="number" placeholder="max" value={v.max ?? ''} onChange={(e) => setV({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className="border rounded px-2 py-1 w-24" type="number" placeholder="min len" value={v.minLength ?? ''} onChange={(e) => setV({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className="border rounded px-2 py-1 w-24" type="number" placeholder="max len" value={v.maxLength ?? ''} onChange={(e) => setV({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className="border rounded px-2 py-1 flex-1 min-w-40" placeholder="error message" value={v.message ?? ''} onChange={(e) => setV({ message: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!field.verifyDoubleKey} onChange={(e) => onChange({ verifyDoubleKey: e.target.checked })} /> Require double-key verification
          </label>
        </div>
      )}
    </div>
  )
}
