/**
 * DocumentClassifierEditor — Zone editor for a document classifier template.
 * Left panel: PDF/image viewer with zoom + drawing overlay.
 * Right panel: Zone list with add-zone form (incl. search phrase saved to DB).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft, Plus, Trash2, Loader2, AlertCircle, MousePointer2,
  Square, Save, X as XIcon, CheckCircle2, FileText,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  Search, Eye, Hand, ScanText, Copy, Sparkles, CheckCheck,
  ShieldAlert, Info, Pencil, ChevronDown, MapPin,
  BookOpen, GitBranch, Clock, User2, ChevronsRight,
  Scissors, Tag, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DocumentZone {
  id: string
  templateId: string
  fieldName: string
  fieldLabel: string
  description: string | null
  locationContext: string | null
  searchPhrase: string | null
  claimField: string | null
  pageNumber: number | null
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  parentZoneId: string | null
  updatedAt: string | null
  updatedByName: string | null
  createdAt: string
}

// Claim form fields that a zone value can populate
const CLAIM_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: 'patientName',    label: 'Patient Full Name' },
  { value: 'patientId',      label: 'Patient ID' },
  { value: 'memberNumber',   label: 'Member / AK Number' },
  { value: 'invoiceNumber',  label: 'Invoice Number' },
  { value: 'invoiceDate',    label: 'Invoice Date' },
  { value: 'invoiceAmount',  label: 'Invoice Total Amount' },
  { value: 'providerName',   label: 'Provider Name' },
  { value: 'providerBranch', label: 'Provider Branch' },
  { value: 'dateOfService',  label: 'Service / Discharge Date' },
  { value: 'admissionDate',  label: 'Admission Date' },
  { value: 'diagnosis',      label: 'Diagnosis' },
  { value: 'diagnosisCode',  label: 'Diagnosis / ICD Code' },
  { value: 'treatment',      label: 'Treatment' },
  { value: 'procedureCode',  label: 'Procedure Code' },
  { value: 'policyNumber',   label: 'Policy Number' },
  { value: 'sponsorCoverage',label: 'Sponsor Coverage Amount' },
  { value: 'patientPayable', label: 'Patient Payable Amount' },
  { value: 'nhifNumber',     label: 'NHIF Notification Number' },
  { value: 'gender',         label: 'Patient Gender' },
]

// Implicit default mapping from zone fieldName → claimField
const DEFAULT_CLAIM_FIELD: Record<string, string> = {
  patient_name:             'patientName',
  patient_id:               'patientId',
  membership_number:        'memberNumber',
  ak_number:                'memberNumber',
  account_name:             'memberNumber',
  invoice_number:           'invoiceNumber',
  invoice_date:             'invoiceDate',
  invoice_amount:           'invoiceAmount',
  total_billed:             'invoiceAmount',
  provider_name:            'providerName',
  provider_branch:          'providerBranch',
  diagnosis:                'diagnosis',
  diagnosis_code:           'diagnosisCode',
  treatment:                'treatment',
  service_date:             'dateOfService',
  admission_date:           'admissionDate',
  discharge_date:           'dateOfService',
  sponsor_coverage:         'sponsorCoverage',
  patient_payable:          'patientPayable',
  policy_number:            'policyNumber',
  nhif_notification_number: 'nhifNumber',
  gender:                   'gender',
}

interface OcrTemplate {
  id: string
  name: string
  documentType: string
  description: string | null
  providerType: string | null
  specificProvider: string | null
  sampleFilePath: string | null
  sampleFileName: string | null
  isActive: boolean
  zones: DocumentZone[]
}

// ── Standard field definitions ────────────────────────────────────────────────

const STANDARD_FIELDS: { value: string; label: string }[] = [
  { value: 'patient_name',      label: 'Patient Name' },
  { value: 'patient_id',        label: 'Patient ID' },
  { value: 'invoice_number',    label: 'Invoice Number' },
  { value: 'invoice_date',      label: 'Invoice Date' },
  { value: 'invoice_amount',    label: 'Invoice Amount' },
  { value: 'total_billed',      label: 'Total Billed Amount' },
  { value: 'sponsor_coverage',  label: 'Sponsor Coverage Amount' },
  { value: 'patient_payable',   label: 'Patient Payable Amount' },
  { value: 'membership_number', label: 'Membership Number' },
  { value: 'provider_name',     label: 'Provider Name' },
  { value: 'provider_branch',   label: 'Provider Branch / Location' },
  { value: 'diagnosis',         label: 'Diagnosis' },
  { value: 'diagnosis_code',    label: 'Diagnosis Code' },
  { value: 'treatment',         label: 'Treatment' },
  { value: 'service_date',      label: 'Service Date' },
  { value: 'insurance_company', label: 'Insurance Company' },
  { value: 'account_name',      label: 'Account Name' },
  { value: 'admission_date',    label: 'Admission Date' },
  { value: 'discharge_date',    label: 'Discharge Date' },
]

// ── Zone colour palette ───────────────────────────────────────────────────────

const ZONE_COLORS: Record<string, { bg: string; border: string }> = {
  patient_name:       { bg: 'rgba(59,130,246,0.18)',  border: '#3b82f6' },
  patient_id:         { bg: 'rgba(59,130,246,0.14)',  border: '#60a5fa' },
  invoice_number:     { bg: 'rgba(16,185,129,0.18)',  border: '#10b981' },
  invoice_date:       { bg: 'rgba(245,158,11,0.18)',  border: '#f59e0b' },
  invoice_amount:     { bg: 'rgba(239,68,68,0.18)',   border: '#ef4444' },
  membership_number:  { bg: 'rgba(139,92,246,0.18)',  border: '#8b5cf6' },
  provider_name:      { bg: 'rgba(236,72,153,0.18)',  border: '#ec4899' },
  diagnosis:          { bg: 'rgba(20,184,166,0.18)',  border: '#14b8a6' },
  diagnosis_code:     { bg: 'rgba(99,102,241,0.18)',  border: '#6366f1' },
  treatment:          { bg: 'rgba(249,115,22,0.18)',  border: '#f97316' },
  service_date:       { bg: 'rgba(234,179,8,0.18)',   border: '#eab308' },
  insurance_company:  { bg: 'rgba(168,85,247,0.18)',  border: '#a855f7' },
  account_name:       { bg: 'rgba(34,197,94,0.18)',   border: '#22c55e' },
  total_billed:       { bg: 'rgba(239,68,68,0.18)',   border: '#ef4444' },
  provider_branch:    { bg: 'rgba(236,72,153,0.18)',  border: '#ec4899' },
  sponsor_coverage:   { bg: 'rgba(16,185,129,0.18)',  border: '#10b981' },
  patient_payable:    { bg: 'rgba(245,158,11,0.18)',  border: '#f59e0b' },
  admission_date:     { bg: 'rgba(99,102,241,0.18)',  border: '#6366f1' },
  discharge_date:     { bg: 'rgba(234,179,8,0.18)',   border: '#eab308' },
  default:            { bg: 'rgba(107,114,128,0.18)', border: '#6b7280' },
}

function zoneColor(fieldName: string) {
  return ZONE_COLORS[fieldName] || ZONE_COLORS['default']
}

interface SuggestedZone {
  fieldName: string
  fieldLabel: string
  description: string
  searchPhrase: string
  extractedValue?: string
  pageNumber?: number
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  confidence: number
}

interface OcrResult {
  text: string
  confidence: number
  reasoning: string
}

// ── Draw state ────────────────────────────────────────────────────────────────

interface DrawRect {
  startX: number; startY: number; currentX: number; currentY: number
}

interface PendingZone {
  xPercent: number; yPercent: number; widthPercent: number; heightPercent: number; pageNumber: number
}

// ── Zone Save Form (shown in right panel) ─────────────────────────────────────

interface ZoneSaveFormProps {
  pending: PendingZone
  existingFields: string[]
  existingZones: { id: string; fieldLabel: string }[]
  initialParentZoneId?: string | null
  onSave: (data: {
    fieldName: string; fieldLabel: string; description: string
    searchPhrase: string; locationContext: string; parentZoneId: string | null
  }) => Promise<void>
  onCancel: () => void
}

function ZoneSaveForm({ pending, existingFields, existingZones, initialParentZoneId, onSave, onCancel }: ZoneSaveFormProps) {
  const [fieldName, setFieldName]           = useState('')
  const [fieldLabel, setFieldLabel]         = useState('')
  const [description, setDescription]       = useState('')
  const [searchPhrase, setSearchPhrase]     = useState('')
  const [locationContext, setLocationContext] = useState('')
  const [parentZoneId, setParentZoneId]     = useState<string | null>(initialParentZoneId ?? null)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  const handleFieldSelect = (value: string) => {
    setFieldName(value)
    const std = STANDARD_FIELDS.find((f) => f.value === value)
    if (std) setFieldLabel(std.label)
  }

  const handleSave = async () => {
    if (!fieldName || !fieldLabel) { setError('Field name and label are required.'); return }
    setSaving(true); setError(null)
    try {
      await onSave({ fieldName, fieldLabel, description, searchPhrase, locationContext, parentZoneId })
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save zone')
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`h-2 w-2 rounded-full animate-pulse shrink-0 ${initialParentZoneId ? 'bg-violet-500' : 'bg-indigo-500'}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {initialParentZoneId ? 'Define Sub-Zone' : 'Define New Zone'}
            </p>
            {initialParentZoneId && (() => {
              const parentLabel = existingZones.find((z) => z.id === initialParentZoneId)?.fieldLabel
              return parentLabel ? (
                <p className="text-[10px] text-violet-600 dark:text-violet-400 flex items-center gap-1 mt-0.5">
                  <GitBranch className="h-2.5 w-2.5 shrink-0" />
                  Child of <span className="font-semibold">{parentLabel}</span>
                </p>
              ) : null
            })()}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onCancel}>
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Zone position summary */}
      <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground font-mono flex items-center gap-2 flex-wrap">
        <span className="text-foreground font-semibold">pg {pending.pageNumber}</span>
        <span>x:{pending.xPercent.toFixed(1)}% y:{pending.yPercent.toFixed(1)}%</span>
        <span>{pending.widthPercent.toFixed(1)}×{pending.heightPercent.toFixed(1)}%</span>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </p>
      )}

      {/* Field selector */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Field Type <span className="text-destructive">*</span></Label>
        <Select value={fieldName} onValueChange={handleFieldSelect}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select field type…" />
          </SelectTrigger>
          <SelectContent>
            {STANDARD_FIELDS.map((f) => (
              <SelectItem key={f.value} value={f.value}
                className={existingFields.includes(f.value) ? 'opacity-50' : ''}>
                {f.label}{existingFields.includes(f.value) ? ' (already defined)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Display Label <span className="text-destructive">*</span></Label>
        <Input className="h-8 text-xs" placeholder="e.g. Patient Name"
          value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} />
      </div>

      {/* Parent zone — locked when entering via "Add sub-zone", optional picker only for top-level new zones */}
      {initialParentZoneId ? (
        // Already set by context — show as a read-only badge, no picker
        <div className="flex items-center gap-1.5 rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-2.5 py-1.5">
          <GitBranch className="h-3 w-3 text-violet-500 shrink-0" />
          <span className="text-[11px] text-violet-700 dark:text-violet-300">
            Nested under <span className="font-semibold">{existingZones.find((z) => z.id === initialParentZoneId)?.fieldLabel ?? 'parent zone'}</span>
          </span>
        </div>
      ) : existingZones.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <GitBranch className="h-3 w-3 text-indigo-500" />
            Parent Zone <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Select value={parentZoneId ?? '__none__'} onValueChange={(v) => setParentZoneId(v === '__none__' ? null : v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="— top-level zone —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">— top-level zone —</SelectItem>
              {existingZones.map((z) => (
                <SelectItem key={z.id} value={z.id} className="text-xs">{z.fieldLabel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">Nest this zone under a broader section zone for hierarchical extraction.</p>
        </div>
      )}

      {/* Search phrase */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Search className="h-3 w-3 text-violet-500" />
          Search Phrase / Pattern
        </Label>
        <Input className="h-8 text-xs font-mono"
          placeholder='e.g. "Invoice No:" or regex: \d{6,}'
          value={searchPhrase} onChange={(e) => setSearchPhrase(e.target.value)} />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Text/regex the OCR engine uses to locate this field. Leave blank to use coordinates only.
        </p>
      </div>

      {/* Location context */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <BookOpen className="h-3 w-3 text-amber-500" />
          Location Context
        </Label>
        <Textarea className="text-xs min-h-0 resize-none" rows={2}
          placeholder="e.g. In Aga Khan invoices, look for 'Sponsor Coverage:' in the billing summary table at the bottom of the last page."
          value={locationContext} onChange={(e) => setLocationContext(e.target.value)} />
        <p className="text-[10px] text-muted-foreground">Human-readable guide for finding this field in real documents.</p>
      </div>

      {/* AI hint */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">AI Extraction Hint</Label>
        <Textarea className="text-xs min-h-0 resize-none" rows={2}
          placeholder='e.g. "Handwritten value after the Patient: label"'
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleSave} disabled={saving}>
          {saving
            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save Zone
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DocumentClassifierEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromUnknownDocs = searchParams.get('from') === 'unknown-docs'

  const [template, setTemplate]     = useState<OcrTemplate | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState<string | null>(null)

  // PDF rendering
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const overlayRef    = useRef<HTMLDivElement>(null)
  const viewerRef     = useRef<HTMLDivElement>(null)
  const [pdfDoc, setPdfDoc]         = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount]   = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError]     = useState<string | null>(null)
  const renderTaskRef   = useRef<pdfjsLib.RenderTask | null>(null)
  const loadedImageRef   = useRef<HTMLImageElement | null>(null)
  const pendingScrollRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [zoom, setZoom]             = useState(1)          // 1 = fit-to-width

  // Zone drawing
  const [toolMode, setToolMode]     = useState<'pan' | 'draw'>('pan')
  const [isDrawing, setIsDrawing]   = useState(false)
  const [drawRect, setDrawRect]     = useState<DrawRect | null>(null)
  const [pendingZone, setPendingZone] = useState<PendingZone | null>(null)
  const [highlightedZoneId, setHighlightedZoneId] = useState<string | null>(null)
  const [pinnedZoneId, setPinnedZoneId]           = useState<string | null>(null)

  // Pan/drag
  const [isPanning, setIsPanning]   = useState(false)
  const panStartRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)

  // Zone operations
  const [deletingZoneId, setDeletingZoneId]       = useState<string | null>(null)
  const [pendingParentZoneId, setPendingParentZoneId] = useState<string | null>(null)

  // Claim-field mapping save state (per zone)
  const [savingClaimField, setSavingClaimField] = useState<Record<string, boolean>>({})
  const [savedClaimField,  setSavedClaimField]  = useState<Record<string, boolean>>({})

  // Zone OCR
  const [ocrResults, setOcrResults]   = useState<Record<string, OcrResult>>({})
  const [ocrLoading, setOcrLoading]   = useState<Record<string, boolean>>({})

  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})


  // Auto-suggest
  const [suggestions, setSuggestions]       = useState<SuggestedZone[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [dismissedSugg, setDismissedSugg]   = useState<Set<number>>(new Set())
  const [hoveredSuggIdx, setHoveredSuggIdx] = useState<number | null>(null)
  const [pinnedSuggIdx, setPinnedSuggIdx]   = useState<number | null>(null)
  const [adjustingIdx, setAdjustingIdx]         = useState<number | null>(null)
  const [adjustingZoneId, setAdjustingZoneId]   = useState<string | null>(null)

  const [collapsedZones, setCollapsedZones]         = useState<Set<string>>(new Set())
  const [collapsedSubzones, setCollapsedSubzones]   = useState<Set<string>>(new Set())

  // ── Split state ──────────────────────────────────────────────────────────────
  const [splitDialogOpen, setSplitDialogOpen]   = useState(false)
  const [splitRanges, setSplitRanges]           = useState<Array<{ start: number; end: number; name: string; documentType?: string }>>([])
  const [analyzingPages, setAnalyzingPages]     = useState(false)
  const [analysisDone, setAnalysisDone]         = useState(false)
  const [splittingDocs, setSplittingDocs]       = useState(false)
  const [thumbnails, setThumbnails]             = useState<string[]>([])
  const [thumbsLoading, setThumbsLoading]       = useState(false)
  const [splitResult, setSplitResult]           = useState<Array<{ id: string; originalName: string; documentType: string | null }> | null>(null)
  const [openingEditorForDoc, setOpeningEditorForDoc] = useState<string | null>(null)

  const SEGMENT_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#6366f1']

  const generateThumbnails = async (doc: pdfjsLib.PDFDocumentProxy, total: number) => {
    setThumbsLoading(true)
    setThumbnails([])
    const thumbs: string[] = []
    for (let p = 1; p <= total; p++) {
      try {
        const page = await doc.getPage(p)
        const viewport = page.getViewport({ scale: 0.13 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
        thumbs.push(canvas.toDataURL('image/jpeg', 0.75))
      } catch {
        thumbs.push('')
      }
    }
    setThumbnails(thumbs)
    setThumbsLoading(false)
  }

  const getPageSegmentIdx = (page: number) =>
    splitRanges.findIndex(r => r.start <= page && page <= r.end)

  const handleAnalyzePages = async () => {
    if (!id) return
    setAnalyzingPages(true)
    setAnalysisDone(false)
    try {
      const res = await api.post(`/document-classifiers/${id}/analyze-pages`)
      const { segments, totalPages } = res.data
      if (segments?.length > 0) {
        setSplitRanges(segments.map((s: any) => ({
          start: s.start,
          end: s.end,
          name: s.label?.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || `part_${s.start}`,
          documentType: s.documentType,
        })))
        setAnalysisDone(true)
        toast.success(`AI identified ${segments.length} section(s) across ${totalPages} pages`)
      }
    } catch (err: any) {
      toast.error(`Analysis failed: ${err?.response?.data?.message || err?.message}`)
    } finally {
      setAnalyzingPages(false)
    }
  }

  const handleSplitSample = async () => {
    if (!id || splitRanges.length === 0) return
    setSplittingDocs(true)
    try {
      const res = await api.post(`/document-classifiers/${id}/split-sample`, { pageRanges: splitRanges })
      const docs = res.data.documents ?? []
      setSplitResult(docs)
      setAnalysisDone(false)
    } catch (err: any) {
      toast.error(`Split failed: ${err?.response?.data?.message || err?.message}`)
    } finally {
      setSplittingDocs(false)
    }
  }

  const closeSplitDialog = () => {
    setSplitDialogOpen(false)
    setAnalysisDone(false)
    setSplitResult(null)
  }

  const toggleZoneCollapse = (id: string) =>
    setCollapsedZones((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSubzoneCollapse = (id: string) =>
    setCollapsedSubzones((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const collapseAll = () => setCollapsedZones(new Set(template?.zones.map((z) => z.id) ?? []))
  const expandAll   = () => setCollapsedZones(new Set())

  // ── Load template ──────────────────────────────────────────────────────────

  const loadTemplate = useCallback(async () => {
    if (!id) return
    setLoading(true); setLoadError(null)
    try {
      const { data } = await api.get<OcrTemplate>(`/document-classifiers/${id}`)
      setTemplate(data)
    } catch (err: any) {
      setLoadError(err?.response?.data?.message || 'Failed to load template')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadTemplate() }, [loadTemplate])

  // ── Load PDF/image (with auth header) ─────────────────────────────────────

  const renderPdfPage = useCallback(
    async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, zoomLevel = 1) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null }
      const page = await doc.getPage(pageNum)
      // Use the scroll viewport (grandparent) — it has a stable flex-determined width.
      // canvas.parentElement is inline-block and grows with the canvas, causing a zoom feedback loop.
      const scrollViewport = canvas.parentElement?.parentElement
      const containerWidth = (scrollViewport?.clientWidth || 700) - 32   // account for p-4
      const viewport = page.getViewport({ scale: 1 })
      const fitScale = containerWidth / viewport.width
      const scaled = page.getViewport({ scale: fitScale * zoomLevel })
      canvas.width  = scaled.width
      canvas.height = scaled.height
      const ctx = canvas.getContext('2d')!
      renderTaskRef.current = page.render({ canvasContext: ctx, viewport: scaled })
      try { await renderTaskRef.current.promise } catch (_) { /* cancelled */ }
    },
    [],
  )

  const loadSampleDoc = useCallback(async () => {
    if (!template?.sampleFilePath) return
    setPdfLoading(true); setPdfError(null)
    try {
      const { data: arrayBuffer, headers: resHeaders } = await api.get(
        `/document-classifiers/${id}/sample`,
        { responseType: 'arraybuffer' },
      )
      const contentType = String(resHeaders['content-type'] || '')
      const isImage = template.sampleFileName
        ? /\.(jpe?g|png)$/i.test(template.sampleFileName)
        : contentType.startsWith('image/')

      if (isImage) {
        loadedImageRef.current = null
        const blob = new Blob([arrayBuffer], { type: contentType || 'image/jpeg' })
        const blobUrl = URL.createObjectURL(blob)
        const canvas = canvasRef.current!
        const img = new Image()
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = blobUrl })
        loadedImageRef.current = img
        const containerWidth = (canvas.parentElement?.parentElement?.clientWidth || 700) - 32
        const scale = (containerWidth / img.naturalWidth) * zoom
        canvas.width  = img.naturalWidth  * scale
        canvas.height = img.naturalHeight * scale
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        setPageCount(1)
      } else {
        loadedImageRef.current = null
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
        setPdfDoc(doc)
        setPageCount(doc.numPages)
        setCurrentPage(1)
        renderPdfPage(doc, 1, zoom)
      }
    } catch {
      setPdfError('Failed to load sample document')
    } finally {
      setPdfLoading(false)
    }
  }, [template, id, zoom, renderPdfPage])

  useEffect(() => {
    if (template?.sampleFilePath) loadSampleDoc()
  }, [template?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render PDF on page / zoom change
  useEffect(() => {
    if (pdfDoc) renderPdfPage(pdfDoc, currentPage, zoom)
  }, [pdfDoc, currentPage, zoom, renderPdfPage])

  // Re-render image on zoom change
  useEffect(() => {
    const img = loadedImageRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const containerWidth = (canvas.parentElement?.parentElement?.clientWidth || 700) - 32
    const scale = (containerWidth / img.naturalWidth) * zoom
    canvas.width  = img.naturalWidth  * scale
    canvas.height = img.naturalHeight * scale
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  }, [zoom])

  // ── Mouse handlers (pan + draw) ────────────────────────────────────────────

  const getRelativePos = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolMode === 'pan') {
      e.preventDefault()
      const viewer = viewerRef.current
      if (!viewer) return
      panStartRef.current = {
        x: e.clientX, y: e.clientY,
        sl: viewer.scrollLeft, st: viewer.scrollTop,
      }
      setIsPanning(true)
      return
    }
    // draw mode
    if (pendingZone) return
    e.preventDefault()
    const { x, y } = getRelativePos(e)
    setIsDrawing(true)
    setDrawRect({ startX: x, startY: y, currentX: x, currentY: y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolMode === 'pan' && panStartRef.current) {
      const viewer = viewerRef.current
      if (!viewer) return
      viewer.scrollLeft = panStartRef.current.sl - (e.clientX - panStartRef.current.x)
      viewer.scrollTop  = panStartRef.current.st - (e.clientY - panStartRef.current.y)
      return
    }
    if (!isDrawing || !drawRect) return
    const { x, y } = getRelativePos(e)
    setDrawRect((prev) => prev ? { ...prev, currentX: x, currentY: y } : null)
  }

  const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolMode === 'pan') {
      panStartRef.current = null
      setIsPanning(false)
      return
    }
    if (!isDrawing || !drawRect) return
    setIsDrawing(false)
    const { x, y } = getRelativePos(e)
    const final = { ...drawRect, currentX: x, currentY: y }
    const w = overlayRef.current!.offsetWidth
    const h = overlayRef.current!.offsetHeight
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const left   = clamp(Math.min(final.startX, final.currentX), 0, w)
    const top    = clamp(Math.min(final.startY, final.currentY), 0, h)
    const right  = clamp(Math.max(final.startX, final.currentX), 0, w)
    const bottom = clamp(Math.max(final.startY, final.currentY), 0, h)
    const width  = right - left
    const height = bottom - top
    if (width < 8 || height < 8) { setDrawRect(null); return }
    const newCoords = {
      xPercent:      (left  / w) * 100,
      yPercent:      (top   / h) * 100,
      widthPercent:  (width  / w) * 100,
      heightPercent: (height / h) * 100,
    }
    setDrawRect(null)

    // Adjusting an existing saved zone — PATCH its coordinates
    if (adjustingZoneId !== null) {
      try {
        await api.patch(`/document-classifiers/${id}/zones/${adjustingZoneId}`, newCoords)
        await loadTemplate()
      } catch (err: any) {
        setZoneError(err?.response?.data?.message || 'Failed to update zone')
      }
      setAdjustingZoneId(null)
      setPinnedZoneId(null)
      setToolMode('pan')
      return
    }

    // Adjusting a suggestion — update its coords in state
    if (adjustingIdx !== null) {
      setSuggestions((prev) => prev.map((s, i) => i === adjustingIdx ? { ...s, ...newCoords } : s))
      setAdjustingIdx(null)
      setToolMode('pan')
      return
    }

    setPendingZone({ ...newCoords, pageNumber: currentPage })
  }

  // ── Zone save / delete ─────────────────────────────────────────────────────

  const handleSaveZone = async (data: {
    fieldName: string; fieldLabel: string; description: string
    searchPhrase: string; locationContext: string; parentZoneId: string | null
  }) => {
    if (!pendingZone || !id) return
    await api.post(`/document-classifiers/${id}/zones`, {
      fieldName:       data.fieldName,
      fieldLabel:      data.fieldLabel,
      description:     data.description     || undefined,
      searchPhrase:    data.searchPhrase    || undefined,
      locationContext: data.locationContext || undefined,
      parentZoneId:    data.parentZoneId    || undefined,
      pageNumber:      pendingZone.pageNumber,
      xPercent:        pendingZone.xPercent,
      yPercent:        pendingZone.yPercent,
      widthPercent:    pendingZone.widthPercent,
      heightPercent:   pendingZone.heightPercent,
    })
    setPendingZone(null)
    setPendingParentZoneId(null)
    setToolMode('pan')
    await loadTemplate()
  }

  const handleUpdateClaimField = async (zoneId: string, claimField: string | null) => {
    if (!id) return
    setSavingClaimField((p) => ({ ...p, [zoneId]: true }))
    setSavedClaimField((p) => { const n = { ...p }; delete n[zoneId]; return n })
    if (savedTimers.current[zoneId]) { clearTimeout(savedTimers.current[zoneId]); delete savedTimers.current[zoneId] }
    try {
      await api.patch(`/document-classifiers/${id}/zones/${zoneId}`, { claimField: claimField ?? '' })
      setTemplate((prev) => prev ? {
        ...prev,
        zones: prev.zones.map((z) => z.id === zoneId ? { ...z, claimField: claimField } : z),
      } : prev)
      setSavedClaimField((p) => ({ ...p, [zoneId]: true }))
      savedTimers.current[zoneId] = setTimeout(() => {
        setSavedClaimField((p) => { const n = { ...p }; delete n[zoneId]; return n })
      }, 2500)
    } catch (err: any) {
      setZoneError(err?.response?.data?.message || 'Failed to update mapping')
    } finally {
      setSavingClaimField((p) => { const n = { ...p }; delete n[zoneId]; return n })
    }
  }

  const handleDeleteZone = async (zoneId: string) => {
    if (!id) return
    setDeletingZoneId(zoneId)
    try {
      await api.delete(`/document-classifiers/${id}/zones/${zoneId}`)
      setTemplate((prev) => prev ? { ...prev, zones: prev.zones.filter((z) => z.id !== zoneId) } : prev)
    } catch (err: any) {
      setZoneError(err?.response?.data?.message || 'Failed to delete zone')
    } finally {
      setDeletingZoneId(null)
    }
  }

  // ── Zone OCR ───────────────────────────────────────────────────────────────

  const handleOcrZone = async (zoneId: string) => {
    if (!id) return
    setOcrLoading((prev) => ({ ...prev, [zoneId]: true }))
    setOcrResults((prev) => { const n = { ...prev }; delete n[zoneId]; return n })
    try {
      const { data } = await api.post<OcrResult>(`/document-classifiers/${id}/zones/${zoneId}/ocr`)
      setOcrResults((prev) => ({ ...prev, [zoneId]: data }))
    } catch (err: any) {
      setOcrResults((prev) => ({ ...prev, [zoneId]: { text: '', confidence: 0, reasoning: `Error: ${err?.response?.data?.message || 'OCR failed'}` } }))
    } finally {
      setOcrLoading((prev) => ({ ...prev, [zoneId]: false }))
    }
  }

  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [zoneError, setZoneError]       = useState<string | null>(null)

  // AI provider
  const [aiProvider, setAiProvider] = useState<{
    active: string
    anthropicModel: string
    geminiModel: string
    anthropic: { available: boolean }
    gemini: { available: boolean }
  } | null>(null)
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [modelMenuOpen, setModelMenuOpen]         = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/document-classifiers/ai-config').then(({ data }) => setAiProvider(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!modelMenuOpen) return
    const close = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [modelMenuOpen])

  const handleSwitchProvider = async (provider: 'anthropic' | 'gemini') => {
    setSwitchingProvider(true)
    try {
      const { data } = await api.patch('/document-classifiers/ai-config', { provider })
      setAiProvider(data)
    } finally {
      setSwitchingProvider(false)
    }
  }

  const handleSuggestZones = async () => {
    if (!id || !template?.sampleFilePath) return
    setSuggestLoading(true)
    setSuggestions([])
    setSuggestError(null)
    setDismissedSugg(new Set())
    try {
      const { data } = await api.post<SuggestedZone[]>(`/document-classifiers/${id}/suggest-zones`)
      setSuggestions(data)
    } catch (err: any) {
      setSuggestError(err?.response?.data?.message || 'Failed to suggest zones')
    } finally {
      setSuggestLoading(false)
    }
  }

  const buildZonePayload = (sugg: SuggestedZone) => ({
    fieldName:     sugg.fieldName,
    fieldLabel:    sugg.fieldLabel,
    description:   sugg.description  || undefined,
    searchPhrase:  sugg.searchPhrase || undefined,
    claimField:    DEFAULT_CLAIM_FIELD[sugg.fieldName] || undefined,
    pageNumber:    sugg.pageNumber   ?? 1,
    xPercent:      sugg.xPercent,
    yPercent:      sugg.yPercent,
    widthPercent:  sugg.widthPercent,
    heightPercent: sugg.heightPercent,
  })

  const handleAcceptSuggestion = async (sugg: SuggestedZone, idx: number) => {
    if (!id) return
    try {
      await api.post(`/document-classifiers/${id}/zones`, buildZonePayload(sugg))
      setDismissedSugg((prev) => new Set([...prev, idx]))
      await loadTemplate()
    } catch (err: any) {
      setZoneError(err?.response?.data?.message || 'Failed to save zone')
    }
  }

  const handleAcceptAllSuggestions = async () => {
    if (!id) return
    const pending = suggestions.filter((_, i) => !dismissedSugg.has(i))
    let failed = 0
    let firstErr = ''
    for (const sugg of pending) {
      try {
        await api.post(`/document-classifiers/${id}/zones`, buildZonePayload(sugg))
      } catch (err: any) {
        failed++
        if (!firstErr) firstErr = err?.response?.data?.message || err?.message || 'Unknown error'
      }
    }
    if (failed > 0) setZoneError(`${failed} zone${failed > 1 ? 's' : ''} failed to save. Error: ${firstErr}`)
    setSuggestions([])
    setDismissedSugg(new Set())
    await loadTemplate()
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  const zoomIn  = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))
  const zoomOut = () => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))
  const zoomFit = () => setZoom(1)

  const scrollToZone = useCallback((xPct: number, yPct: number, wPct: number, hPct: number) => {
    const canvas = canvasRef.current
    const viewer = viewerRef.current
    if (!canvas || !viewer) return
    const cx = ((xPct + wPct / 2) / 100) * canvas.width
    const cy = ((yPct + hPct / 2) / 100) * canvas.height
    viewer.scrollLeft = cx - viewer.clientWidth  / 2 + 16   // +16 = canvas padding
    viewer.scrollTop  = cy - viewer.clientHeight / 2 + 16
  }, [])

  // Navigate to the correct page then scroll to the zone.
  // If already on the right page just scroll immediately; otherwise change the page
  // and let the useEffect below fire the scroll once the canvas re-renders.
  const navigateToZone = useCallback((x: number, y: number, w: number, h: number, pageNum: number) => {
    const target = pageNum ?? 1
    if (target !== currentPage) {
      pendingScrollRef.current = { x, y, w, h }
      setCurrentPage(target)
    } else {
      scrollToZone(x, y, w, h)
    }
  }, [currentPage, scrollToZone])

  // After a page change re-render, execute any pending scroll
  useEffect(() => {
    if (!pendingScrollRef.current) return
    const { x, y, w, h } = pendingScrollRef.current
    pendingScrollRef.current = null
    const t = setTimeout(() => scrollToZone(x, y, w, h), 150)
    return () => clearTimeout(t)
  }, [currentPage, scrollToZone])

  // ── Draw rect visual ──────────────────────────────────────────────────────

  const drawRectStyle = drawRect ? {
    left:   Math.min(drawRect.startX, drawRect.currentX),
    top:    Math.min(drawRect.startY, drawRect.currentY),
    width:  Math.abs(drawRect.currentX - drawRect.startX),
    height: Math.abs(drawRect.currentY - drawRect.startY),
  } : null

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  if (loadError || !template) return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <p className="text-sm">{loadError || 'Template not found'}</p>
      <Button onClick={() => fromUnknownDocs ? navigate('/unknown-documents') : navigate('/settings?tab=document-classifiers')}>
        <ArrowLeft className="mr-2 h-4 w-4" /> {fromUnknownDocs ? 'Back to Unknown Docs' : 'Back to Settings'}
      </Button>
    </div>
  )

  const existingFieldNames = template.zones.map((z) => z.fieldName)

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 pb-3 shrink-0">
        <Button variant="ghost" size="sm"
          onClick={() => fromUnknownDocs ? navigate('/unknown-documents') : navigate('/settings?tab=document-classifiers')}
          className="gap-1.5 h-8">
          <ArrowLeft className="h-4 w-4" /> {fromUnknownDocs ? 'Unknown Docs' : 'Settings'}
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm truncate">{template.name}</span>
          <Badge variant="outline" className="text-xs">{template.documentType}</Badge>
          {template.specificProvider && (
            <span className="text-xs text-muted-foreground">{template.specificProvider}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* AI provider + model selector */}
          {aiProvider && (() => {
            const isAnthropic = aiProvider.active === 'anthropic'
            const activeModel = isAnthropic
              ? (aiProvider.anthropicModel || 'claude-sonnet-4-6')
              : (aiProvider.geminiModel    || 'gemini-2.5-flash')
            const shortModel = activeModel.replace('claude-', '').replace('-20241022','').replace('-20251001','').replace('gemini-','')

            const CLAUDE_MODELS = [
              { id: 'claude-opus-4-7',          label: 'Opus 4.7',    badge: 'Most Capable' },
              { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6',  badge: 'Recommended' },
              { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',   badge: 'Fastest' },
              { id: 'claude-3-5-sonnet-20241022',label: '3.5 Sonnet',  badge: '' },
              { id: 'claude-3-haiku-20240307',   label: '3 Haiku',     badge: '' },
            ]
            const GEMINI_MODELS = [
              { id: 'gemini-2.5-flash', label: '2.5 Flash', badge: 'Latest' },
              { id: 'gemini-2.5-pro',   label: '2.5 Pro',   badge: 'Most Capable' },
              { id: 'gemini-2.0-flash', label: '2.0 Flash', badge: '' },
              { id: 'gemini-1.5-flash', label: '1.5 Flash', badge: '' },
              { id: 'gemini-1.5-pro',   label: '1.5 Pro',   badge: '' },
            ]

            const selectModel = (provider: 'anthropic' | 'gemini', modelId: string) => {
              setSwitchingProvider(true)
              setModelMenuOpen(false)
              const patch = provider === 'anthropic'
                ? { provider: 'anthropic' as const, anthropicModel: modelId }
                : { provider: 'gemini'    as const, geminiModel:    modelId }
              api.patch('/document-classifiers/ai-config', patch)
                .then(({ data }) => setAiProvider(data))
                .finally(() => setSwitchingProvider(false))
            }

            return (
              <div ref={modelMenuRef} className="relative">
                {/* Trigger pill */}
                <button
                  onClick={() => setModelMenuOpen((o) => !o)}
                  disabled={switchingProvider}
                  className={`flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border text-xs font-semibold transition-all shadow-sm hover:shadow-md disabled:opacity-50 ${
                    isAnthropic
                      ? 'bg-orange-50 border-orange-200 text-orange-800 hover:bg-orange-100 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-200'
                      : 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200'
                  }`}
                >
                  {switchingProvider
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <span className="text-sm">{isAnthropic ? '◆' : '✦'}</span>
                  }
                  <span>{isAnthropic ? 'Claude' : 'Gemini'}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    isAnthropic ? 'bg-orange-100 dark:bg-orange-900/50' : 'bg-blue-100 dark:bg-blue-900/50'
                  }`}>{shortModel}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown */}
                {modelMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border bg-popover shadow-xl z-50 overflow-hidden">
                    {/* Claude section */}
                    <div className={`${!aiProvider.anthropic.available ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                        <span className="text-orange-500 text-sm">◆</span>
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Claude</span>
                        {!aiProvider.anthropic.available && <span className="text-[9px] text-destructive ml-auto">No API key</span>}
                      </div>
                      {CLAUDE_MODELS.map((m) => {
                        const isActive = isAnthropic && aiProvider.anthropicModel === m.id
                        return (
                          <button key={m.id}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                              isActive ? 'bg-orange-50 dark:bg-orange-950/40' : 'hover:bg-muted/60'
                            }`}
                            onClick={() => selectModel('anthropic', m.id)}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? 'bg-orange-500' : 'bg-transparent border border-muted-foreground/30'}`} />
                            <span className={`text-xs flex-1 ${isActive ? 'font-semibold text-orange-800 dark:text-orange-200' : 'text-foreground'}`}>{m.label}</span>
                            {m.badge && <span className="text-[9px] text-muted-foreground">{m.badge}</span>}
                          </button>
                        )
                      })}
                    </div>

                    <div className="my-1.5 border-t" />

                    {/* Gemini section */}
                    <div className={`pb-2 ${!aiProvider.gemini.available ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="flex items-center gap-2 px-3 pt-1 pb-1">
                        <span className="text-blue-500 text-sm">✦</span>
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Gemini</span>
                        {!aiProvider.gemini.available && <span className="text-[9px] text-destructive ml-auto">No API key</span>}
                      </div>
                      {GEMINI_MODELS.map((m) => {
                        const isActive = !isAnthropic && aiProvider.geminiModel === m.id
                        return (
                          <button key={m.id}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                              isActive ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-muted/60'
                            }`}
                            onClick={() => selectModel('gemini', m.id)}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? 'bg-blue-500' : 'bg-transparent border border-muted-foreground/30'}`} />
                            <span className={`text-xs flex-1 ${isActive ? 'font-semibold text-blue-800 dark:text-blue-200' : 'text-foreground'}`}>{m.label}</span>
                            {m.badge && <span className="text-[9px] text-muted-foreground">{m.badge}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            {template.zones.length} zone{template.zones.length !== 1 ? 's' : ''} defined
          </div>
        </div>
      </div>

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden rounded-xl border bg-background shadow-sm">

        {/* ══ Left: document viewer (60%) ══ */}
        <div className="flex flex-col w-3/5 border-r overflow-hidden bg-muted/10">

          {/* Viewer toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-background shrink-0 flex-wrap">

            {/* Tool mode */}
            <div className="flex items-center rounded-md border bg-muted/40 p-0.5 gap-0.5">
              <Button
                size="sm"
                variant={toolMode === 'pan' ? 'default' : 'ghost'}
                className="gap-1.5 h-6 text-xs px-2"
                onClick={() => { setToolMode('pan'); setPendingZone(null); setDrawRect(null); setIsDrawing(false); setAdjustingZoneId(null) }}
                title="Hand — drag to pan"
              >
                <Hand className="h-3.5 w-3.5" /> Pan
              </Button>
              <Button
                size="sm"
                variant={toolMode === 'draw' ? 'default' : 'ghost'}
                className={`gap-1.5 h-6 text-xs px-2 ${toolMode === 'draw' ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                onClick={() => { setToolMode('draw'); setPendingZone(null); setDrawRect(null); setIsDrawing(false) }}
                title="Draw — drag to mark a zone"
              >
                <Square className="h-3.5 w-3.5" /> Draw
              </Button>
            </div>

            {toolMode === 'draw' && !pendingZone && adjustingIdx === null && adjustingZoneId === null && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                Drag to define a zone
              </span>
            )}
            {adjustingZoneId !== null && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
                <Pencil className="h-3 w-3" />
                Drag to reposition "{template.zones.find((z) => z.id === adjustingZoneId)?.fieldLabel}"
                <button className="underline text-amber-700 ml-1"
                  onClick={() => { setAdjustingZoneId(null); setToolMode('pan') }}>
                  Cancel
                </button>
              </span>
            )}
            {adjustingIdx !== null && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <Pencil className="h-3 w-3" />
                Drag to redraw zone for "{suggestions[adjustingIdx]?.fieldLabel}"
              </span>
            )}

            {/* Divider */}
            <div className="w-px h-5 bg-border mx-1" />

            {/* Zoom controls */}
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={zoomOut} title="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs tabular-nums w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={zoomIn} title="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2 gap-1" onClick={zoomFit} title="Fit to width">
              <Maximize2 className="h-3 w-3" /> Fit
            </Button>

            {/* Page navigation */}
            {pageCount > 1 && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs tabular-nums">{currentPage} / {pageCount}</span>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={currentPage >= pageCount} onClick={() => setCurrentPage((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}

            {/* Split button — only when sample is loaded */}
            {template.sampleFilePath && pageCount > 0 && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <Button
                  variant="outline" size="sm"
                  className="h-7 gap-1.5 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                  onClick={() => {
                    setSplitRanges([{ start: 1, end: pageCount, name: 'part_1' }])
                    setAnalysisDone(false)
                    setSplitDialogOpen(true)
                    if (pdfDoc) generateThumbnails(pdfDoc, pageCount)
                  }}
                >
                  <Scissors className="h-3.5 w-3.5" /> Split &amp; Categorize
                </Button>
              </>
            )}
          </div>

          {/* Canvas area */}
          <div ref={viewerRef} className="flex-1 overflow-auto p-4 bg-slate-100 dark:bg-slate-900">
            {pdfLoading ? (
              <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Loading document…</span>
              </div>
            ) : pdfError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm">{pdfError}</p>
                <Button size="sm" variant="outline" onClick={loadSampleDoc}>Retry</Button>
              </div>
            ) : !template.sampleFilePath ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <FileText className="h-12 w-12 opacity-30" />
                <p className="text-sm font-medium">No sample document uploaded</p>
                <p className="text-xs">Upload a sample document in Settings to enable zone drawing.</p>
              </div>
            ) : (
              <div className="relative inline-block shadow-md rounded">
                <canvas ref={canvasRef} className="block rounded" />

                {/* Zone overlay — receives all mouse events */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0 rounded"
                  style={{
                    cursor: toolMode === 'pan'
                      ? (isPanning ? 'grabbing' : 'grab')
                      : (pendingZone ? 'default' : 'crosshair'),
                    zIndex: 10,
                    userSelect: 'none',
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => {
                    if (toolMode === 'pan') { panStartRef.current = null; setIsPanning(false) }
                    else if (isDrawing) { setIsDrawing(false); setDrawRect(null) }
                  }}
                >
                  {/* Live draw rectangle */}
                  {drawRectStyle && (
                    <div style={{
                      position: 'absolute',
                      left: drawRectStyle.left, top: drawRectStyle.top,
                      width: drawRectStyle.width, height: drawRectStyle.height,
                      border: '2px dashed #6366f1',
                      backgroundColor: 'rgba(99,102,241,0.12)',
                      pointerEvents: 'none',
                      boxShadow: '0 0 0 1px rgba(99,102,241,0.3)',
                    }} />
                  )}

                  {/* Saved zones — only render zones that belong to the current page */}
                  {template.zones.filter((z) => (z.pageNumber ?? 1) === currentPage).map((zone) => {
                    const c = zoneColor(zone.fieldName)
                    const isAdjusting = adjustingZoneId === zone.id
                    const isActive = isAdjusting || pinnedZoneId === zone.id || (pinnedZoneId === null && highlightedZoneId === zone.id)
                    const isPinned = pinnedZoneId === zone.id
                    const clickable = toolMode === 'pan' && !isAdjusting
                    return (
                      <div
                        key={zone.id}
                        onClick={clickable ? (e) => {
                          e.stopPropagation()
                          setPinnedZoneId(zone.id)
                          setHighlightedZoneId(zone.id)
                          // Expand card if collapsed
                          setCollapsedZones((prev) => { const n = new Set(prev); n.delete(zone.id); return n })
                          // Scroll the card into view in the right panel
                          setTimeout(() => {
                            document.getElementById(`zone-card-${zone.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                          }, 50)
                        } : undefined}
                        style={{
                          position: 'absolute',
                          left: `${zone.xPercent}%`, top: `${zone.yPercent}%`,
                          width: `${zone.widthPercent}%`, height: `${zone.heightPercent}%`,
                          backgroundColor: isAdjusting ? 'rgba(245,158,11,0.15)' : isActive ? c.border.replace(')', ',0.25)').replace('rgb', 'rgba') : c.bg,
                          border: isAdjusting ? '2px dashed #f59e0b' : `${isPinned ? 3 : 2}px solid ${c.border}`,
                          pointerEvents: clickable ? 'auto' : 'none',
                          cursor: clickable ? 'pointer' : undefined,
                          transition: 'background-color 0.2s, box-shadow 0.15s',
                          boxShadow: isAdjusting ? '0 0 0 3px rgba(245,158,11,0.3)' : isPinned ? `0 0 0 3px ${c.border}44` : isActive ? `0 0 0 2px ${c.border}` : undefined,
                        }}>
                        <span style={{
                          position: 'absolute', top: -18, left: 0,
                          fontSize: 10, fontWeight: 700,
                          backgroundColor: c.border, color: '#fff',
                          padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
                          letterSpacing: '0.02em',
                          pointerEvents: 'none',
                        }}>
                          {zone.fieldLabel}
                        </span>
                      </div>
                    )
                  })}

                  {/* Suggestion preview — only show if suggestion is on the current page */}
                  {(() => {
                    const activeIdx = pinnedSuggIdx ?? hoveredSuggIdx
                    const sugg = activeIdx !== null ? suggestions[activeIdx] : null
                    if (!sugg || dismissedSugg.has(activeIdx!)) return null
                    if ((sugg.pageNumber ?? 1) !== currentPage) return null
                    const isPinned = pinnedSuggIdx === activeIdx
                    return (
                      <div style={{
                        position: 'absolute',
                        left: `${sugg.xPercent}%`, top: `${sugg.yPercent}%`,
                        width: `${sugg.widthPercent}%`, height: `${sugg.heightPercent}%`,
                        border: `2px dashed ${isPinned ? '#7c3aed' : '#a78bfa'}`,
                        backgroundColor: isPinned ? 'rgba(124,58,237,0.15)' : 'rgba(167,139,250,0.10)',
                        pointerEvents: 'none',
                        transition: 'all 0.15s ease',
                        boxShadow: isPinned ? '0 0 0 3px rgba(124,58,237,0.25)' : undefined,
                        zIndex: 20,
                      }}>
                        <span style={{
                          position: 'absolute', top: -20, left: 0,
                          fontSize: 10, fontWeight: 700,
                          backgroundColor: isPinned ? '#7c3aed' : '#a78bfa',
                          color: '#fff',
                          padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                          letterSpacing: '0.02em',
                        }}>
                          ✦ {sugg.fieldLabel}
                        </span>
                      </div>
                    )
                  })()}

                  {/* Pending zone (drawn, not saved yet) */}
                  {pendingZone && (
                    <div style={{
                      position: 'absolute',
                      left: `${pendingZone.xPercent}%`, top: `${pendingZone.yPercent}%`,
                      width: `${pendingZone.widthPercent}%`, height: `${pendingZone.heightPercent}%`,
                      border: '2px solid #6366f1',
                      backgroundColor: 'rgba(99,102,241,0.15)',
                      pointerEvents: 'none',
                      animation: 'pulse 1s ease-in-out infinite',
                    }} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ Right: zones panel (40%) ══ */}
        <div className="flex flex-col w-2/5 overflow-hidden bg-muted/20">

          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2 bg-background">
            <div className="min-w-0 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Field Zones</p>
                <p className="text-[11px] text-muted-foreground">
                  {template.zones.length === 0
                    ? 'Draw a zone or auto-suggest'
                    : `${template.zones.length} zone${template.zones.length !== 1 ? 's' : ''} configured`
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {template.zones.length > 0 && (
                <div className="flex items-center rounded-md border bg-muted/40 p-0.5 gap-0.5">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={collapseAll}>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">Collapse all</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={expandAll}>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">Expand all</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
              {template.sampleFilePath && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1.5 border-violet-200 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        onClick={handleSuggestZones}
                        disabled={suggestLoading}
                      >
                        {suggestLoading
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Sparkles className="h-3.5 w-3.5 text-violet-500" />}
                        <span className="text-violet-700 dark:text-violet-300 font-medium">
                          {suggestLoading ? 'Analysing…' : 'Auto-suggest'}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">AI analyses the document and suggests field zones</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button
                size="sm"
                variant={toolMode === 'draw' ? 'destructive' : 'default'}
                className="h-8 text-xs gap-1.5 font-medium"
                onClick={() => {
                  if (toolMode === 'draw') { setToolMode('pan'); setPendingZone(null); setDrawRect(null) }
                  else { setToolMode('draw') }
                }}
              >
                {toolMode === 'draw' ? <XIcon className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {toolMode === 'draw' ? 'Cancel' : 'Add Zone'}
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
          <div className="p-4 space-y-2.5">

            {/* ── Zone error ── */}
            {zoneError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive flex-1 leading-snug">{zoneError}</p>
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setZoneError(null)}>
                  <XIcon className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* ── Auto-suggest error ── */}
            {suggestError && (() => {
              const isQuota = suggestError.toLowerCase().includes('quota') || suggestError.toLowerCase().includes('switch to claude')
              return (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-destructive">Auto-suggest failed</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{suggestError}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setSuggestError(null)}>
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                  {isQuota && aiProvider?.anthropic.available && aiProvider.active !== 'anthropic' && (
                    <Button size="sm" className="w-full h-7 text-xs gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={async () => {
                        await handleSwitchProvider('anthropic')
                        setSuggestError(null)
                        handleSuggestZones()
                      }}>
                      ◆ Switch to Claude &amp; retry
                    </Button>
                  )}
                </div>
              )
            })()}

            {/* ── Auto-suggest review panel ── */}
            {suggestions.length > 0 && (
              <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-b from-violet-50 to-background dark:from-violet-950/40 dark:to-background overflow-hidden shadow-sm">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-violet-200 dark:border-violet-800/60">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-violet-100 dark:bg-violet-900/60 flex items-center justify-center">
                      <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-violet-800 dark:text-violet-200 leading-tight">
                        {suggestions.filter((_, i) => !dismissedSugg.has(i)).length} AI suggestions
                      </p>
                      <p className="text-[10px] text-violet-600/70 dark:text-violet-400/70">Review and accept zones</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1 border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40"
                      onClick={handleAcceptAllSuggestions}>
                      <CheckCheck className="h-3 w-3" /> Accept All
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => setSuggestions([])}>
                      Dismiss All
                    </Button>
                  </div>
                </div>
                <div className="p-2">

                <div className="space-y-1.5">
                  {suggestions.map((sugg, idx) => {
                    if (dismissedSugg.has(idx)) return null
                    const alreadyExists = template.zones.some((z) => z.fieldName === sugg.fieldName)
                    const confPct = Math.round(sugg.confidence * 100)
                    const confColor = confPct >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                      : confPct >= 50 ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-500'
                    const isActive = pinnedSuggIdx === idx || hoveredSuggIdx === idx
                    return (
                      <div
                        key={idx}
                        className={`rounded-xl border overflow-hidden cursor-pointer transition-all ${
                          alreadyExists        ? 'opacity-40' :
                          adjustingIdx === idx ? 'border-amber-400 shadow-md ring-2 ring-amber-200 dark:ring-amber-900' :
                          isActive             ? 'border-violet-400 shadow-md ring-2 ring-violet-200 dark:ring-violet-900' :
                          'hover:border-violet-300 hover:shadow-sm'
                        }`}
                        onMouseEnter={() => { if (adjustingIdx === null) { setHoveredSuggIdx(idx); scrollToZone(sugg.xPercent, sugg.yPercent, sugg.widthPercent, sugg.heightPercent) } }}
                        onMouseLeave={() => setHoveredSuggIdx(null)}
                        onClick={() => {
                          if (alreadyExists || adjustingIdx !== null) return
                          setPinnedSuggIdx(prev => prev === idx ? null : idx)
                          navigateToZone(sugg.xPercent, sugg.yPercent, sugg.widthPercent, sugg.heightPercent, sugg.pageNumber ?? 1)
                        }}
                      >
                        {/* Top stripe: colour-coded by field */}
                        <div className="flex items-center gap-2 px-3 py-2"
                          style={{ backgroundColor: zoneColor(sugg.fieldName).bg, borderBottom: `1px solid ${zoneColor(sugg.fieldName).border}22` }}>
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: zoneColor(sugg.fieldName).border }} />
                          <p className="text-xs font-bold flex-1 truncate">{sugg.fieldLabel}</p>
                          <span className="text-[10px] bg-white/70 dark:bg-black/30 px-1.5 py-0.5 rounded font-semibold text-indigo-700 dark:text-indigo-300">
                            pg {sugg.pageNumber ?? 1}
                          </span>
                          <span className={`text-[10px] font-bold font-mono ${confColor}`}>{confPct}%</span>
                          {!alreadyExists && (
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 ml-1 text-muted-foreground hover:text-destructive"
                              title="Dismiss suggestion"
                              onClick={(e) => { e.stopPropagation(); setDismissedSugg((prev) => new Set([...prev, idx])) }}>
                              <XIcon className="h-3 w-3" />
                            </Button>
                          )}
                        </div>

                        {/* Extracted value */}
                        <div className="px-3 py-2 bg-background">
                          {sugg.extractedValue ? (
                            <div className="flex items-center gap-1.5">
                              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="flex-1 text-xs font-mono font-semibold text-foreground break-all leading-snug">
                                {sugg.extractedValue}
                              </span>
                              <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0 opacity-40 hover:opacity-100"
                                title="Copy extracted value"
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(sugg.extractedValue!) }}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No value extracted</span>
                          )}
                          {sugg.searchPhrase && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">near: "{sugg.searchPhrase}"</p>
                          )}
                        </div>

                        {/* Footer: coords + actions */}
                        {!alreadyExists && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/20 border-t">
                            <span className="text-[9px] text-muted-foreground font-mono flex-1 truncate">
                              x{sugg.xPercent.toFixed(0)}% y{sugg.yPercent.toFixed(0)}% · {sugg.widthPercent.toFixed(0)}×{sugg.heightPercent.toFixed(0)}%
                            </span>
                            {adjustingIdx === idx ? (
                              <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-0.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                onClick={(e) => { e.stopPropagation(); setAdjustingIdx(null); setToolMode('pan') }}>
                                <XIcon className="h-2.5 w-2.5" /> Cancel
                              </Button>
                            ) : (
                              <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-0.5 text-violet-600 hover:text-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setAdjustingIdx(idx); setPinnedSuggIdx(idx); setToolMode('draw')
                                  navigateToZone(sugg.xPercent, sugg.yPercent, sugg.widthPercent, sugg.heightPercent, sugg.pageNumber ?? 1)
                                }}>
                                <Pencil className="h-2.5 w-2.5" /> Adjust
                              </Button>
                            )}
                            <Button type="button" size="sm" className="h-6 text-[10px] px-2 gap-0.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={(e) => { e.stopPropagation(); handleAcceptSuggestion(sugg, idx) }}>
                              <CheckCircle2 className="h-2.5 w-2.5" /> Accept
                            </Button>
                          </div>
                        )}
                        {alreadyExists && (
                          <div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/20 border-t text-[10px] text-amber-600 font-medium">
                            Already defined in this template
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                </div>
              </div>
            )}

            {/* Root-level zone save form — only when no parent zone is selected */}
            {pendingZone && !pendingParentZoneId && (
              <ZoneSaveForm
                pending={pendingZone}
                existingFields={existingFieldNames}
                existingZones={template?.zones.map((z) => ({ id: z.id, fieldLabel: z.fieldLabel })) ?? []}
                initialParentZoneId={null}
                onSave={handleSaveZone}
                onCancel={() => { setPendingZone(null); setDrawRect(null); setPendingParentZoneId(null) }}
              />
            )}

            {/* Existing zones list */}
            {template.zones.length === 0 && !pendingZone ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4 shadow-inner">
                  <MapPin className="h-6 w-6 opacity-30" />
                </div>
                <p className="text-sm font-semibold text-foreground/70">No zones yet</p>
                <p className="text-xs mt-1.5 max-w-[200px] leading-relaxed text-muted-foreground">
                  Click <strong>Add Zone</strong> then drag on the document to mark a field region.
                </p>
              </div>
            ) : (
              <TooltipProvider delayDuration={300}>
              {(() => {
                const renderCard = (zone: DocumentZone): JSX.Element => {
                const c = zoneColor(zone.fieldName)
                const isPinned = pinnedZoneId === zone.id
                const isAdjusting = adjustingZoneId === zone.id
                const childZones = template.zones.filter((z) => z.parentZoneId === zone.id)
                const isCollapsed = collapsedZones.has(zone.id)
                const isSubzonesCollapsed = collapsedSubzones.has(zone.id)
                const hasDetails = !!(zone.locationContext || zone.searchPhrase || zone.description || ocrResults[zone.id])
                return (
                  <div key={zone.id} className="space-y-1.5">
                  <div
                    id={`zone-card-${zone.id}`}
                    className={`group rounded-xl border bg-background shadow-sm transition-all ${
                      isPinned
                        ? 'shadow-md ring-2'
                        : 'hover:shadow-md hover:border-border/80'
                    }`}
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: c.border,
                      ...(isPinned ? { '--tw-ring-color': c.border, '--tw-ring-opacity': '0.5' } as React.CSSProperties : {}),
                    }}
                    onMouseEnter={() => { if (!pinnedZoneId) { setHighlightedZoneId(zone.id); scrollToZone(zone.xPercent, zone.yPercent, zone.widthPercent, zone.heightPercent) } }}
                    onMouseLeave={() => { if (!pinnedZoneId) setHighlightedZoneId(null) }}
                  >
                    {/* ── Card header (always visible) ── */}
                    <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">

                      {/* Collapse toggle */}
                      <button
                        className="mt-0.5 shrink-0 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        onClick={(e) => { e.stopPropagation(); toggleZoneCollapse(zone.id) }}
                        title={isCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`} />
                      </button>

                      <div
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => {
                          const next = isPinned ? null : zone.id
                          setPinnedZoneId(next)
                          setHighlightedZoneId(next)
                          if (next) navigateToZone(zone.xPercent, zone.yPercent, zone.widthPercent, zone.heightPercent, zone.pageNumber ?? 1)
                        }}
                      >
                        {/* Zone name + badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold leading-tight truncate">{zone.fieldLabel}</p>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono rounded font-normal shrink-0">
                            {zone.fieldName}
                          </Badge>
                          <Badge className="text-[10px] h-4 px-1.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 border-0 shrink-0">
                            pg {zone.pageNumber ?? 1}
                          </Badge>
                          {childZones.length > 0 && (
                            <Badge className="text-[10px] h-4 px-1.5 bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 border-0 gap-0.5 shrink-0">
                              <GitBranch className="h-2.5 w-2.5" />
                              {childZones.length} sub-zone{childZones.length > 1 ? 's' : ''}
                            </Badge>
                          )}
                          {zone.parentZoneId && (() => {
                            const parent = template.zones.find((z) => z.id === zone.parentZoneId)
                            return parent ? (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                                <GitBranch className="h-2.5 w-2.5" /> under&nbsp;
                                <button
                                  className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPinnedZoneId(parent.id)
                                    setHighlightedZoneId(parent.id)
                                    navigateToZone(parent.xPercent, parent.yPercent, parent.widthPercent, parent.heightPercent, parent.pageNumber ?? 1)
                                  }}
                                >{parent.fieldLabel}</button>
                              </span>
                            ) : null
                          })()}
                        </div>

                        {/* Claim field mapping */}
                        <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[10px] text-muted-foreground shrink-0 font-medium">→ fills</span>
                          <Select
                            value={zone.claimField || DEFAULT_CLAIM_FIELD[zone.fieldName] || ''}
                            onValueChange={(val) => handleUpdateClaimField(zone.id, val === '__none__' ? null : val)}
                            disabled={savingClaimField[zone.id]}
                          >
                            <SelectTrigger className="h-6 text-[10px] flex-1 min-w-0 px-2 rounded-md border-dashed focus:ring-emerald-400">
                              <SelectValue placeholder="— not mapped —" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-xs text-muted-foreground">— not mapped —</SelectItem>
                              {CLAIM_FIELD_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {savingClaimField[zone.id] && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
                          {savedClaimField[zone.id] && !savingClaimField[zone.id] && <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />}
                        </div>
                      </div>

                      {/* Action icon group */}
                      <div className="flex items-center shrink-0 rounded-lg border bg-muted/30 divide-x overflow-hidden">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className={`flex items-center justify-center h-7 w-7 transition-colors ${isPinned ? 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'text-muted-foreground hover:text-blue-500 hover:bg-muted/60'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                const next = pinnedZoneId === zone.id ? null : zone.id
                                setPinnedZoneId(next); setHighlightedZoneId(next)
                                if (next) navigateToZone(zone.xPercent, zone.yPercent, zone.widthPercent, zone.heightPercent, zone.pageNumber ?? 1)
                              }}>
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">Pin / unpin on document</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className={`flex items-center justify-center h-7 w-7 transition-colors ${isAdjusting ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'text-muted-foreground hover:text-amber-500 hover:bg-muted/60'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (isAdjusting) { setAdjustingZoneId(null); setToolMode('pan') }
                                else {
                                  setAdjustingZoneId(zone.id); setPinnedZoneId(zone.id)
                                  setHighlightedZoneId(zone.id); setToolMode('draw')
                                  navigateToZone(zone.xPercent, zone.yPercent, zone.widthPercent, zone.heightPercent, zone.pageNumber ?? 1)
                                }
                              }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">{isAdjusting ? 'Cancel adjust' : 'Adjust boundaries'}</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-violet-500 hover:bg-muted/60 transition-colors disabled:opacity-40"
                              disabled={ocrLoading[zone.id]}
                              onClick={(e) => { e.stopPropagation(); handleOcrZone(zone.id) }}>
                              {ocrLoading[zone.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">Run OCR on zone</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="flex items-center justify-center h-7 w-7 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPendingParentZoneId(zone.id); setPendingZone(null); setDrawRect(null); setAdjustingZoneId(null)
                                setPinnedZoneId(zone.id); setHighlightedZoneId(zone.id); setToolMode('draw')
                                navigateToZone(zone.xPercent, zone.yPercent, zone.widthPercent, zone.heightPercent, zone.pageNumber ?? 1)
                              }}>
                              <GitBranch className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">Add sub-zone</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                              disabled={deletingZoneId === zone.id}
                              onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id) }}>
                              {deletingZoneId === zone.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">Delete zone</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {/* ── Collapsible body ── */}
                    {!isCollapsed && (
                      <div>
                        {/* Location context */}
                        {zone.locationContext && (
                          <div className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 px-2.5 py-1.5">
                            <BookOpen className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-800 dark:text-amber-200 leading-snug">{zone.locationContext}</p>
                          </div>
                        )}

                        {/* Search phrase */}
                        {zone.searchPhrase && (
                          <div className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/50 px-2.5 py-1.5">
                            <Search className="h-3 w-3 text-violet-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] font-mono text-violet-700 dark:text-violet-300 break-all leading-snug">{zone.searchPhrase}</p>
                          </div>
                        )}

                        {/* AI extraction hint */}
                        {zone.description && (
                          <p className="mx-3 mb-2 text-xs text-muted-foreground leading-snug">{zone.description}</p>
                        )}

                        {/* OCR result */}
                        {ocrResults[zone.id] !== undefined && (() => {
                          const r = ocrResults[zone.id]
                          const isError = r.reasoning.startsWith('Error:')
                          const confPct = Math.round(r.confidence * 100)
                          const confColor = confPct >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                            : confPct >= 50 ? 'text-amber-500' : 'text-red-500'
                          return (
                            <div className={`mx-3 mb-2 rounded-lg px-2.5 py-2 space-y-1 ${
                              isError
                                ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
                                : 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800'
                            }`}>
                              <div className="flex items-start gap-1.5">
                                <ScanText className={`h-3 w-3 shrink-0 mt-0.5 ${isError ? 'text-red-500' : 'text-emerald-600'}`} />
                                <span className={`flex-1 text-xs font-mono break-all leading-snug ${isError ? 'text-red-700 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-200'}`}>
                                  {r.text || (isError ? r.reasoning : '(empty)')}
                                </span>
                                {!isError && r.text && (
                                  <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0 opacity-60 hover:opacity-100 text-emerald-700 dark:text-emerald-300"
                                    title="Copy OCR result"
                                    onClick={() => navigator.clipboard.writeText(r.text)}>
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                              {!isError && (
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-bold font-mono ${confColor}`}>{confPct}% conf</span>
                                  {r.reasoning && <span className="text-[10px] text-muted-foreground leading-snug flex-1">{r.reasoning}</span>}
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {/* Inline sub-zones summary — collapsible */}
                        {childZones.length > 0 && (
                          <div className="mx-3 mb-2 rounded-lg border border-violet-100 dark:border-violet-900/50 overflow-hidden">
                            <button
                              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100/70 dark:hover:bg-violet-900/40 transition-colors"
                              onClick={(e) => { e.stopPropagation(); toggleSubzoneCollapse(zone.id) }}
                            >
                              <GitBranch className="h-3 w-3 text-violet-500 shrink-0" />
                              <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 flex-1 text-left">
                                Sub-zones ({childZones.length})
                              </span>
                              <ChevronDown className={`h-3 w-3 text-violet-500 transition-transform duration-150 ${isSubzonesCollapsed ? '-rotate-90' : ''}`} />
                            </button>
                            {!isSubzonesCollapsed && (
                              <div className="divide-y divide-violet-100 dark:divide-violet-900/30">
                                {childZones.map((child) => (
                                  <div
                                    key={child.id}
                                    className="flex items-start gap-2 px-2.5 py-1.5 bg-white dark:bg-background hover:bg-violet-50/50 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPinnedZoneId(child.id); setHighlightedZoneId(child.id)
                                      navigateToZone(child.xPercent, child.yPercent, child.widthPercent, child.heightPercent, child.pageNumber ?? 1)
                                    }}
                                  >
                                    <ChevronsRight className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[11px] font-medium text-foreground truncate">{child.fieldLabel}</span>
                                        {child.claimField && (
                                          <span className="text-[10px] text-muted-foreground">→ {child.claimField}</span>
                                        )}
                                      </div>
                                      {child.locationContext && (
                                        <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5 leading-snug">{child.locationContext}</p>
                                      )}
                                      {child.searchPhrase && !child.locationContext && (
                                        <p className="text-[10px] font-mono text-violet-600 dark:text-violet-400 mt-0.5">{child.searchPhrase}</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Footer: coordinates + audit trail */}
                        {(hasDetails || childZones.length > 0 || zone.updatedByName || zone.updatedAt) && (
                          <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-xl flex-wrap">
                            <span className="text-[9px] text-muted-foreground font-mono flex-1">
                              x:{zone.xPercent.toFixed(1)}% y:{zone.yPercent.toFixed(1)}%
                              &nbsp;·&nbsp;{zone.widthPercent.toFixed(1)}×{zone.heightPercent.toFixed(1)}%
                            </span>
                            {zone.updatedByName && (
                              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                <User2 className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate max-w-[80px]">{zone.updatedByName}</span>
                              </div>
                            )}
                            {zone.updatedAt && (
                              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                <Clock className="h-2.5 w-2.5 shrink-0" />
                                <span>{new Date(zone.updatedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' })}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Collapsed-state footer (coords only, no border) */}
                      </div>
                    )}

                    {/* Collapsed footer — show coords inline when body hidden */}
                    {isCollapsed && (
                      <div className="flex items-center gap-2 px-3 pb-2 flex-wrap">
                        <span className="text-[9px] text-muted-foreground font-mono">
                          x:{zone.xPercent.toFixed(1)}% y:{zone.yPercent.toFixed(1)}%
                          &nbsp;·&nbsp;{zone.widthPercent.toFixed(1)}×{zone.heightPercent.toFixed(1)}%
                        </span>
                        {zone.updatedByName && (
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground ml-auto">
                            <User2 className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate max-w-[80px]">{zone.updatedByName}</span>
                          </div>
                        )}
                        {zone.updatedAt && (
                          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            <span>{new Date(zone.updatedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' })}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline child-zone save form — appears right below this card */}
                  {pendingZone && pendingParentZoneId === zone.id && (
                    <div className="ml-5 pl-3 border-l-2 border-violet-300 dark:border-violet-700">
                      <ZoneSaveForm
                        pending={pendingZone}
                        existingFields={existingFieldNames}
                        existingZones={template.zones.map((z) => ({ id: z.id, fieldLabel: z.fieldLabel }))}
                        initialParentZoneId={zone.id}
                        onSave={handleSaveZone}
                        onCancel={() => { setPendingZone(null); setDrawRect(null); setPendingParentZoneId(null) }}
                      />
                    </div>
                  )}

                  {childZones.length > 0 && (
                    <div className="ml-5 space-y-1.5 pl-3 border-l-2 border-indigo-200 dark:border-indigo-800">
                      {childZones.map((child) => renderCard(child))}
                    </div>
                  )}
                  </div>
                )
                }
                const zoneIds = new Set(template.zones.map((z) => z.id))
                return template.zones
                  .filter((z) => !z.parentZoneId || !zoneIds.has(z.parentZoneId))
                  .map((z) => renderCard(z))
              })()}
              </TooltipProvider>
            )}
          </div>
          </ScrollArea>

          {/* Footer hint */}
          {toolMode === 'draw' && !pendingZone && (() => {
            const parentZone = pendingParentZoneId
              ? template?.zones.find((z) => z.id === pendingParentZoneId)
              : null
            return (
              <div className={`shrink-0 border-t px-4 py-3 ${parentZone ? 'bg-violet-50 dark:bg-violet-950/30' : 'bg-indigo-50 dark:bg-indigo-950/30'}`}>
                {parentZone ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      Drawing child zone under <span className="underline">{parentZone.fieldLabel}</span>
                    </p>
                    <p className="text-[10px] text-violet-600 dark:text-violet-400 pl-5">
                      Drag on the document to mark the sub-section. The zone will be nested under {parentZone.fieldLabel}.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 font-medium">
                    <MousePointer2 className="h-3.5 w-3.5 shrink-0" />
                    Click and drag on the document to draw a zone
                  </p>
                )}
              </div>
            )
          })()}
          {toolMode === 'pan' && (
            <div className="shrink-0 border-t px-4 py-2.5 bg-muted/30">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Hand className="h-3.5 w-3.5 shrink-0" />
                Pan mode — drag the document to scroll. Click "Add Zone" to draw.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Split & Categorize dialog ── */}
      <Dialog open={splitDialogOpen} onOpenChange={(o) => { if (!o) closeSplitDialog() }}>
        <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden rounded-2xl" style={{ height: '86vh' }}>
          <DialogTitle className="sr-only">Split &amp; Categorize Document</DialogTitle>

          {/* ══ SUCCESS STATE ══ */}
          {splitResult && (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b bg-emerald-50 dark:bg-emerald-950/30 shrink-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                    {splitResult.length} document{splitResult.length !== 1 ? 's' : ''} created successfully
                  </h2>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Each part is saved. Open in the zone editor to draw fields, or view all in Documents.
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={closeSplitDialog}>
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>

              {/* Split docs list */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {splitResult.map((doc, i) => {
                  const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]
                  const isOpening = openingEditorForDoc === doc.id
                  const DOC_ICON: Record<string, string> = {
                    invoice: '🧾', inpatient_invoice: '🧾', lab_result: '🔬',
                    prescription: '💊', discharge_summary: '🏥', medical_report: '📋',
                    claim_form: '📝', pre_auth: '✅', referral: '📨', supporting: '📎',
                  }
                  const icon = DOC_ICON[doc.documentType || ''] || '📄'
                  return (
                    <div key={doc.id}
                      className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow"
                      style={{ borderLeft: `4px solid ${color}` }}
                    >
                      {/* Index badge */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white text-sm font-bold shadow-sm"
                        style={{ background: color }}>
                        {i + 1}
                      </div>

                      {/* Doc info */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                          <span>{icon}</span>
                          <span>{doc.originalName}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                          {doc.documentType?.replace(/_/g, ' ') || 'Unclassified document'}
                        </p>
                      </div>

                      {/* Open in Zone Editor */}
                      <Button
                        size="sm"
                        className="shrink-0 h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                        disabled={isOpening || !!openingEditorForDoc}
                        onClick={async () => {
                          setOpeningEditorForDoc(doc.id)
                          try {
                            const { data } = await api.post('/document-classifiers/from-document', {
                              documentId: doc.id,
                              documentType: doc.documentType || undefined,
                              name: doc.originalName,
                            })
                            closeSplitDialog()
                            navigate(`/settings/document-classifiers/${data.templateId}?from=unknown-docs`)
                          } catch (err: any) {
                            toast.error('Could not open zone editor', { description: err?.response?.data?.message || err.message })
                          } finally {
                            setOpeningEditorForDoc(null)
                          }
                        }}
                      >
                        {isOpening
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening…</>
                          : <><Square className="h-3.5 w-3.5" /> Open Zone Editor</>
                        }
                      </Button>
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div className="border-t px-5 py-3.5 bg-background shrink-0 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  All {splitResult.length} document{splitResult.length !== 1 ? 's are' : ' is'} saved and available in Documents.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8" onClick={closeSplitDialog}>Close</Button>
                  <Button size="sm" className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => { closeSplitDialog(); navigate('/documents') }}>
                    <FileText className="h-3.5 w-3.5" /> View All in Documents
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ══ MAIN SPLIT UI ══ */}
          {!splitResult && (
            <div className="flex flex-col h-full overflow-hidden">

              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-3.5 border-b bg-background shrink-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40 shrink-0">
                  <Scissors className="h-4.5 w-4.5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-tight">Split &amp; Categorize</h2>
                  <p className="text-[11px] text-muted-foreground leading-tight truncate max-w-xs">
                    {template?.sampleFileName} · {pageCount} page{pageCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-auto shrink-0">
                  {analysisDone && (
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {splitRanges.length} section{splitRanges.length !== 1 ? 's' : ''} identified
                    </span>
                  )}
                  <Button size="sm"
                    onClick={handleAnalyzePages}
                    disabled={analyzingPages}
                    className="h-8 gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {analyzingPages
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
                      : <><Sparkles className="h-3.5 w-3.5" /> {analysisDone ? 'Re-analyze' : 'Auto-Categorize with AI'}</>
                    }
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => { setSplitDialogOpen(false); setAnalysisDone(false) }}>
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Two-panel body */}
              <div className="flex flex-1 overflow-hidden min-h-0">

                {/* ── Left: Page thumbnails ── */}
                <div className="w-[48%] border-r flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900/30">
                  <div className="px-4 py-2 border-b bg-background/60 shrink-0 flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Pages
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Colour = section assignment
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {thumbsLoading ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <p className="text-xs">Rendering previews…</p>
                      </div>
                    ) : thumbnails.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                        <FileText className="h-10 w-10 opacity-20" />
                        <p className="text-xs">No preview available</p>
                      </div>
                    ) : (
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                        {thumbnails.map((thumb, i) => {
                          const page = i + 1
                          const segIdx = getPageSegmentIdx(page)
                          const color = segIdx >= 0 ? SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length] : '#94a3b8'
                          return (
                            <div key={i} className="flex flex-col items-center gap-1.5">
                              <div
                                className="relative rounded-lg overflow-hidden shadow-md transition-all hover:scale-[1.03] hover:shadow-lg cursor-default w-full"
                                style={{ border: `2.5px solid ${color}` }}
                              >
                                {/* Top colour strip */}
                                <div style={{ height: 5, background: color, width: '100%' }} />
                                {thumb ? (
                                  <img src={thumb} alt={`p${page}`}
                                    style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                                ) : (
                                  <div style={{ aspectRatio: '3/4' }} className="flex items-center justify-center bg-muted/30">
                                    <FileText className="h-5 w-5 text-muted-foreground/30" />
                                  </div>
                                )}
                                {/* Section number badge */}
                                {segIdx >= 0 && (
                                  <div className="absolute top-1.5 right-1.5 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm"
                                    style={{ background: color, width: 18, height: 18 }}>
                                    {segIdx + 1}
                                  </div>
                                )}
                              </div>
                              <span className="text-[10px] tabular-nums font-semibold" style={{ color }}>p.{page}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Right: Section editor ── */}
                <div className="flex-1 flex flex-col overflow-hidden bg-background">
                  {/* Sub-header */}
                  <div className="px-4 py-2 border-b bg-background/60 shrink-0 flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Sections · {splitRanges.length}
                    </p>
                    <button
                      className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors"
                      onClick={() => setSplitRanges(prev => [...prev, {
                        start: Math.max(1, (prev[prev.length - 1]?.end ?? 0) + 1),
                        end: pageCount,
                        name: `section_${prev.length + 1}`,
                      }])}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Section
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {(() => {
                      const DOC_TYPES = [
                        { value: 'invoice',            label: 'Invoice / Bill',      icon: '🧾' },
                        { value: 'lab_result',         label: 'Lab Results',         icon: '🔬' },
                        { value: 'prescription',       label: 'Prescription',        icon: '💊' },
                        { value: 'discharge_summary',  label: 'Discharge Summary',   icon: '🏥' },
                        { value: 'medical_report',     label: 'Medical Report',      icon: '📋' },
                        { value: 'claim_form',         label: 'Claim Form',          icon: '📝' },
                        { value: 'medical_claim_form', label: 'Medical Claim Form',  icon: '🏨' },
                        { value: 'pre_auth',           label: 'Pre-Authorization',   icon: '✅' },
                        { value: 'referral',           label: 'Referral Letter',     icon: '📨' },
                        { value: 'supporting',         label: 'Supporting Document', icon: '📎' },
                      ]

                      if (splitRanges.length === 0) return (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground py-16">
                          <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                            <Scissors className="h-7 w-7 opacity-30" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">No sections yet</p>
                            <p className="text-xs mt-1 text-muted-foreground/70 max-w-[200px]">
                              Click <strong>Auto-Categorize with AI</strong> or add sections manually
                            </p>
                          </div>
                        </div>
                      )

                      return splitRanges.map((range, i) => {
                        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]
                        const docType = DOC_TYPES.find(d => d.value === range.documentType)
                        const pageCount2 = Math.max(0, range.end - range.start + 1)
                        return (
                          <div key={i} className="rounded-xl border bg-card shadow-sm overflow-hidden"
                            style={{ borderLeft: `4px solid ${color}` }}>

                            {/* Card header */}
                            <div className="flex items-center gap-3 px-4 pt-3 pb-2">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white text-xs font-bold"
                                style={{ background: color }}>
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold leading-tight">
                                  {docType ? `${docType.icon} ${docType.label}` : (
                                    <span className="text-muted-foreground font-normal italic">Select a document type…</span>
                                  )}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {pageCount2} page{pageCount2 !== 1 ? 's' : ''} · p.{range.start}–{range.end}
                                </p>
                              </div>
                              {splitRanges.length > 1 && (
                                <button
                                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                  onClick={() => setSplitRanges(prev => prev.filter((_, j) => j !== i))}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Card body */}
                            <div className="px-4 pb-4 space-y-2.5">
                              {/* Document type selector */}
                              <Select
                                value={range.documentType || ''}
                                onValueChange={(v) => { const u = [...splitRanges]; u[i] = { ...u[i], documentType: v }; setSplitRanges(u) }}
                              >
                                <SelectTrigger className="h-9 text-xs border-muted-foreground/20 focus:ring-violet-400">
                                  <SelectValue placeholder="Select document type…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {DOC_TYPES.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                      <span className="mr-1.5">{opt.icon}</span>{opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {/* Page range + filename row */}
                              <div className="flex items-center gap-2">
                                {/* Page range pill */}
                                <div className="flex items-center gap-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 shrink-0">
                                  <span className="text-[10px] text-muted-foreground font-medium">p.</span>
                                  <input type="number" min={1} max={pageCount} value={range.start}
                                    onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], start: +e.target.value || 1 }; setSplitRanges(u) }}
                                    className="w-8 text-center text-xs bg-transparent border-none outline-none font-mono tabular-nums" />
                                  <span className="text-muted-foreground text-xs font-medium">–</span>
                                  <input type="number" min={1} max={pageCount} value={range.end}
                                    onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], end: +e.target.value || 1 }; setSplitRanges(u) }}
                                    className="w-8 text-center text-xs bg-transparent border-none outline-none font-mono tabular-nums" />
                                </div>
                                {/* Filename */}
                                <input
                                  value={range.name}
                                  onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], name: e.target.value }; setSplitRanges(u) }}
                                  placeholder="Output file name…"
                                  className="h-9 flex-1 text-xs rounded-lg border border-input bg-muted/30 px-3 focus:outline-none focus:ring-1 focus:ring-violet-400 placeholder:text-muted-foreground/50"
                                />
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>

                  {/* Footer */}
                  <div className="border-t px-4 py-3.5 bg-background shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {splitRanges.map((r, i) => (
                            <div key={i} className="h-1.5 rounded-full"
                              style={{
                                width: 20,
                                background: r.documentType ? SEGMENT_COLORS[i % SEGMENT_COLORS.length] : '#e2e8f0'
                              }} />
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {splitRanges.filter(r => r.documentType).length}/{splitRanges.length} categorized
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="h-8"
                          onClick={() => { setSplitDialogOpen(false); setAnalysisDone(false) }}>
                          Cancel
                        </Button>
                        <Button size="sm" className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                          onClick={handleSplitSample}
                          disabled={splittingDocs || splitRanges.length === 0}>
                          {splittingDocs
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                            : <><Scissors className="h-3.5 w-3.5" /> Split &amp; Create {splitRanges.length} Doc{splitRanges.length !== 1 ? 's' : ''}</>
                          }
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
