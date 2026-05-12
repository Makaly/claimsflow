import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus,
  Pencil,
  Trash2,
  ScanSearch,
  FileText,
  Layers,
  UploadCloud,
  Loader2,
  AlertCircle,
  Merge,
  CheckSquare,
  Square,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface OcrTemplate {
  id: string
  name: string
  documentType: string
  description: string | null
  providerType: string | null
  specificProvider: string | null
  sampleFileName: string | null
  accuracy: number | null
  usageCount: number
  isActive: boolean
  zoneCount: number
  createdAt: string
}

const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'inpatient_invoice', label: 'Inpatient Invoice' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab_result', label: 'Lab Result' },
  { value: 'medical_report', label: 'Medical Report' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'claim_form', label: 'Claim Form' },
  { value: 'authorization_letter', label: 'Authorization Letter' },
  { value: 'other', label: 'Other' },
]

const PROVIDER_TYPES = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'lab', label: 'Laboratory' },
]

function docTypeColor(dt: string): string {
  const map: Record<string, string> = {
    invoice: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    inpatient_invoice: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    prescription: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    lab_result: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    medical_report: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    discharge_summary: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    claim_form: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    authorization_letter: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }
  return map[dt] || map['other']
}

// ── New Template Dialog ────────────────────────────────────────────────────────

interface NewTemplateDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

function NewTemplateDialog({ open, onClose, onCreated }: NewTemplateDialogProps) {
  const [name, setName] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [description, setDescription] = useState('')
  const [providerType, setProviderType] = useState('')
  const [specificProvider, setSpecificProvider] = useState('')
  const [sampleFile, setSampleFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDocumentType('')
    setDescription('')
    setProviderType('')
    setSpecificProvider('')
    setSampleFile(null)
    setError(null)
    setSubmitting(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = async () => {
    if (!name.trim() || !documentType) {
      setError('Name and document type are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('name', name.trim())
      form.append('documentType', documentType)
      if (description) form.append('description', description)
      if (providerType) form.append('providerType', providerType)
      if (specificProvider) form.append('specificProvider', specificProvider)
      if (sampleFile) form.append('file', sampleFile)

      await api.post('/document-classifiers', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      reset()
      onCreated()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create template')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Document Classifier Template</DialogTitle>
          <DialogDescription>
            Define a template for a document type. Then draw zones on the sample document to teach the AI where to find each field.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Template Name <span className="text-red-500">*</span></Label>
            <Input
              placeholder="e.g. Aga Khan Hospital Invoice"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label>Document Type <span className="text-red-500">*</span></Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider Type</Label>
              <Select value={providerType} onValueChange={setProviderType}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {PROVIDER_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Specific Provider</Label>
            <Input
              placeholder="e.g. Aga Khan University Hospital"
              value={specificProvider}
              onChange={(e) => setSpecificProvider(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Used by AI to match documents from this exact provider</p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe what makes this document unique, e.g. 'Aga Khan invoice with AK member number in top-right corner'"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Sample Document (optional)</Label>
            <div className="flex items-center gap-3">
              <label className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2 rounded-md border border-dashed border-input p-3 hover:bg-muted/50 transition-colors">
                  <UploadCloud className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {sampleFile ? sampleFile.name : 'Click to upload PDF or image'}
                  </span>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setSampleFile(e.target.files?.[0] || null)}
                />
              </label>
              {sampleFile && (
                <Button variant="ghost" size="sm" onClick={() => setSampleFile(null)}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Upload a sample document to draw zones on later</p>
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function DocumentClassifiersTab() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<OcrTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Multi-select + merge state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [mergeOutputName, setMergeOutputName] = useState('merged_samples.pdf')
  const [mergingDocs, setMergingDocs] = useState(false)

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const executeMerge = async () => {
    setMergingDocs(true)
    try {
      const res = await api.post('/document-classifiers/merge-samples', {
        templateIds: [...selectedIds],
        outputName: mergeOutputName,
      })
      toast.success(`Merged ${res.data.mergedCount} sample(s) — document created in Documents`)
      setShowMergeDialog(false)
      setSelectedIds(new Set())
    } catch (err: any) {
      toast.error(`Merge failed: ${err?.response?.data?.message || err?.message}`)
    } finally {
      setMergingDocs(false)
    }
  }

  const loadTemplates = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<OcrTemplate[]>('/document-classifiers')
      setTemplates(data)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete classifier "${name}"? This cannot be undone.`)) return
    setDeletingId(id)
    try {
      await api.delete(`/document-classifiers/${id}`)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete template')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ScanSearch className="h-5 w-5" />
            Document Classifiers
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Train the AI to recognize document types by uploading samples and drawing field zones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size >= 2 && (
            <Button variant="outline" className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
              onClick={() => setShowMergeDialog(true)}>
              <Merge className="h-4 w-4" />
              Merge Samples ({selectedIds.size})
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground"
              onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          )}
          <Button onClick={() => setShowNewDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      <Separator />

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={loadTemplates}>Retry</Button>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ScanSearch className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-base font-medium">No classifiers yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Create your first document classifier template to teach the AI how to read specific document types.
          </p>
          <Button className="mt-4 gap-2" onClick={() => setShowNewDialog(true)}>
            <Plus className="h-4 w-4" /> New Template
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className={`relative transition-shadow ${selectedIds.has(t.id) ? 'ring-2 ring-violet-400 shadow-md' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Checkbox
                      checked={selectedIds.has(t.id)}
                      onCheckedChange={() => toggleSelect(t.id)}
                      className="mt-0.5 shrink-0"
                      title="Select for merge"
                    />
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{t.name}</CardTitle>
                      {t.specificProvider && (
                        <CardDescription className="truncate">{t.specificProvider}</CardDescription>
                      )}
                    </div>
                  </div>
                  <Badge className={`shrink-0 text-xs ${docTypeColor(t.documentType)}`}>
                    {DOCUMENT_TYPES.find((d) => d.value === t.documentType)?.label || t.documentType}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {t.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5" />
                    {t.zoneCount} zone{t.zoneCount !== 1 ? 's' : ''}
                  </span>
                  {t.sampleFileName && (
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      Sample
                    </span>
                  )}
                  {t.accuracy != null && (
                    <span className="flex items-center gap-1">
                      {(t.accuracy * 100).toFixed(0)}% accuracy
                    </span>
                  )}
                  {t.usageCount > 0 && (
                    <span>{t.usageCount} use{t.usageCount !== 1 ? 's' : ''}</span>
                  )}
                </div>

                <Separator />

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => navigate(`/settings/document-classifiers/${t.id}`)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Zones
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    disabled={deletingId === t.id}
                    onClick={() => handleDelete(t.id, t.name)}
                  >
                    {deletingId === t.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewTemplateDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={() => {
          setShowNewDialog(false)
          loadTemplates()
        }}
      />

      {/* Merge dialog */}
      <Dialog open={showMergeDialog} onOpenChange={(o) => !o && setShowMergeDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="h-4 w-4" />
              Merge {selectedIds.size} Sample Documents
            </DialogTitle>
            <DialogDescription>
              The sample files from the selected classifier templates will be merged into a single PDF document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Output File Name</Label>
              <Input
                value={mergeOutputName}
                onChange={(e) => setMergeOutputName(e.target.value)}
                placeholder="merged_samples.pdf"
              />
            </div>
            <div className="rounded-lg bg-muted/50 border p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Templates to merge:</p>
              {templates.filter(t => selectedIds.has(t.id)).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{t.name}</span>
                  {t.sampleFileName && <span className="text-muted-foreground">— {t.sampleFileName}</span>}
                  {!t.sampleFileName && <span className="text-amber-600">No sample file</span>}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>Cancel</Button>
            <Button onClick={executeMerge} disabled={mergingDocs} className="gap-1.5">
              {mergingDocs ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Merging…</>
              ) : (
                <><Merge className="h-3.5 w-3.5" />Merge Documents</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
