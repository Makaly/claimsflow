import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Database, FileSpreadsheet, Globe, Trash2, Upload, Eye } from 'lucide-react'
import {
  lookupApi,
  SOURCE_TYPE_LABELS,
  type LookupSource,
  type SourceType,
} from '@/services/jobSetupService'

const FILE_TYPES: SourceType[] = ['excel', 'csv']
const TYPE_ICON: Record<string, any> = {
  excel: FileSpreadsheet,
  csv: FileSpreadsheet,
  rest_api: Globe,
  eoxegen_eligibility: Globe,
}

export default function LookupSources() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<LookupSource> | null>(null)
  const [preview, setPreview] = useState<{ id: string; rows: any[] } | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['lookup-sources'],
    queryFn: () => lookupApi.listSources(),
  })

  const save = useMutation({
    mutationFn: (s: Partial<LookupSource>) =>
      s.id ? lookupApi.updateSource(s.id, s) : lookupApi.createSource(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lookup-sources'] })
      setEditing(null)
    },
  })

  const del = useMutation({
    mutationFn: (id: string) => lookupApi.deleteSource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup-sources'] }),
  })

  const upload = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => lookupApi.uploadFile(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup-sources'] }),
  })

  async function showPreview(id: string) {
    const rows = await lookupApi.preview(id, 10)
    setPreview({ id, rows })
  }

  if (isLoading) return <div className="p-6">Loading data sources…</div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" /> Lookup Data Sources
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect reference data the indexing engine auto-populates from — built-in databases,
            external APIs, or your own Excel / CSV files.
          </p>
        </div>
        <button
          onClick={() => setEditing({ type: 'member_policy', isActive: true, config: {} })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
        >
          New Source
        </button>
      </div>

      {editing && (
        <SourceEditor
          value={editing}
          onChange={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
        />
      )}

      <div className="grid gap-3">
        {sources.map((s) => {
          const Icon = TYPE_ICON[s.type] ?? Database
          const isFile = FILE_TYPES.includes(s.type)
          return (
            <div key={s.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{s.name}</h3>
                      <span className="text-[11px] border px-2 py-0.5 rounded-full">
                        {SOURCE_TYPE_LABELS[s.type]}
                      </span>
                      {!s.isActive && (
                        <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">inactive</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{s.slug}</p>
                    {s.description && <p className="text-sm mt-1">{s.description}</p>}
                    {isFile && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.rowCount > 0
                          ? `${s.rowCount} rows · key column "${s.keyColumn}" · ${s.fileName ?? ''}`
                          : 'No file uploaded yet'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isFile && (
                    <>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        hidden
                        ref={(el) => (fileInputs.current[s.id] = el)}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) upload.mutate({ id: s.id, file: f })
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputs.current[s.id]?.click()}
                        className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-muted"
                      >
                        <Upload className="h-3 w-3" /> {s.rowCount > 0 ? 'Replace' : 'Upload'}
                      </button>
                      {s.rowCount > 0 && (
                        <button
                          onClick={() => showPreview(s.id)}
                          className="text-xs flex items-center gap-1 border px-2 py-1 rounded hover:bg-muted"
                        >
                          <Eye className="h-3 w-3" /> Preview
                        </button>
                      )}
                    </>
                  )}
                  <button onClick={() => setEditing(s)} className="text-xs text-primary hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => confirm(`Delete "${s.name}"?`) && del.mutate(s.id)}
                    className="text-xs text-destructive hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {preview?.id === s.id && preview.rows.length > 0 && (
                <div className="mt-3 overflow-x-auto border rounded">
                  <table className="text-xs w-full">
                    <thead className="bg-muted">
                      <tr>
                        {Object.keys(preview.rows[0].data).map((c) => (
                          <th key={c} className="px-2 py-1 text-left font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i} className="border-t">
                          {Object.values(r.data).map((v: any, j) => (
                            <td key={j} className="px-2 py-1">
                              {String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {sources.length === 0 && (
          <p className="text-sm text-muted-foreground">No data sources yet. Create one to get started.</p>
        )}
      </div>
    </div>
  )
}

function SourceEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  value: Partial<LookupSource>
  onChange: (v: Partial<LookupSource>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const isRest = value.type === 'rest_api'
  const isEligibility = value.type === 'eoxegen_eligibility'
  const set = (patch: Partial<LookupSource>) => onChange({ ...value, ...patch })
  const setConfig = (patch: Record<string, any>) => set({ config: { ...(value.config ?? {}), ...patch } })

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/40">
      <h3 className="font-semibold">{value.id ? 'Edit data source' : 'New data source'}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-muted-foreground">Name</span>
          <input
            className="w-full border rounded px-3 py-1.5 text-sm mt-1"
            value={value.name ?? ''}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Type</span>
          <select
            className="w-full border rounded px-3 py-1.5 text-sm mt-1"
            value={value.type}
            disabled={!!value.id}
            onChange={(e) => set({ type: e.target.value as SourceType })}
          >
            {Object.entries(SOURCE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-sm block">
        <span className="text-muted-foreground">Description</span>
        <input
          className="w-full border rounded px-3 py-1.5 text-sm mt-1"
          value={value.description ?? ''}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>

      {isRest && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Endpoint URL</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              placeholder="https://api.example.com/lookup"
              value={value.config?.url ?? ''}
              onChange={(e) => setConfig({ url: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Key query param</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              placeholder="q"
              value={value.config?.keyParam ?? ''}
              onChange={(e) => setConfig({ keyParam: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Result path (optional)</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              placeholder="data.0"
              value={value.config?.resultPath ?? ''}
              onChange={(e) => setConfig({ resultPath: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Authorization header (optional)</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              placeholder="Bearer …"
              value={value.config?.headers?.Authorization ?? ''}
              onChange={(e) => setConfig({ headers: { Authorization: e.target.value } })}
            />
          </label>
        </div>
      )}

      {isEligibility && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
          <label className="text-sm">
            <span className="text-muted-foreground">Base URL (optional — defaults to env)</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              value={value.config?.baseUrl ?? ''}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">API key (optional — defaults to env)</span>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm mt-1"
              value={value.config?.apiKey ?? ''}
              onChange={(e) => setConfig({ apiKey: e.target.value })}
            />
          </label>
        </div>
      )}

      <label className="text-sm flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.isActive ?? true}
          onChange={(e) => set({ isActive: e.target.checked })}
        />
        Active
      </label>

      {FILE_TYPES.includes(value.type as SourceType) && !value.id && (
        <p className="text-xs text-muted-foreground">
          Save first, then use the <strong>Upload</strong> button on the source card to import your
          spreadsheet. The first column is used as the lookup key by default.
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving || !value.name}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border rounded text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}
