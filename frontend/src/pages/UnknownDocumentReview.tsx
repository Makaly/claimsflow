import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink,
  FileQuestion, Loader2, PlusCircle, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/services/api'

interface UnknownDoc {
  id: string
  fileName: string
  mimeType: string
  guessedType: string | null
  guessedProvider: string | null
  classificationReason: string | null
  rawExtract: Record<string, string> | null
  status: string
  createdAt: string
}

interface TemplateOption {
  id: string
  name: string
  documentType: string
  specificProvider: string | null
}

const DOCUMENT_TYPES = [
  { value: 'invoice',               label: 'Invoice' },
  { value: 'inpatient_invoice',     label: 'Inpatient Invoice' },
  { value: 'prescription',         label: 'Prescription' },
  { value: 'lab_result',           label: 'Lab Result' },
  { value: 'medical_report',       label: 'Medical Report' },
  { value: 'discharge_summary',    label: 'Discharge Summary' },
  { value: 'claim_form',           label: 'Claim Form' },
  { value: 'authorization_letter', label: 'Authorization Letter' },
  { value: 'other',                label: 'Other' },
]

export default function UnknownDocumentReview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [doc, setDoc]           = useState<UnknownDoc | null>(null)
  const [docLoading, setDocLoading] = useState(true)
  const [blobUrl, setBlobUrl]   = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(true)
  const [fileMissing, setFileMissing] = useState(false)

  // Classifier form
  const [templates, setTemplates]   = useState<TemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [mode, setMode]             = useState<'existing' | 'new'>('existing')
  const [selectedId, setSelectedId] = useState('')
  const [newName, setNewName]       = useState('')
  const [newDocType, setNewDocType] = useState('')
  const [newProvider, setNewProvider] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [promoting, setPromoting]   = useState(false)

  // Load document metadata + templates in parallel
  useEffect(() => {
    if (!id) return
    Promise.all([
      api.get<UnknownDoc>(`/unknown-documents/${id}`).then(({ data }) => {
        setDoc(data)
        setNewName(data.guessedProvider || '')
        setNewProvider(data.guessedProvider || '')
      }).finally(() => setDocLoading(false)),

      api.get<TemplateOption[]>('/document-classifiers').then(({ data }) => {
        setTemplates(data)
      }).finally(() => setTemplatesLoading(false)),
    ])
  }, [id])

  // Fetch file as blob so auth token is included
  useEffect(() => {
    if (!id) return
    setFileLoading(true)
    api.get(`/unknown-documents/${id}/file`, { responseType: 'blob' })
      .then(({ data }) => {
        const url = URL.createObjectURL(data)
        setBlobUrl(url)
      })
      .catch((err) => {
        if (err?.response?.status === 404) setFileMissing(true)
        else toast.error('Could not load file')
      })
      .finally(() => setFileLoading(false))

    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const submit = async () => {
    if (!id) return
    setPromoting(true)
    try {
      let templateId: string
      if (mode === 'existing') {
        if (!selectedId) { toast.error('Select a template first'); setPromoting(false); return }
        const { data } = await api.post(`/unknown-documents/${id}/promote-to-template`, { templateId: selectedId })
        templateId = data.templateId
        toast.success('Document added as sample — opening zone editor')
      } else {
        if (!newName.trim() || !newDocType) { toast.error('Template name and document type are required'); setPromoting(false); return }
        const { data } = await api.post(`/unknown-documents/${id}/create-template`, {
          name: newName.trim(), documentType: newDocType,
          description: newDescription || undefined,
          specificProvider: newProvider || undefined,
        })
        templateId = data.templateId
        toast.success('New classifier template created — opening zone editor')
      }
      navigate(`/settings/document-classifiers/${templateId}`)
    } catch (err: any) {
      toast.error('Failed', { description: err?.response?.data?.message || err.message })
      setPromoting(false)
    }
  }

  const isPdf = doc?.mimeType === 'application/pdf' || doc?.fileName?.endsWith('.pdf')

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => navigate('/unknown-documents')}>
          <ArrowLeft className="h-4 w-4" /> Unknown Docs
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <FileQuestion className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-medium truncate max-w-[40vw]">
          {docLoading ? '…' : doc?.fileName}
        </span>
        {doc?.status && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
            doc.status === 'template_created'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
              : doc.status === 'reviewed'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          }`}>
            {doc.status === 'template_created' ? 'Template Added' : doc.status === 'reviewed' ? 'Reviewed' : 'Pending Review'}
          </span>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: document viewer ─────────────────────────────────────── */}
        <div className="flex-1 bg-muted/30 overflow-hidden relative flex items-center justify-center border-r">
          {fileLoading ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading document…</p>
            </div>
          ) : fileMissing ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground text-center px-8">
              <AlertTriangle className="h-10 w-10 text-amber-400" />
              <p className="text-sm font-medium">File no longer on disk</p>
              <p className="text-xs">The source file was in a temporary folder that has been cleaned up.</p>
            </div>
          ) : blobUrl ? (
            isPdf ? (
              <iframe
                src={blobUrl}
                className="w-full h-full border-0"
                title="Document preview"
              />
            ) : (
              <img
                src={blobUrl}
                alt="Document preview"
                className="max-w-full max-h-full object-contain"
              />
            )
          ) : null}
        </div>

        {/* ── Right: classifier panel ───────────────────────────────────── */}
        <div className="w-96 shrink-0 flex flex-col overflow-y-auto bg-background">
          <div className="p-4 space-y-4">

            {/* Document info */}
            {doc?.classificationReason && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  <span className="font-semibold">Why unknown: </span>
                  {doc.classificationReason}
                </div>
              </div>
            )}

            {doc?.guessedType && (
              <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-3 py-2 flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                <div className="text-xs text-violet-800 dark:text-violet-200">
                  <span className="font-semibold">AI guess: </span>
                  {doc.guessedType}
                  {doc.guessedProvider && <span className="text-muted-foreground"> · {doc.guessedProvider}</span>}
                </div>
              </div>
            )}

            {/* Extracted fields */}
            {doc?.rawExtract && Object.keys(doc.rawExtract).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted fields</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(doc.rawExtract).filter(([, v]) => v).slice(0, 10).map(([k, v]) => (
                    <div key={k} className="rounded bg-muted/60 px-2 py-0.5 text-xs">
                      <span className="text-muted-foreground">{k}: </span>
                      <span className="font-mono font-medium">{v as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Classifier form */}
            <div>
              <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <PlusCircle className="h-4 w-4" /> Add to Classifier
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Assign this document to a classifier template. The file becomes the sample — then draw zones to teach the AI where each field lives.
              </p>

              {/* Mode selector */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setMode('existing')}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${mode === 'existing' ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'}`}
                >
                  <div className="text-xs font-medium mb-0.5">Existing template</div>
                  <div className="text-[10px] text-muted-foreground">Add to a template that already exists</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${mode === 'new' ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'}`}
                >
                  <div className="text-xs font-medium mb-0.5">New template</div>
                  <div className="text-[10px] text-muted-foreground">Create a brand-new classifier</div>
                </button>
              </div>

              {mode === 'existing' ? (
                <div className="space-y-2">
                  <Label className="text-xs">Template</Label>
                  {templatesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </div>
                  ) : (
                    <Select value={selectedId} onValueChange={setSelectedId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Choose a template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            <span className="font-medium">{t.name}</span>
                            {t.specificProvider && <span className="text-muted-foreground ml-1">· {t.specificProvider}</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    This document becomes the template's sample. Existing zones are preserved.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Template name <span className="text-red-500">*</span></Label>
                    <Input className="h-8 text-xs" placeholder="e.g. Nairobi Hospital Invoice"
                      value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Document type <span className="text-red-500">*</span></Label>
                    <Select value={newDocType} onValueChange={setNewDocType}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((dt) => (
                          <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Provider name</Label>
                    <Input className="h-8 text-xs" placeholder="e.g. Nairobi Hospital"
                      value={newProvider} onChange={(e) => setNewProvider(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Description</Label>
                    <Textarea rows={2} className="text-xs resize-none"
                      placeholder="What makes this document unique…"
                      value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky action bar */}
          <div className="mt-auto border-t p-4 bg-background">
            <Button className="w-full gap-2" onClick={submit} disabled={promoting || fileMissing}>
              {promoting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                : <><ExternalLink className="h-4 w-4" /> Save &amp; Open Zone Editor</>
              }
            </Button>
            {doc?.status === 'template_created' && (
              <p className="text-xs text-center text-emerald-600 dark:text-emerald-400 mt-2 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Already linked to a template
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
