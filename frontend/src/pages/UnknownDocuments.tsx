import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertTriangle, FileQuestion, Loader2, RefreshCw,
  CheckCircle2, ExternalLink, Eye, Sparkles, PlusCircle, Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/services/api'

interface UnknownDoc {
  id: string
  fileName: string
  mimeType: string
  guessedType: string | null
  guessedProvider: string | null
  rawExtract: Record<string, string> | null
  status: 'pending' | 'reviewed' | 'template_created'
  reviewedBy: string | null
  reviewedAt: string | null
  notes: string | null
  classificationReason: string | null
  createdAt: string
}

interface TemplateOption {
  id: string
  name: string
  documentType: string
  specificProvider: string | null
}

const DOCUMENT_TYPES = [
  { value: 'invoice',              label: 'Invoice' },
  { value: 'inpatient_invoice',    label: 'Inpatient Invoice' },
  { value: 'prescription',        label: 'Prescription' },
  { value: 'lab_result',          label: 'Lab Result' },
  { value: 'medical_report',      label: 'Medical Report' },
  { value: 'discharge_summary',   label: 'Discharge Summary' },
  { value: 'claim_form',          label: 'Claim Form' },
  { value: 'authorization_letter', label: 'Authorization Letter' },
  { value: 'other',               label: 'Other' },
]

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:          { label: 'Pending Review', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  reviewed:         { label: 'Reviewed',       color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'  },
  template_created: { label: 'Template Added', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
}

export default function UnknownDocuments() {
  const navigate = useNavigate()
  const [docs, setDocs]         = useState<UnknownDoc[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage]         = useState(1)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [notes, setNotes]       = useState('')
  const limit = 15

  // Add-to-classifier dialog state
  const [classifierDoc, setClassifierDoc]       = useState<UnknownDoc | null>(null)
  const [classifierMode, setClassifierMode]     = useState<'existing' | 'new'>('existing')
  const [templates, setTemplates]               = useState<TemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [newName, setNewName]                   = useState('')
  const [newDocType, setNewDocType]             = useState('')
  const [newDescription, setNewDescription]     = useState('')
  const [newProvider, setNewProvider]           = useState('')
  const [promoting, setPromoting]               = useState(false)

  const [openingEditorId, setOpeningEditorId] = useState<string | null>(null)

  const openInZoneEditor = async (docId: string) => {
    setOpeningEditorId(docId)
    try {
      const { data } = await api.post(`/unknown-documents/${docId}/ensure-draft-template`)
      navigate(`/settings/document-classifiers/${data.templateId}?from=unknown-docs`)
    } catch (err: any) {
      toast.error('Could not open zone editor', { description: err?.response?.data?.message || err.message })
    } finally {
      setOpeningEditorId(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/unknown-documents', {
        params: { status: statusFilter || undefined, page, limit },
      })
      setDocs(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

  useEffect(() => { load() }, [load])

  const markReviewed = async (id: string) => {
    await api.patch(`/unknown-documents/${id}/review`, { notes })
    setReviewingId(null)
    setNotes('')
    load()
  }

  const openAddToClassifier = async (doc: UnknownDoc) => {
    setClassifierDoc(doc)
    setClassifierMode('existing')
    setSelectedTemplateId('')
    setNewName(doc.guessedProvider || '')
    setNewDocType('')
    setNewDescription('')
    setNewProvider(doc.guessedProvider || '')
    setTemplatesLoading(true)
    try {
      const { data } = await api.get<TemplateOption[]>('/document-classifiers')
      setTemplates(data)
    } catch {
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }

  const submitAddToClassifier = async () => {
    if (!classifierDoc) return
    setPromoting(true)
    try {
      let templateId: string
      if (classifierMode === 'existing') {
        if (!selectedTemplateId) { toast.error('Select a template first'); return }
        const { data } = await api.post(`/unknown-documents/${classifierDoc.id}/promote-to-template`, { templateId: selectedTemplateId })
        templateId = data.templateId
        toast.success('Document added as sample to template')
      } else {
        if (!newName.trim() || !newDocType) { toast.error('Template name and document type are required'); return }
        const { data } = await api.post(`/unknown-documents/${classifierDoc.id}/create-template`, {
          name: newName.trim(), documentType: newDocType,
          description: newDescription || undefined,
          specificProvider: newProvider || undefined,
        })
        templateId = data.templateId
        toast.success('New classifier template created')
      }
      setClassifierDoc(null)
      load()
      navigate(`/settings/document-classifiers/${templateId}`)
    } catch (err: any) {
      toast.error('Failed', { description: err?.response?.data?.message || err.message })
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileQuestion className="h-6 w-6 text-amber-500" />
            Unknown Documents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Documents uploaded that didn't match any classifier template. Review and create templates for them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending Review</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="template_created">Template Created</SelectItem>
            <SelectItem value="">All Statuses</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{total} document{total !== 1 ? 's' : ''}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">No unknown documents{statusFilter === 'pending' ? ' pending review' : ''}</p>
          <p className="text-xs mt-1">All uploaded documents matched existing classifier templates.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const st = STATUS_LABELS[doc.status] || STATUS_LABELS.pending
            const isReviewing = reviewingId === doc.id
            const fields = doc.rawExtract ? Object.entries(doc.rawExtract).filter(([, v]) => v) : []

            return (
              <div key={doc.id} className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
                {/* Row 1: filename + status */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="font-semibold text-sm truncate">{doc.fileName}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Uploaded {new Date(doc.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                      onClick={() => navigate(`/unknown-documents/${doc.id}`)}>
                      <Eye className="h-3.5 w-3.5" /> View File
                    </Button>
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                      disabled={openingEditorId === doc.id}
                      onClick={() => openInZoneEditor(doc.id)}>
                      {openingEditorId === doc.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Wand2 className="h-3.5 w-3.5" />}
                      {openingEditorId === doc.id ? 'Opening…' : 'Open in Zone Editor'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                      onClick={() => openAddToClassifier(doc)}>
                      <PlusCircle className="h-3.5 w-3.5" /> Add to Classifier
                    </Button>
                    {doc.status === 'pending' && (
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1.5"
                        onClick={() => setReviewingId(isReviewing ? null : doc.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isReviewing ? 'Cancel' : 'Mark Reviewed'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Classification reason */}
                {doc.classificationReason && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs text-amber-800 dark:text-amber-200">
                      <span className="font-semibold">Why unknown: </span>
                      {doc.classificationReason}
                    </div>
                  </div>
                )}

                {/* AI guess */}
                {(doc.guessedType || doc.guessedProvider) && (
                  <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-3 py-2 flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs text-violet-800 dark:text-violet-200">
                      <span className="font-semibold">AI Analysis: </span>
                      {doc.guessedType && <span>{doc.guessedType}</span>}
                      {doc.guessedProvider && <span className="text-muted-foreground"> · {doc.guessedProvider}</span>}
                    </div>
                  </div>
                )}

                {/* Extracted fields (best effort) */}
                {fields.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {fields.slice(0, 8).map(([k, v]) => (
                      <div key={k} className="rounded-md bg-muted/60 px-2 py-1 text-xs">
                        <span className="text-muted-foreground">{k}: </span>
                        <span className="font-mono font-medium">{v}</span>
                      </div>
                    ))}
                    {fields.length > 8 && (
                      <span className="text-xs text-muted-foreground self-center">+{fields.length - 8} more</span>
                    )}
                  </div>
                )}

                {/* Mark reviewed form */}
                {isReviewing && (
                  <div className="rounded-lg border bg-background p-3 space-y-2">
                    <Input
                      className="h-8 text-xs" placeholder="Optional notes (what kind of document is it?)"
                      value={notes} onChange={(e) => setNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => markReviewed(doc.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Review
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / limit)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / limit)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {/* Add to Classifier dialog */}
      <Dialog open={!!classifierDoc} onOpenChange={(v) => !v && setClassifierDoc(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" />
              Add to Classifier
            </DialogTitle>
            <DialogDescription>
              Use <span className="font-medium text-foreground">{classifierDoc?.fileName}</span> as the
              sample document for a classifier template. Then draw zones to teach the AI where each field lives.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-1">
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setClassifierMode('existing')}
                className={`rounded-lg border p-3 text-left text-sm transition-colors ${classifierMode === 'existing' ? 'border-primary bg-primary/5 font-medium' : 'border-input hover:bg-muted/50'}`}
              >
                <div className="font-medium text-xs mb-0.5">Existing template</div>
                <div className="text-xs text-muted-foreground">Add as sample to a template that already exists</div>
              </button>
              <button
                type="button"
                onClick={() => setClassifierMode('new')}
                className={`rounded-lg border p-3 text-left text-sm transition-colors ${classifierMode === 'new' ? 'border-primary bg-primary/5 font-medium' : 'border-input hover:bg-muted/50'}`}
              >
                <div className="font-medium text-xs mb-0.5">New template</div>
                <div className="text-xs text-muted-foreground">Create a brand-new classifier from this document</div>
              </button>
            </div>

            {classifierMode === 'existing' ? (
              <div className="space-y-2">
                <Label>Select template</Label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
                  </div>
                ) : (
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger>
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
                <p className="text-xs text-muted-foreground">
                  The document file will replace the template's current sample. Existing zones are preserved.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Template name <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="e.g. Nairobi Hospital Invoice"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Document type <span className="text-red-500">*</span></Label>
                  <Select value={newDocType} onValueChange={setNewDocType}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((dt) => (
                        <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Provider name</Label>
                  <Input
                    placeholder="e.g. Nairobi Hospital"
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    placeholder="Describe what makes this document unique…"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setClassifierDoc(null)} disabled={promoting}>Cancel</Button>
            <Button onClick={submitAddToClassifier} disabled={promoting} className="gap-1.5">
              {promoting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                : <><ExternalLink className="h-3.5 w-3.5" /> Save &amp; Open Zone Editor</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
