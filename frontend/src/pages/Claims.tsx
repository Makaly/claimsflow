import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { downloadXlsx } from '@/lib/xlsx-export'
import { saveAs } from 'file-saver'
import {
  Search, Plus, Eye, EyeOff, MoreHorizontal, Download, Filter,
  FileText, ChevronLeft, ChevronRight, Upload, X, XCircle,
  Sparkles, Loader2, CheckCircle, File as FileIcon, Paperclip,
  Brain, AlertCircle, SlidersHorizontal, Trash2, CheckSquare, Square,
  ChevronDown, ChevronRight as ChevronRightIcon, Layers, User, Building2,
  Package, Users, Hash, Calendar, DollarSign, AlertTriangle, Send,
  BarChart3, TrendingUp, CheckCircle2, Clock, XCircle as XCircleIcon,
  FileSpreadsheet, FileDown, Printer, GripVertical, Settings2, RotateCcw,
  ScanLine, Tag, Pencil, History, Check, Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCurrency, formatDate, formatRelativeDate, getStatusColor, getPriorityColor, sanitizeMemberField } from '@/lib/utils'
import { useClaimsStore, type ClaimRecord, generateSystemBarcode } from '@/store/claimsStore'
import { useAuthStore } from '@/store/authStore'
import { stampBarcodeOnPdf, stampBarcodeOnImage } from '@/lib/pdfBarcode'
import { extractInvoicesFromPdf } from '@/lib/pdfTextExtract'
import { cacheFile, restoreAsFiles, restoreFileByName } from '@/lib/fileCache'
import { DocumentViewer } from '@/components/DocumentViewer'
import { EligibilityBadge } from '@/components/EligibilityBadge'
import { CoverageBreakdown } from '@/components/CoverageBreakdown'
import AnomalyScoreBadge from '@/components/AnomalyScoreBadge'
import { Pagination } from '@/components/Pagination'
import {
  Annotation as UserAnnotation,
  loadSigImage,
  renderAnnotations,
} from '@/components/annotations/renderer'
import api from '@/services/api'

type DocFile = ClaimRecord['documents'][number]


interface AiExtractionResult {
  memberName: string; memberNumber: string; patientId: string; provider: string
  invoiceAmount: string; invoiceNumber: string; invoiceDate: string
  diagnosis: string; diagnosisCode: string; procedureCode: string
  dateOfService: string; treatment: string
}

interface FormData {
  memberName: string; memberNumber: string; patientId: string; provider: string
  invoiceAmount: string; invoiceNumber: string; invoiceDate: string
  serviceDate: string; diagnosis: string; diagnosisCode: string
  procedureCode: string; treatment: string; priority: string; notes: string
}

interface FormErrors {
  memberName?: string; provider?: string; invoiceAmount?: string
}

const EMPTY_FORM: FormData = {
  memberName: '', memberNumber: '', patientId: '', provider: '',
  invoiceAmount: '', invoiceNumber: '', invoiceDate: '', serviceDate: '',
  diagnosis: '', diagnosisCode: '', procedureCode: '', treatment: '',
  priority: 'normal', notes: '',
}

const PROVIDERS = [
  'Nairobi Hospital', 'Aga Khan University Hospital', 'MP Shah Hospital',
  'Karen Hospital', 'Kenyatta National Hospital', "Gertrude Children's Hospital",
  'Avenue Hospital', 'Mater Hospital', "Nairobi Women's Hospital",
  'Coptic Hospital', 'Metropolitan Hospital', 'Other',
]

interface ColumnDef { id: string; label: string; visible: boolean }
const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'claim_number', label: 'Claim #', visible: true },
  { id: 'member',       label: 'Member',  visible: true },
  { id: 'provider',     label: 'Provider',visible: true },
  { id: 'amount',       label: 'Amount',  visible: true },
  { id: 'type',         label: 'Type',    visible: true },
  { id: 'fraud',        label: 'Fraud',   visible: true },
  { id: 'priority',     label: 'Priority',visible: true },
  { id: 'status',       label: 'Status',  visible: true },
  { id: 'docs',         label: 'Docs',    visible: true },
  { id: 'date',         label: 'Date',    visible: true },
  { id: 'eligibility',  label: 'Eligibility', visible: true },
  { id: 'anomaly',      label: 'Anomaly', visible: true },
]
const COLUMNS_STORAGE_KEY = 'claimsflow_column_config'

// Real AI extraction
const extractFromFile = async (file: File): Promise<AiExtractionResult> => {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const result = await extractInvoicesFromPdf(file)
      const inv = result.invoices[0]
      return {
        memberName: inv.patientName, memberNumber: inv.membershipNumber || '',
        patientId: inv.patientId || '', provider: inv.providerName,
        invoiceAmount: String(inv.invoiceAmount), invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate, diagnosis: inv.diagnosis,
        diagnosisCode: inv.diagnosisCode, procedureCode: inv.procedureCode,
        dateOfService: inv.serviceDate || inv.invoiceDate, treatment: inv.treatment,
      }
    } catch {}
  }
  return {
    memberName: '', memberNumber: '', patientId: '', provider: '',
    invoiceAmount: '0', invoiceNumber: '', invoiceDate: '', diagnosis: '',
    diagnosisCode: '', procedureCode: '', dateOfService: '', treatment: '',
  }
}

// Batch grouping helper
interface BatchGroup {
  batchId: string
  batchNumber: string
  uploadedBy: string
  submittedAt: string
  claims: ClaimRecord[]
  providers: string[]
  totalAmount: number
  isMixed: boolean
}

function buildBatchGroups(claims: ClaimRecord[]): BatchGroup[] {
  const map = new Map<string, ClaimRecord[]>()
  for (const c of claims) {
    const key = c.batchNumber || c.batchId
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return Array.from(map.entries()).map(([key, batchClaims]) => {
    const providers = Array.from(new Set(batchClaims.map(c => c.provider?.name).filter(Boolean)))
    const first = batchClaims[0]
    return {
      batchId: key,
      batchNumber: first.batchNumber || key,
      uploadedBy: first.uploadedBy || 'Unknown',
      submittedAt: first.submittedAt,
      claims: batchClaims.sort((a, b) => (a.provider?.name || '').localeCompare(b.provider?.name || '')),
      providers,
      totalAmount: batchClaims.reduce((s, c) => s + (c.invoiceAmount || 0), 0),
      isMixed: providers.length > 1,
    }
  }).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
}

interface OcrAnnotation {
  page: number
  label: string
  value: string
  confidence?: number
  bbox?: { x: number; y: number; w: number; h: number }
  anomaly?: boolean
}

// ── Lightweight inline PDF renderer ────────────────────────────────────────
// ── Lightweight inline PDF renderer ────────────────────────────────────────
// IMPORTANT: This component must be used with a `key` prop set to the document
// name/id so it fully remounts when the document changes. It captures `bytes`
// and `url` at mount time via refs and never re-reads the props after that —
// this prevents "detached ArrayBuffer" errors because pdfjs transfers the
// ArrayBuffer ownership when loading, making the original unusable for future
// reads. By capturing once we own the copy; subsequent renders are safe.
function InlinePdfViewer({
  bytes, url, onFullScreen, annotations: annotationsProp = [], fraudSignalCount = 0,
  claimId,
}: {
  bytes: Uint8Array | null
  url: string | null
  onFullScreen: () => void
  annotations?: OcrAnnotation[]
  fraudSignalCount?: number
  claimId?: string
}) {
  const srcRef = useRef<{ data: Uint8Array } | { url: string } | null>(
    bytes ? { data: bytes.slice() }
    : url  ? { url }
    : null
  )
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const annotOverlayRef = useRef<HTMLCanvasElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const mountedRef    = useRef(true)

  const [pdfDoc,      setPdfDoc]      = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [page,        setPage]        = useState(1)
  const [totalPages,  setTotalPages]  = useState(0)
  const [scale,       setScale]       = useState(1)
  const [canvasDims,  setCanvasDims]  = useState<{ w: number; h: number } | null>(null)

  const [annotations,      setAnnotations]      = useState<OcrAnnotation[]>(annotationsProp)
  const [showAnnotations,  setShowAnnotations]  = useState(true)
  const [activeAnnotIdx,   setActiveAnnotIdx]   = useState(-1)

  // User-drawn annotations (signatures, stamps, highlights, drawings) saved
  // by the full-screen DocumentViewer and stored on Claim.annotations. Loaded
  // here so the preview shows what the reviewer already signed.
  const [userAnnotations, setUserAnnotations] = useState<UserAnnotation[]>([])

  // Flash-highlight box drawn when a field pill is clicked and we locate the
  // value in the PDF text. Auto-clears after a few seconds so it doesn't stay
  // painted over the document.
  const [flashBox, setFlashBox] = useState<{ page: number; x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    if (!srcRef.current) return
    const task = pdfjsLib.getDocument(srcRef.current)
    task.promise
      .then(doc => { if (mountedRef.current) { setPdfDoc(doc); setTotalPages(doc.numPages) } })
      .catch(() => {})
    return () => {
      mountedRef.current = false
      task.destroy()
      renderTaskRef.current?.cancel()
    }
  }, [])

  useLayoutEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current || !mountedRef.current) return
    renderTaskRef.current?.cancel()
    const pageNum = page
    pdfDoc.getPage(pageNum).then(pg => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container || !mountedRef.current) return
      const containerW = container.clientWidth || 600
      const vp0 = pg.getViewport({ scale: 1 })
      const fit = containerW / vp0.width
      const vp  = pg.getViewport({ scale: fit * scale })
      canvas.width  = vp.width
      canvas.height = vp.height
      setCanvasDims({ w: vp.width, h: vp.height })
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const rt = pg.render({ canvasContext: ctx, viewport: vp })
      renderTaskRef.current = rt
      rt.promise.catch(() => {})
    }).catch(() => {})
  }, [pdfDoc, page, scale])

  useEffect(() => { setAnnotations(annotationsProp) }, [annotationsProp])

  // Load user-drawn annotations from the DB when claimId is a valid UUID.
  useEffect(() => {
    if (!claimId) return
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId)
    if (!isUuid) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get(`/claims/${claimId}/annotations`)
        if (cancelled) return
        const list = Array.isArray(data?.annotations) ? (data.annotations as UserAnnotation[]) : []
        setUserAnnotations(list)
      } catch { /* ignore — preview keeps working without user annotations */ }
    })()
    return () => { cancelled = true }
  }, [claimId])

  // Preload signature images so the overlay renderer can draw them synchronously.
  useEffect(() => {
    if (!showAnnotations) return
    userAnnotations.forEach(a => {
      if (a.type === 'sign' && a.signatureDataUrl) {
        loadSigImage(a.signatureDataUrl, () => {
          // Re-render the overlay once the image is ready.
          const ov = annotOverlayRef.current
          if (!ov || !canvasDims) return
          const ctx = ov.getContext('2d')
          if (!ctx) return
          renderAnnotations(ctx, userAnnotations, page, canvasDims.w / 600, canvasDims.h / 800)
        })
      }
    })
  }, [userAnnotations, canvasDims, page, showAnnotations])

  // Draw the user-annotation overlay whenever page/canvas/annotations change
  // OR when the Annotations toggle flips back on (the canvas is unmounted when
  // hidden, so the effect must re-run against the freshly-mounted element).
  useEffect(() => {
    if (!showAnnotations) return
    const ov = annotOverlayRef.current
    if (!ov || !canvasDims) return
    ov.width = canvasDims.w
    ov.height = canvasDims.h
    const ctx = ov.getContext('2d')
    if (!ctx) return
    // DocumentViewer stores coordinates against a 2× CSS pixel canvas (see
    // DL_SCALE / zoom handling); the inline preview canvas is sized directly
    // to the rendered PDF viewport, so we scale 1:1 against canvasDims.
    renderAnnotations(ctx, userAnnotations, page, canvasDims.w / 600, canvasDims.h / 800)
  }, [userAnnotations, canvasDims, page, showAnnotations])

  if (!srcRef.current) return null

  const pageAnnotations = annotations.filter(a => !a.page || a.page === page)
  const hasAnnotations  = annotations.length > 0 || userAnnotations.length > 0

  const goAnnotation = (delta: number) => {
    const newIdx = Math.max(0, Math.min(annotations.length - 1, activeAnnotIdx + delta))
    setActiveAnnotIdx(newIdx)
    const a = annotations[newIdx]
    if (a?.page) setPage(a.page)
  }

  // Click a field pill → navigate to the page where the value was OCR'd, locate
  // the text via pdf.js, and flash a highlight box over it. OCR-extracted values
  // are normalised (ISO dates, stripped currency, etc.) while the PDF text
  // layer shows the invoice's original formatting, so we generate a handful of
  // candidate needles per value and search a normalised concatenation of each
  // page's text items.
  const jumpToFieldValue = useCallback(async (a: OcrAnnotation) => {
    const idx = annotations.indexOf(a)
    if (idx >= 0) setActiveAnnotIdx(idx)
    if (!pdfDoc) return

    const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const MONTHS_LONG  = ['january','february','march','april','may','june','july','august','september','october','november','december']
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    // Build likely surface forms of this value that might appear in the PDF.
    const buildCandidates = (raw: string): string[] => {
      const v = raw.trim()
      if (!v) return []
      const out = new Set<string>([v])

      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
      if (iso) {
        const [, y, m, d] = iso
        const mi = parseInt(m, 10) - 1
        if (mi >= 0 && mi < 12) {
          const ms = MONTHS_SHORT[mi]
          const ml = MONTHS_LONG[mi]
          const dd = d
          const ddN = String(parseInt(d, 10))
          // Most common invoice date formats in Kenya
          out.add(`${dd}-${ms}-${y}`)
          out.add(`${ddN}-${ms}-${y}`)
          out.add(`${dd} ${ms} ${y}`)
          out.add(`${ddN} ${ms} ${y}`)
          out.add(`${dd}/${m}/${y}`)
          out.add(`${ddN}/${m}/${y}`)
          out.add(`${m}/${dd}/${y}`)
          out.add(`${dd}-${m}-${y}`)
          out.add(`${ms} ${dd}, ${y}`)
          out.add(`${ml} ${dd}, ${y}`)
          out.add(`${dd}${ms}${y}`)
          out.add(`${ms}${dd}${y}`)
          out.add(`${dd}${m}${y}`)
          out.add(`${m}${dd}${y}`)
        }
      }

      // Money/number: "KES 9,964.68" or "Ksh 8,500.00" — try each numeric token.
      const nums = v.match(/[\d.,]+/g)
      if (nums) {
        for (const n of nums) {
          out.add(n)
          out.add(n.replace(/,/g, ''))
          const whole = n.split('.')[0].replace(/,/g, '')
          if (whole.length >= 3) out.add(whole)
        }
      }

      // ID-ish values: "MZM2024/02-19" — also try without separators.
      const alnum = v.replace(/[^a-zA-Z0-9]/g, '')
      if (alnum && alnum !== v) out.add(alnum)

      return [...out].filter(Boolean)
    }

    type Hit = { page: number; x: number; y: number; w: number; h: number }
    const findOnPage = async (pageNum: number, candidates: string[]): Promise<Hit | null> => {
      const pg = await pdfDoc.getPage(pageNum)
      const viewport = pg.getViewport({ scale: 1 })
      const textContent = await pg.getTextContent()
      const items = (textContent.items as any[]).filter(it => (it.str || '').trim())
      // Build normalised concatenation with offsets mapping back to items.
      let big = ''
      const offsets: { start: number; end: number; item: any }[] = []
      for (const item of items) {
        const n = norm(item.str)
        if (!n) continue
        offsets.push({ start: big.length, end: big.length + n.length, item })
        big += n
      }
      for (const cand of candidates) {
        const nc = norm(cand)
        if (!nc || nc.length < 2) continue
        const idx = big.indexOf(nc)
        if (idx < 0) continue
        const endIdx = idx + nc.length
        const first = offsets.find(o => o.end > idx)
        const last  = [...offsets].reverse().find(o => o.start < endIdx)
        if (!first || !last) continue
        const [, , , , fx, fy] = first.item.transform as number[]
        const [, , , , lx, ly] = last.item.transform as number[]
        const h = Math.max(first.item.height || 12, last.item.height || 12)
        const lastRight = lx + (last.item.width || 40)
        // Multi-line hits can have fy !== ly; expand vertically to cover both.
        const topY = Math.min(fy, ly)
        const botY = Math.max(fy, ly) + h
        return {
          page: pageNum,
          x: fx - 2,
          y: viewport.height - botY - 2,
          w: Math.max(lastRight - fx, 20) + 4,
          h: (botY - topY) + 4,
        }
      }
      return null
    }

    const candidates = buildCandidates(a.value || '')
    if (!candidates.length) return

    try {
      // Try the page we think holds the value first, then scan the rest.
      const preferred = a.page || 1
      const pageOrder = [preferred]
      for (let p = 1; p <= totalPages; p++) if (p !== preferred) pageOrder.push(p)

      let hit: Hit | null = null
      for (const p of pageOrder) {
        hit = await findOnPage(p, candidates)
        if (hit) break
      }
      if (!hit) {
        setPage(preferred)
        // Check if the PDF has any text at all — if not, it's a scan
        const pg0 = await pdfDoc.getPage(preferred)
        const tc = await pg0.getTextContent()
        const hasText = (tc.items as any[]).some(it => it.str?.trim())
        if (!hasText) {
          toast.info(`"${a.label}" — location unavailable (scanned document)`, { duration: 3000 })
        } else {
          toast.info(`"${a.label}: ${a.value}" not found on this page`, { duration: 3000 })
        }
        return
      }
      setPage(hit.page)
      // Wait one frame for the page render to resize the canvas, then translate
      // PDF coords → canvas coords using the current viewport.
      requestAnimationFrame(async () => {
        const pg = await pdfDoc.getPage(hit!.page)
        const vp = pg.getViewport({ scale: 1 })
        const dims = canvasRef.current
          ? { w: canvasRef.current.width, h: canvasRef.current.height }
          : canvasDims
        if (!dims) return
        const scaleX = dims.w / vp.width
        const scaleY = dims.h / vp.height
        setFlashBox({
          page: hit!.page,
          x: hit!.x * scaleX,
          y: hit!.y * scaleY,
          w: hit!.w * scaleX,
          h: hit!.h * scaleY,
        })
        const container = containerRef.current
        if (container) {
          container.scrollTo({ top: Math.max(0, hit!.y * scaleY - 80), behavior: 'smooth' })
        }
        setTimeout(() => setFlashBox(null), 5000)
      })
    } catch { /* text extraction failed — page navigation alone is our best effort */ }
  }, [pdfDoc, canvasDims, annotations, totalPages])

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-background shrink-0 flex-wrap">
        {/* Page nav */}
        <div className="flex items-center gap-0.5">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums px-0.5">{page} / {totalPages || '…'}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Next page">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="w-px h-3 bg-border" />
        {/* Zoom */}
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="rounded px-1 py-0.5 hover:bg-muted text-xs font-bold" title="Zoom out">−</button>
          <span className="text-xs text-muted-foreground w-8 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale(s => Math.min(3, s + 0.25))}
            className="rounded px-1 py-0.5 hover:bg-muted text-xs font-bold" title="Zoom in">+</button>
        </div>

        {/* Annotation navigation */}
        {hasAnnotations && (
          <>
            <span className="w-px h-3 bg-border" />
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => goAnnotation(-1)} disabled={activeAnnotIdx <= 0}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Previous field">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums px-0.5 whitespace-nowrap">
                {activeAnnotIdx >= 0 ? `${activeAnnotIdx + 1} / ${annotations.length} fields` : `${annotations.length} fields`}
              </span>
              <button type="button" onClick={() => goAnnotation(1)} disabled={activeAnnotIdx >= annotations.length - 1}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Next field">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Annotation toggle */}
          {hasAnnotations && (
            <button
              type="button"
              onClick={() => setShowAnnotations(v => !v)}
              title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border transition-colors ${
                showAnnotations
                  ? 'bg-blue-500/10 border-blue-400/40 text-blue-600 dark:text-blue-400'
                  : 'bg-muted border-transparent text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {showAnnotations ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              <span>{showAnnotations ? 'Annotations' : 'Hidden'}</span>
            </button>
          )}
          {/* Fraud pill */}
          {fraudSignalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/10 border border-red-400/30 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" /> {fraudSignalCount} signal{fraudSignalCount !== 1 ? 's' : ''}
            </span>
          )}
          <button type="button" onClick={onFullScreen}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted hover:bg-muted/80 border border-transparent">
            <Eye className="h-3 w-3" /> Full view
          </button>
        </div>
      </div>

      {/* ── Canvas + SVG annotation overlay ── */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-2 bg-muted/30">
        {pdfDoc
          ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <canvas ref={canvasRef} className="shadow-md rounded max-w-full block" />
              {/* User-drawn annotations (stamps, sigs, highlights) loaded from the DB. */}
              {showAnnotations && canvasDims && userAnnotations.length > 0 && (
                <canvas
                  ref={annotOverlayRef}
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: canvasDims.w, height: canvasDims.h,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Flash highlight drawn when a field pill is clicked and we locate
                  its value in the PDF text. Layered above the PDF, below user
                  annotation overlay. */}
              {canvasDims && flashBox && flashBox.page === page && (
                <svg
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: canvasDims.w, height: canvasDims.h,
                    pointerEvents: 'none',
                    overflow: 'visible',
                  }}
                >
                  {/* Pulsing backdrop so the hit catches the eye */}
                  <rect
                    x={flashBox.x - 4} y={flashBox.y - 4}
                    width={flashBox.w + 8} height={flashBox.h + 8}
                    fill="rgba(250, 204, 21, 0.20)"
                    stroke="#f59e0b"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    rx={4}
                  >
                    <animate attributeName="opacity" values="1;0.35;1;0.35;1;0.35;1" dur="4s" repeatCount="1" />
                  </rect>
                  {/* Solid highlight on the word itself */}
                  <rect
                    x={flashBox.x} y={flashBox.y}
                    width={flashBox.w} height={flashBox.h}
                    fill="rgba(250, 204, 21, 0.45)"
                    stroke="#ca8a04"
                    strokeWidth={2}
                    rx={2}
                  />
                  {/* Arrow pointing at the word from the left margin */}
                  <g transform={`translate(${Math.max(2, flashBox.x - 28)}, ${flashBox.y + flashBox.h / 2})`}>
                    <polygon points="0,-7 18,0 0,7" fill="#ca8a04" opacity="0.9">
                      <animateTransform attributeName="transform" type="translate"
                        values="-6 0; 0 0; -6 0; 0 0; -6 0" dur="1.8s" repeatCount="indefinite" />
                    </polygon>
                  </g>
                </svg>
              )}
              {showAnnotations && canvasDims && pageAnnotations.filter(a => !!a.bbox).length > 0 && (
                <svg
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: canvasDims.w, height: canvasDims.h,
                    pointerEvents: 'none',
                  }}
                >
                  {pageAnnotations.filter(a => !!a.bbox).map((a, i) => {
                    const gIdx = annotations.indexOf(a)
                    const isActive = gIdx === activeAnnotIdx
                    const bx = a.bbox!.x * canvasDims.w
                    const by = a.bbox!.y * canvasDims.h
                    const bw = a.bbox!.w * canvasDims.w
                    const bh = a.bbox!.h * canvasDims.h
                    const color = a.anomaly ? '#ef4444' : isActive ? '#6366f1' : '#3b82f6'
                    const fillOpacity = isActive ? 0.28 : a.anomaly ? 0.18 : 0.12
                    const labelW = a.label.length * 5.5 + 8
                    const labelY = by > 16 ? by - 14 : by + bh + 2
                    return (
                      <g key={i}>
                        <rect x={bx} y={by} width={bw} height={bh}
                          fill={color} fillOpacity={fillOpacity}
                          stroke={color} strokeWidth={isActive ? 2 : 1.5}
                          strokeDasharray={a.anomaly ? '3 2' : undefined}
                          rx="2" />
                        <rect x={bx} y={labelY} width={Math.max(labelW, 30)} height={13} fill={color} rx="2" />
                        <text x={bx + 4} y={labelY + 9}
                          fontSize="8" fill="white" fontFamily="ui-sans-serif,system-ui,sans-serif" fontWeight="600">
                          {a.label}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              )}
            </div>
          )
          : (
            <div className="flex items-center gap-2 text-muted-foreground m-auto">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          )
        }
      </div>

      {/* ── Annotation field strip ── */}
      {showAnnotations && hasAnnotations && (
        <div className="shrink-0 border-t bg-background">
          <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto">
            <ScanLine className="h-3 w-3 text-muted-foreground shrink-0 mr-1" />
            {annotations.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jumpToFieldValue(a)}
                title={`${a.label}: ${a.value}${a.confidence !== undefined ? ` (${(a.confidence * 100).toFixed(0)}%)` : ''} — click to locate in document`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium border whitespace-nowrap transition-colors shrink-0 ${
                  i === activeAnnotIdx
                    ? 'bg-blue-500 text-white border-blue-500'
                    : a.anomaly
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40'
                    : 'bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {a.anomaly && <AlertTriangle className="h-2 w-2 shrink-0" />}
                <span className="opacity-70 mr-0.5">{a.label}:</span>
                <span className="font-semibold max-w-[72px] truncate">{a.value}</span>
                {a.confidence !== undefined && (
                  <span className={`opacity-50 ml-0.5 ${a.confidence < 0.7 ? 'text-amber-500 opacity-100' : ''}`}>
                    {(a.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function claimNumSubseq(claimNumber: string, query: string): boolean {
  const hay = claimNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
  const ndl = query.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!ndl) return true
  if (hay.includes(ndl)) return true
  let hi = 0
  for (let ni = 0; ni < ndl.length; ni++) {
    while (hi < hay.length && hay[hi] !== ndl[ni]) hi++
    if (hi >= hay.length) return false
    hi++
  }
  return true
}

export default function Claims() {
  const { claims, addClaim, deleteClaim, deleteClaims, fetchFromServer } = useClaimsStore()
  const { user } = useAuthStore()

  const [searchParams, setSearchParams] = useSearchParams()

  // Always re-fetch on mount so any claims published from BatchUpload (which were
  // temporarily stored with a frontend-generated id) get replaced with the correct
  // DB UUID — required for DocumentViewer to load annotations via the right claim id.
  useEffect(() => { fetchFromServer() }, [])

  // Auto-open a claim when navigated here with ?open=<claimNumber> (e.g. from Reports fraud table).
  // Uses a ref to hold the pending target so it survives fetchFromServer replacing the store.
  const pendingOpenRef = useRef<string | null>(null)
  useEffect(() => {
    const openId = searchParams.get('open')
    if (openId) {
      pendingOpenRef.current = openId
      setSearchParams(prev => { prev.delete('open'); return prev }, { replace: true })
    }
  }, [searchParams])

  useEffect(() => {
    const target = pendingOpenRef.current
    if (!target || claims.length === 0) return
    const match = claims.find(c => c.claimNumber === target || c.id === target)
    if (match) {
      pendingOpenRef.current = null
      setSelectedClaim(match)
    }
  }, [claims])

  // List state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [claimsPage, setClaimsPage] = useState(1)
  const [claimsPageSize, setClaimsPageSize] = useState(20)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [denialClaim, setDenialClaim] = useState<ClaimRecord | null>(null)
  const [denialNote, setDenialNote] = useState('')
  const [sendingDenial, setSendingDenial] = useState(false)
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  // Derive selectedClaim live from the store so it always has the current id (DB UUID)
  // after fetchFromServer replaces frontend-generated ids.
  const selectedClaim = selectedClaimId ? (claims.find(c => c.id === selectedClaimId) ?? null) : null
  const setSelectedClaim = useCallback((claim: ClaimRecord | null) => {
    setSelectedClaimId(claim?.id ?? null)
    // Auto-select first document with a URL when claim is opened
    const firstDoc = claim?.documents.find(d => d.url) ?? null
    setViewingDoc(firstDoc)
    setViewerOpen(false)
    if (!firstDoc) { setViewerUrl(null); setViewerBytes(null); setViewerReady(false) }
  }, [])
  const [viewingDoc, setViewingDoc] = useState<DocFile | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewerBytes, setViewerBytes] = useState<Uint8Array | null>(null)
  const [viewerReady, setViewerReady] = useState(false)   // true once IDB lookup completes
  const [viewerOpen, setViewerOpen] = useState(false)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)

  // Column customizer
  const [columnDefs, setColumnDefs] = useState<ColumnDef[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY)
      if (saved) {
        const parsed: ColumnDef[] = JSON.parse(saved)
        // Merge: add any new default columns not yet in saved config
        const savedIds = new Set(parsed.map(c => c.id))
        const merged = [...parsed, ...DEFAULT_COLUMNS.filter(d => !savedIds.has(d.id))]
        return merged
      }
    } catch {}
    return DEFAULT_COLUMNS
  })
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false)
  const [dragColIdx, setDragColIdx] = useState<number | null>(null)

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnDefs))
  }, [columnDefs])

  const visibleCols = columnDefs.filter(c => c.visible)

  // Draggable tab order
  const ALL_TAB_IDS = ['all', 'batches', 'single', 'branches']
  const TAB_ORDER_KEY = 'claimsflow_tab_order'
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || '[]')
      if (Array.isArray(saved) && saved.length > 0) {
        const merged = [...saved, ...ALL_TAB_IDS.filter(id => !saved.includes(id))]
        return merged
      }
    } catch {}
    return ALL_TAB_IDS
  })
  const [dragTabIdx, setDragTabIdx] = useState<number | null>(null)

  useEffect(() => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrder))
  }, [tabOrder])

  // Resolve the viewer source whenever the active document changes.
  //   • API URLs (/api/...)  → fetch with auth → Uint8Array (pdfjs can't add auth headers itself)
  //   • blob: URLs           → restoreAsFiles() from IndexedDB → Uint8Array (no URL loading)
  //
  // viewerReady flips to true when the lookup completes so the viewer can show
  // a "not available" state instead of spinning forever.
  useEffect(() => {
    setViewerUrl(null)
    setViewerBytes(null)
    setViewerReady(false)
    if (!viewingDoc?.url) return

    const url = viewingDoc.url

    // API / HTTP URL — fetch with auth headers to get bytes, then pass to pdfjs as Uint8Array
    // (pdfjs would fetch the URL itself without our JWT → 401)
    if (!url.startsWith('blob:')) {
      api.get(url, { responseType: 'arraybuffer' })
        .then(({ data: buf }) => {
          setViewerBytes(new Uint8Array(buf))
          setViewerReady(true)
        })
        .catch(() => {
          // Fallback: let the viewer try the URL directly (works for non-auth URLs)
          setViewerUrl(url)
          setViewerReady(true)
        })
      return
    }

    // blob: URL — restore from IndexedDB (extension-proof, no URL sub-resource load)
    if (!selectedClaim) { setViewerReady(true); return }

    restoreAsFiles(selectedClaim.id)
      .then(async files => {
        const file = files.find(f => f.name === viewingDoc.name)
        if (file) return file.arrayBuffer()
        // Fallback: claim id may have changed (frontend id → DB UUID) so scan
        // all IDB entries for a file matching this filename.
        const fallback = await restoreFileByName(viewingDoc.name)
        if (fallback) {
          // Re-cache under the current claim id so future lookups are instant
          cacheFile(selectedClaim.id, fallback).catch(() => {})
          return fallback.arrayBuffer()
        }
        return undefined
      })
      .then(buf => {
        if (buf) setViewerBytes(new Uint8Array(buf))
        setViewerReady(true)
      })
      .catch(() => setViewerReady(true))
  }, [viewingDoc?.name, selectedClaim?.id])

  // ── Inline field editing ──────────────────────────────────────────────────
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingField, setSavingField] = useState<string | null>(null)
  const [fieldHistoryKey, setFieldHistoryKey] = useState<string | null>(null)
  const [fieldHistory, setFieldHistory] = useState<Array<{ at: string; actor: string; from: string; to: string }>>([])

  const startFieldEdit = (key: string, current: string) => { setEditingField(key); setEditValue(current); setFieldHistoryKey(null) }
  const cancelFieldEdit = () => { setEditingField(null); setEditValue('') }

  const saveFieldEdit = useCallback(async (key: string) => {
    if (!selectedClaim) return
    setSavingField(key)
    try {
      await api.patch(`/claims/${selectedClaim.id}`, { [key]: editValue })
      fetchFromServer?.()
      setEditingField(null)
      toast.success('Field updated')
    } catch {
      toast.error('Failed to save — try again')
    } finally {
      setSavingField(null)
    }
  }, [selectedClaim, editValue, fetchFromServer])

  const loadFieldHistory = useCallback(async (key: string) => {
    if (fieldHistoryKey === key) { setFieldHistoryKey(null); return }
    if (!selectedClaim) return
    try {
      const { data } = await api.get(`/claims/${selectedClaim.id}/audit-trail`)
      const changes = (data.events ?? [])
        .filter((e: any) => e.kind === 'activity' && e.data?.oldValue && key in e.data.oldValue)
        .map((e: any) => ({
          at: e.at,
          actor: e.actor?.name ?? e.actor?.email ?? 'System',
          from: String(e.data.oldValue[key] ?? ''),
          to:   String(e.data.newValue?.[key] ?? ''),
        }))
        .reverse()
      setFieldHistory(changes)
      setFieldHistoryKey(key)
    } catch { /* ignore */ }
  }, [selectedClaim, fieldHistoryKey])

  // ── OCR / clinical data ────────────────────────────────────────────────────
  const [ocrData, setOcrData] = useState<{
    fields: OcrAnnotation[]
    documents: { id: string; name: string; documentType: string; mimetype: string; size: number; ocrStatus: string | null }[]
    ocrEngine: string | null
    overallConfidence: number | null
    anomalyScore: number | null
    anomalyReasons: string[]
    clinicalSections: {
      chiefComplaint?: string; diagnosis?: string; treatment?: string
      medications?: string[]; labResults?: string; doctorNotes?: string
    }
    status: string | null
  } | null>(null)

  useEffect(() => {
    if (!selectedClaim?.id) { setOcrData(null); return }
    api.get(`/claims/${selectedClaim.id}/ocr-fields`)
      .then(({ data }) => setOcrData(data ?? null))
      .catch(() => setOcrData(null))
  }, [selectedClaim?.id])

  // Resubmit state
  const [resubmitNotes, setResubmitNotes] = useState('')
  const [resubmitting, setResubmitting] = useState(false)

  const handleResubmit = async () => {
    if (!selectedClaim) return
    setResubmitting(true)
    try {
      await api.post('/workflow/provider/resubmit', { claimId: selectedClaim.id, notes: resubmitNotes })
    } catch { /* best effort */ }
    setResubmitting(false)
    setResubmitNotes('')
    setSelectedClaim(null)
  }

  // New claim form state
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [aiExtracting, setAiExtracting] = useState(false)
  const [aiExtracted, setAiExtracted] = useState(false)
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setFormData(EMPTY_FORM)
    setFormErrors({})
    setAttachedFiles([])
    setAiExtracted(false)
    setAiExtracting(false)
  }

  const setField = (k: keyof FormData, v: string) => {
    setFormData(prev => ({ ...prev, [k]: v }))
    if (formErrors[k as keyof FormErrors]) setFormErrors(prev => ({ ...prev, [k]: undefined }))
  }

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachedFiles(prev => [...prev, ...Array.from(e.target.files || [])])
    if (e.target) e.target.value = ''
  }

  const handleAiExtract = async () => {
    if (!attachedFiles.length) return
    setAiExtracting(true)
    try {
      const r = await extractFromFile(attachedFiles[0])
      setFormData(prev => ({
        ...prev,
        memberName: r.memberName || prev.memberName,
        memberNumber: r.memberNumber || prev.memberNumber,
        patientId: r.patientId || prev.patientId,
        provider: r.provider || prev.provider,
        invoiceAmount: r.invoiceAmount && r.invoiceAmount !== '0' ? r.invoiceAmount : prev.invoiceAmount,
        invoiceNumber: r.invoiceNumber || prev.invoiceNumber,
        invoiceDate: r.invoiceDate || prev.invoiceDate,
        serviceDate: r.dateOfService || prev.serviceDate,
        diagnosis: r.diagnosis || prev.diagnosis,
        diagnosisCode: r.diagnosisCode || prev.diagnosisCode,
        procedureCode: r.procedureCode || prev.procedureCode,
        treatment: r.treatment || prev.treatment,
      }))
      setAiExtracted(true)
    } finally {
      setAiExtracting(false)
    }
  }

  const validateForm = (): boolean => {
    const errors: FormErrors = {}
    if (!formData.memberName.trim()) errors.memberName = 'Member name is required'
    if (!formData.provider) errors.provider = 'Provider is required'
    const amount = parseFloat(formData.invoiceAmount)
    if (!formData.invoiceAmount || isNaN(amount) || amount <= 0) errors.invoiceAmount = 'Valid invoice amount is required'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateClaim = async () => {
    if (!validateForm()) return
    const barcode = generateSystemBarcode()
    const claimNum = `CLM-${new Date().getFullYear()}-${String(claims.length + 143).padStart(5, '0')}`
    const claimId = String(Date.now())

    // Process files and capture bytes in memory — never fetch a blob URL
    // (Firefox extensions block fetch of blob: URLs via XrayWrapper)
    const processedDocs = await Promise.all(
      attachedFiles.map(async (f) => {
        let url: string
        let fileToCache: File = f   // default: cache the original file

        try {
          if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
            const r = await stampBarcodeOnPdf(await f.arrayBuffer(), barcode)
            url = r.url
            // r.bytes is already in memory — use it directly, no fetch needed
            fileToCache = new File([r.bytes as unknown as BlobPart], f.name, { type: f.type })
          } else if (f.type.startsWith('image/')) {
            url = await stampBarcodeOnImage(URL.createObjectURL(f), barcode)
            // Cache original image; stamped version is cosmetic only
          } else {
            url = URL.createObjectURL(f)
          }
        } catch {
          url = URL.createObjectURL(f)
        }

        return { name: f.name, size: f.size, type: f.type, url, fileToCache }
      })
    )

    // Persist bytes in IndexedDB using in-memory File objects (no blob URL fetch)
    processedDocs.forEach(({ fileToCache }) => {
      cacheFile(claimId, fileToCache).catch(() => { /* non-critical */ })
    })

    const stampedDocs = processedDocs.map(({ fileToCache: _, ...d }) => d)

    addClaim({
      id: claimId,
      barcode,
      claimNumber: claimNum,
      memberNumber: formData.memberNumber || `MBR-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      memberName: formData.memberName,
      patientName: formData.memberName,
      patientId: formData.patientId,
      provider: { name: formData.provider },
      invoiceAmount: parseFloat(formData.invoiceAmount) || 0,
      invoiceNumber: formData.invoiceNumber,
      invoiceDate: formData.invoiceDate,
      serviceDate: formData.serviceDate,
      status: 'submitted',
      workflowStage: 'initial_review',
      priority: formData.priority,
      ocrStatus: attachedFiles.length > 0 ? 'completed' : 'pending',
      diagnosis: formData.diagnosis,
      diagnosisCode: formData.diagnosisCode,
      procedureCode: formData.procedureCode,
      treatment: formData.treatment,
      notes: formData.notes,
      submittedAt: new Date().toISOString(),
      documents: stampedDocs,
      aiExtracted,
      batchType: 'single',
      uploadedBy: user?.email || user?.name || 'unknown',
    })
    resetForm()
    setShowNewClaim(false)
  }

  const uniqueProviders = Array.from(new Set(claims.map(c => c.provider?.name).filter(Boolean))).sort() as string[]

  const filteredClaims = claims.filter((c) => {
    const q = search.toLowerCase()
    const matchesSearch = !q ||
      claimNumSubseq(c.claimNumber, q) ||
      (c.barcode || '').toLowerCase().includes(q) ||
      c.memberName.toLowerCase().includes(q) ||
      c.memberNumber.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q) ||
      (c.diagnosis || '').toLowerCase().includes(q) ||
      (c.invoiceNumber || '').toLowerCase().includes(q) ||
      (c.batchNumber || c.batchId || '').toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter
    const matchesProvider = providerFilter === 'all' || c.provider?.name === providerFilter
    const matchesPriority = priorityFilter === 'all' || c.priority === priorityFilter
    const matchesSource = sourceFilter === 'all' ||
      (sourceFilter === 'ai' && c.aiExtracted) ||
      (sourceFilter === 'bulk' && (c.batchType === 'batch' || c.batchId)) ||
      (sourceFilter === 'manual' && c.batchType !== 'batch' && !c.batchId && !c.aiExtracted)
    // Date range filter
    const dt = new Date(c.submittedAt)
    const matchesDateFrom = !dateFrom || dt >= new Date(dateFrom)
    const matchesDateTo = !dateTo || dt <= new Date(dateTo + 'T23:59:59')
    return matchesSearch && matchesStatus && matchesProvider && matchesPriority && matchesSource && matchesDateFrom && matchesDateTo
  })

  const searchMatchesClaim = (c: ClaimRecord) => {
    if (!search) return true
    const q = search.toLowerCase()
    return claimNumSubseq(c.claimNumber, q) ||
      (c.barcode || '').toLowerCase().includes(q) ||
      c.memberName.toLowerCase().includes(q) ||
      c.memberNumber.toLowerCase().includes(q) ||
      (c.provider?.name || '').toLowerCase().includes(q) ||
      (c.diagnosis || '').toLowerCase().includes(q) ||
      (c.invoiceNumber || '').toLowerCase().includes(q) ||
      (c.batchNumber || c.batchId || '').toLowerCase().includes(q)
  }
  const singleClaims = claims.filter(c => (c.batchType === 'single' || (!c.batchId && !c.batchType)) && searchMatchesClaim(c))
  const batchGroups = buildBatchGroups(claims.filter(searchMatchesClaim))
  const activeFilterCount = [statusFilter, providerFilter, priorityFilter, sourceFilter].filter(f => f !== 'all').length
    + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)

  const clearFilters = () => {
    setStatusFilter('all'); setProviderFilter('all')
    setPriorityFilter('all'); setSourceFilter('all'); setSearch('')
    setDateFrom(''); setDateTo('')
  }

  // Renders the content for each configurable column cell
  const renderClaimCell = (colId: string, claim: ClaimRecord) => {
    switch (colId) {
      case 'claim_number': return (
        <TableCell key={colId} className="font-medium">
          <div>
            <div className="flex items-center gap-1.5">
              {claim.claimNumber}
              {claim.aiExtracted && <Sparkles className="h-3 w-3 text-violet-500" />}
            </div>
            {claim.barcode && <p className="font-mono text-[10px] text-red-500">{claim.barcode}</p>}
          </div>
        </TableCell>
      )
      case 'member': return (
        <TableCell key={colId}>
          <div>
            <p className="font-medium">{sanitizeMemberField(claim.memberName)}</p>
            <p className="text-xs text-muted-foreground">{sanitizeMemberField(claim.memberNumber)}</p>
          </div>
        </TableCell>
      )
      case 'provider': return (
        <TableCell key={colId}>
          <div>
            <p>{claim.provider?.name}</p>
            {claim.uploadedBy && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Building2 className="h-2.5 w-2.5" /> {claim.uploadedBy}
              </p>
            )}
          </div>
        </TableCell>
      )
      case 'amount': return <TableCell key={colId}>{formatCurrency(claim.invoiceAmount)}</TableCell>
      case 'type': return (
        <TableCell key={colId}>
          {claim.batchType === 'batch' ? (
            <div className="flex flex-col gap-0.5">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 w-fit">Batch</Badge>
              {claim.batchNumber && <span className="font-mono text-[10px] text-muted-foreground">{claim.batchNumber}</span>}
            </div>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Single</Badge>
          )}
        </TableCell>
      )
      case 'fraud': return (
        <TableCell key={colId}>
          {claim.fraudSignals && claim.fraudSignals.length > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    {claim.fraudSignals.some(s => s.level === 'critical') ? (
                      <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 gap-0.5 w-fit">
                        <AlertTriangle className="h-2.5 w-2.5" /> Fraud
                      </Badge>
                    ) : (
                      <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 gap-0.5 w-fit">
                        <AlertTriangle className="h-2.5 w-2.5" /> Warning
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">{claim.fraudSignals.length}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  <ul className="space-y-1 text-xs">
                    {claim.fraudSignals.map((s, i) => (
                      <li key={i} className={s.level === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                        <span className="font-semibold">{s.title}</span>
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      )
      case 'priority': return <TableCell key={colId}><Badge className={getPriorityColor(claim.priority)} variant="secondary">{claim.priority}</Badge></TableCell>
      case 'status': return <TableCell key={colId}><Badge className={getStatusColor(claim.status)} variant="secondary">{claim.status.replace(/_/g, ' ')}</Badge></TableCell>
      case 'docs': return (
        <TableCell key={colId}>
          {claim.documents.length > 0
            ? <Badge variant="outline"><Paperclip className="mr-1 h-3 w-3" />{claim.documents.length}</Badge>
            : <span className="text-xs text-muted-foreground">-</span>}
        </TableCell>
      )
      case 'date': return (
        <TableCell key={colId} className="text-muted-foreground text-xs">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{formatRelativeDate(claim.submittedAt)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(claim.submittedAt)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      )
      case 'eligibility': return (
        <TableCell key={colId}>
          {'eligibilityStatus' in claim
            ? <EligibilityBadge status={claim.eligibilityStatus} notes={claim.eligibilityNotes} showTooltip />
            : <span className="text-xs text-muted-foreground">—</span>}
        </TableCell>
      )
      case 'anomaly': return (
        <TableCell key={colId}>
          <AnomalyScoreBadge
            claimId={claim.id}
            score={(claim as any).ocrData?.anomalyScore ?? (claim as any).anomalyScore}
          />
        </TableCell>
      )
      default: return null
    }
  }

  // Shared claim row renderer
  const ClaimRow = ({ claim, compact = false }: { claim: ClaimRecord; compact?: boolean }) => (
    <TableRow
      key={claim.id}
      className={`cursor-pointer ${selectedIds.has(claim.id) ? 'bg-primary/5' : ''} ${compact ? 'text-xs' : ''}`}
      onClick={() => setSelectedClaim(claim)}
    >
      {!compact && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => {
              const next = new Set(selectedIds)
              if (next.has(claim.id)) next.delete(claim.id); else next.add(claim.id)
              setSelectedIds(next)
            }}
          >
            {selectedIds.has(claim.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
          </Button>
        </TableCell>
      )}
      {visibleCols.map(col => renderClaimCell(col.id, claim))}
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSelectedClaim(claim)}><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
            <DropdownMenuItem><Download className="mr-2 h-4 w-4" /> Export</DropdownMenuItem>
            {claim.status === 'fraud_confirmed' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 dark:text-red-400"
                  onClick={() => { setDenialClaim(claim); setDenialNote('') }}
                >
                  <Send className="mr-2 h-4 w-4" /> Send Denial to Provider
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setShowDeleteConfirm(claim.id)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )

  const claimTableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10">
          <Button variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => setSelectedIds(selectedIds.size === filteredClaims.length ? new Set() : new Set(filteredClaims.map(c => c.id)))}
          >
            {selectedIds.size === filteredClaims.length && filteredClaims.length > 0
              ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
          </Button>
        </TableHead>
        {visibleCols.map(col => <TableHead key={col.id}>{col.label}</TableHead>)}
        <TableHead className="w-10"></TableHead>
      </TableRow>
    </TableHeader>
  )
  const claimTableHeaderNoCheckbox = (
    <TableHeader>
      <TableRow>
        {visibleCols.map(col => <TableHead key={col.id}>{col.label}</TableHead>)}
        <TableHead className="w-10"></TableHead>
      </TableRow>
    </TableHeader>
  )

  const searchFilterBar = (
    <CardHeader className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search claim #, barcode, member, provider, batch..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-8" />
          {search && <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-10 w-8" onClick={() => setSearch('')}><X className="h-3 w-3" /></Button>}
        </div>
        <div className="flex gap-2">
          <Button variant={showFilters ? 'default' : 'outline'} size="sm" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />Filters
            {activeFilterCount > 0 && <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px]">{activeFilterCount}</Badge>}
          </Button>
          {activeFilterCount > 0 && <Button variant="ghost" size="sm" onClick={clearFilters}><XCircle className="mr-1 h-3 w-3" /> Clear</Button>}
          <Button variant="outline" size="sm" onClick={() => setShowColumnCustomizer(true)}>
            <Settings2 className="mr-2 h-4 w-4" />Columns
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" /> Export
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Current view ({filteredClaims.length} claims)</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportExcelFor(filteredClaims, 'all-claims')} className="gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" /> Download Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPdfFor(filteredClaims, 'All Claims')} className="gap-2">
                <Printer className="h-4 w-4 text-red-500" /> Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-lg border bg-muted/30">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['all', 'submitted', 'under_review', 'approved', 'rejected', 'fraud_confirmed', 'incomplete', 'resubmitted', 'paid'].map(s => (
                  <SelectItem key={s} value={s}>
                    {s === 'all' ? 'All Status' : s === 'fraud_confirmed' ? '🚫 Fraud Confirmed' : s.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {uniqueProviders.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Priority</Label>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['all', 'urgent', 'high', 'normal', 'low'].map(p => <SelectItem key={p} value={p}>{p === 'all' ? 'All Priorities' : p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Source</Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="manual">Manual Entry</SelectItem>
                <SelectItem value="ai">AI Extracted</SelectItem>
                <SelectItem value="bulk">Bulk Upload</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From Date</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To Date</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9" />
          </div>
        </div>
      )}
    </CardHeader>
  )

  // ── Report generation ────────────────────────────────────────────────────
  const claimsToRows = (data: ClaimRecord[]) => data.map(c => ({
    'Claim #': c.claimNumber,
    'Barcode': c.barcode || '',
    'Member Name': c.memberName,
    'Member #': c.memberNumber,
    'Provider': c.provider?.name || '',
    'Amount (KES)': c.invoiceAmount || 0,
    'Type': c.batchType === 'batch' ? 'Batch' : 'Single',
    'Batch #': c.batchNumber || '',
    'Status': c.status.replace(/_/g, ' '),
    'Priority': c.priority,
    'Fraud Signals': c.fraudSignals ? c.fraudSignals.map(s => s.title).join('; ') : '',
    'Invoice #': c.invoiceNumber || '',
    'Invoice Date': c.invoiceDate ? new Date(c.invoiceDate).toLocaleDateString() : '',
    'Service Date': c.serviceDate ? new Date(c.serviceDate).toLocaleDateString() : '',
    'Diagnosis': c.diagnosis || '',
    'Submitted': new Date(c.submittedAt).toLocaleDateString(),
    'Documents': c.documents.length,
    'AI Extracted': c.aiExtracted ? 'Yes' : 'No',
  }))

  const exportExcelFor = async (data: ClaimRecord[], label: string) => {
    const statusRows = ['submitted', 'under_review', 'approved', 'rejected', 'incomplete', 'resubmitted', 'paid'].map(s => ({
      'Status': s.replace(/_/g, ' '),
      'Count': data.filter(c => c.status === s).length,
      'Total Amount (KES)': data.filter(c => c.status === s).reduce((sum, c) => sum + (c.invoiceAmount || 0), 0),
    }))
    const slug = label.toLowerCase().replace(/\s+/g, '-')
    await downloadXlsx(
      [
        { name: 'Claims', rows: claimsToRows(data) },
        { name: 'Status Summary', rows: statusRows },
      ],
      `claimsflow-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    )
  }

  const exportPdfFor = (data: ClaimRecord[], label: string) => {
    const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
    const totalAmt = data.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
    const approved = data.filter(c => c.status === 'approved' || c.status === 'paid').length
    const pending  = data.filter(c => ['submitted', 'under_review', 'resubmitted'].includes(c.status)).length
    const rejected = data.filter(c => c.status === 'rejected').length
    const fraudCount = data.filter(c => c.fraudSignals && c.fraudSignals.length > 0).length
    const rows = data.map(c => `
      <tr>
        <td>${c.claimNumber}</td>
        <td>${c.memberName}</td>
        <td>${c.provider?.name || ''}</td>
        <td style="text-align:right">${fmt(c.invoiceAmount || 0)}</td>
        <td>${c.batchType === 'batch' ? `<span class="badge badge-batch">${c.batchNumber || 'Batch'}</span>` : '<span class="badge badge-single">Single</span>'}</td>
        <td><span class="badge badge-${c.status}">${c.status.replace(/_/g, ' ')}</span></td>
        ${c.fraudSignals && c.fraudSignals.length > 0 ? `<td><span class="badge badge-fraud">${c.fraudSignals.some(s=>s.level==='critical')?'⚠ Fraud':'⚠ Warning'}</span></td>` : '<td>—</td>'}
        <td>${new Date(c.submittedAt).toLocaleDateString()}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>ClaimsFlow — ${label} Report</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, Arial, sans-serif; font-size: 11px; color: #111; padding: 20px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #2563eb; }
      .header h1 { font-size: 20px; font-weight: 700; color: #1e40af; }
      .header p { font-size: 10px; color: #6b7280; margin-top: 2px; }
      .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
      .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
      .stat .label { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-bottom: 4px; }
      .stat .value { font-size: 17px; font-weight: 700; color: #0f172a; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      thead tr { background: #1e40af; color: white; }
      thead th { padding: 6px 8px; text-align: left; font-weight: 600; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      tbody td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
      .badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 600; text-transform: capitalize; }
      .badge-approved, .badge-paid { background: #dcfce7; color: #166534; }
      .badge-rejected { background: #fee2e2; color: #991b1b; }
      .badge-under_review { background: #dbeafe; color: #1e40af; }
      .badge-submitted { background: #fef9c3; color: #854d0e; }
      .badge-incomplete { background: #ffedd5; color: #9a3412; }
      .badge-batch { background: #dbeafe; color: #1d4ed8; }
      .badge-single { background: #f1f5f9; color: #64748b; }
      .badge-fraud { background: #fee2e2; color: #991b1b; }
      .footer { margin-top: 16px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="header">
      <div><h1>ClaimsFlow — ${label} Report</h1><p>Generated ${new Date().toLocaleString()} · ${data.length} claims</p></div>
      <div style="text-align:right"><p style="font-size:10px;color:#6b7280">Total Amount</p><p style="font-size:16px;font-weight:700;color:#1e40af">${fmt(totalAmt)}</p></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Total Claims</div><div class="value">${data.length}</div></div>
      <div class="stat"><div class="label">Approved / Paid</div><div class="value" style="color:#16a34a">${approved}</div></div>
      <div class="stat"><div class="label">Pending</div><div class="value" style="color:#d97706">${pending}</div></div>
      <div class="stat"><div class="label">Rejected</div><div class="value" style="color:#dc2626">${rejected}</div></div>
      <div class="stat"><div class="label">Fraud Flagged</div><div class="value" style="color:#dc2626">${fraudCount}</div></div>
    </div>
    <table><thead><tr>
      <th>Claim #</th><th>Member</th><th>Provider</th><th>Amount</th><th>Type</th><th>Status</th><th>Fraud</th><th>Date</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">ClaimsFlow Medical Claims Automation · CIC Insurance Group PLC · Confidential</div>
    <script>window.onload=()=>{ window.print(); }</script>
    </body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  const exportExcel = () => exportExcelFor(filteredClaims, 'all-claims')
  const exportPdf = () => exportPdfFor(filteredClaims, 'All Claims')

  // ── Summary stats for header cards ───────────────────────────────────────
  const totalClaims = claims.length
  const totalAmount = claims.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
  const approvedCount = claims.filter(c => c.status === 'approved' || c.status === 'paid').length
  const pendingCount = claims.filter(c => ['submitted', 'under_review', 'resubmitted'].includes(c.status)).length
  const rejectedCount = claims.filter(c => c.status === 'rejected').length

  return (
    <div className="space-y-6">
      {/* ── Modern header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Claims</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage and process medical claims</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <FileDown className="h-4 w-4" /> Report
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">All Claims ({claims.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportExcelFor(claims, 'all-claims')} className="gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" /> Excel — All Claims
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPdfFor(claims, 'All Claims')} className="gap-2">
                <Printer className="h-4 w-4 text-red-500" /> PDF — All Claims
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Batch Claims ({claims.filter(c=>c.batchType==='batch').length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportExcelFor(claims.filter(c=>c.batchType==='batch'), 'batch-claims')} className="gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" /> Excel — Batch Claims
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPdfFor(claims.filter(c=>c.batchType==='batch'), 'Batch Claims')} className="gap-2">
                <Printer className="h-4 w-4 text-red-500" /> PDF — Batch Claims
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Single Claims ({singleClaims.length})</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportExcelFor(singleClaims, 'single-claims')} className="gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" /> Excel — Single Claims
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPdfFor(singleClaims, 'Single Claims')} className="gap-2">
                <Printer className="h-4 w-4 text-red-500" /> PDF — Single Claims
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => { resetForm(); setShowNewClaim(true) }} className="gap-2">
            <Plus className="h-4 w-4" /> New Claim
          </Button>
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border-0 bg-gradient-to-br from-blue-50 to-blue-100/60 dark:from-blue-950/40 dark:to-blue-900/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide">Total Claims</span>
              <FileText className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{totalClaims}</p>
            <p className="text-xs text-blue-600/70 dark:text-blue-400 mt-0.5">{batchGroups.length} batch{batchGroups.length !== 1 ? 'es' : ''}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-gradient-to-br from-emerald-50 to-emerald-100/60 dark:from-emerald-950/40 dark:to-emerald-900/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Approved</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{approvedCount}</p>
            <p className="text-xs text-emerald-600/70 dark:text-emerald-400 mt-0.5">{totalClaims > 0 ? Math.round((approvedCount / totalClaims) * 100) : 0}% approval rate</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-gradient-to-br from-amber-50 to-amber-100/60 dark:from-amber-950/40 dark:to-amber-900/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wide">Pending</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingCount}</p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400 mt-0.5">awaiting review</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-gradient-to-br from-red-50 to-red-100/60 dark:from-red-950/40 dark:to-red-900/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-red-700 dark:text-red-300 uppercase tracking-wide">Rejected</span>
              <XCircleIcon className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-red-900 dark:text-red-100">{rejectedCount}</p>
            <p className="text-xs text-red-600/70 dark:text-red-400 mt-0.5">{totalClaims > 0 ? Math.round((rejectedCount / totalClaims) * 100) : 0}% rejection rate</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-gradient-to-br from-violet-50 to-violet-100/60 dark:from-violet-950/40 dark:to-violet-900/20 col-span-2 sm:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-violet-700 dark:text-violet-300 uppercase tracking-wide">Total Value</span>
              <TrendingUp className="h-4 w-4 text-violet-500" />
            </div>
            <p className="text-lg font-bold text-violet-900 dark:text-violet-100 tabular-nums">
              {(totalAmount / 1_000_000).toFixed(2)}M
            </p>
            <p className="text-xs text-violet-600/70 dark:text-violet-400 mt-0.5">KES across all claims</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="relative">
          {tabOrder.map((tabId, idx) => {
            if (tabId === 'branches' && !(user?.role === 'provider_admin' || user?.role === 'provider_user')) return null
            const tabContent: Record<string, React.ReactNode> = {
              all: <><FileText className="h-4 w-4" /> All Claims <Badge variant="secondary" className="ml-1 text-[10px] h-5 px-1.5">{filteredClaims.length}</Badge></>,
              batches: <><Layers className="h-4 w-4" /> By Batch <Badge variant="secondary" className="ml-1 text-[10px] h-5 px-1.5">{batchGroups.length}</Badge></>,
              single: <><User className="h-4 w-4" /> Single Claims <Badge variant="secondary" className="ml-1 text-[10px] h-5 px-1.5">{singleClaims.length}</Badge></>,
              branches: <><Building2 className="h-4 w-4" /> By Branch</>,
            }
            return (
              <TabsTrigger
                key={tabId}
                value={tabId}
                className={`gap-2 cursor-grab select-none ${dragTabIdx === idx ? 'opacity-40' : ''}`}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragTabIdx(idx) }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dragTabIdx === null || dragTabIdx === idx) return
                  const next = [...tabOrder]; const [moved] = next.splice(dragTabIdx, 1); next.splice(idx, 0, moved)
                  setTabOrder(next); setDragTabIdx(idx)
                }}
                onDragEnd={() => setDragTabIdx(null)}
              >
                {tabContent[tabId]}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* ── ALL CLAIMS ── */}
        <TabsContent value="all" className="mt-4">
          <Card>
            {searchFilterBar}
            <CardContent>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border">
                  <span className="text-sm font-medium">{selectedIds.size} selected</span>
                  <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm('bulk')}>
                    <Trash2 className="mr-2 h-3 w-3" /> Delete Selected
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
                </div>
              )}
              <Table>
                {claimTableHeader}
                <TableBody>
                  {filteredClaims.length === 0
                    ? <TableRow><TableCell colSpan={visibleCols.length + 2} className="text-center py-12 text-muted-foreground">No claims found</TableCell></TableRow>
                    : filteredClaims
                        .slice((claimsPage - 1) * claimsPageSize, claimsPage * claimsPageSize)
                        .map(c => <ClaimRow key={c.id} claim={c} />)}
                </TableBody>
              </Table>
              <Pagination
                page={claimsPage}
                pageSize={claimsPageSize}
                total={filteredClaims.length}
                onPageChange={setClaimsPage}
                onPageSizeChange={(size) => { setClaimsPageSize(size); setClaimsPage(1) }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY BATCH ── */}
        <TabsContent value="batches" className="mt-4 space-y-3">
          {batchGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Layers className="h-12 w-12 opacity-20" />
                <p>No batch uploads yet. Use Batch Upload to submit multiple invoices at once.</p>
              </CardContent>
            </Card>
          ) : batchGroups.map(batch => {
            const isExpanded = expandedBatch === batch.batchId

            // Detect provider-mismatch fraud in this batch
            const fraudClaims = batch.claims.filter(c =>
              c.fraudSignals?.some(s => s.title === 'Provider Mismatch — Possible Fraud')
            )
            const batchHasFraud = fraudClaims.length > 0

            // Group providers within this batch
            const providerMap = new Map<string, ClaimRecord[]>()
            for (const c of batch.claims) {
              const pn = c.provider?.name || 'Unknown'
              if (!providerMap.has(pn)) providerMap.set(pn, [])
              providerMap.get(pn)!.push(c)
            }

            return (
              <Card key={batch.batchId} className={`transition-shadow overflow-hidden ${
                batchHasFraud
                  ? 'ring-2 ring-red-500/60 shadow-lg shadow-red-500/10'
                  : isExpanded ? 'shadow-md ring-1 ring-primary/20' : ''
              }`}>

                {/* Fraud banner across top of card */}
                {batchHasFraud && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    FRAUD ALERT — {fraudClaims.length} invoice{fraudClaims.length !== 1 ? 's' : ''} submitted by a user not belonging to the invoice provider. This batch has been flagged for investigation.
                  </div>
                )}

                {/* Batch header row */}
                <div
                  className={`flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/20 transition-colors ${batchHasFraud ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                  onClick={() => setExpandedBatch(isExpanded ? null : batch.batchId)}
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                  </Button>
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Batch</p>
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-sm font-mono">{batch.batchNumber}</p>
                        {batchHasFraud && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border border-red-300 dark:border-red-700 gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> FRAUD
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Uploaded By</p>
                      <p className="text-sm truncate">{batch.uploadedBy}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Date</p>
                      <p className="text-sm">{formatDate(batch.submittedAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Claims / Amount</p>
                      <p className="text-sm font-medium">{batch.claims.length} &middot; {formatCurrency(batch.totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Providers</p>
                      <div className="flex flex-wrap gap-1">
                        {batch.isMixed && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                            Mixed ({batch.providers.length})
                          </Badge>
                        )}
                        {batch.providers.slice(0, batch.isMixed ? 2 : 1).map(p => (
                          <Badge key={p} variant="outline" className="text-[9px] px-1.5 py-0 max-w-[120px] truncate">{p}</Badge>
                        ))}
                        {batch.providers.length > 2 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">+{batch.providers.length - 2}</Badge>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded batch content */}
                {isExpanded && (
                  <div className="border-t">
                    {batch.isMixed && !batchHasFraud && (
                      <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-b">
                        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3" />
                          Mixed batch — invoices from {batch.providers.length} different providers
                        </p>
                      </div>
                    )}
                    {batchHasFraud && (
                      <div className="px-4 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5 mb-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Provider Mismatch Detected
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {fraudClaims.length} invoice{fraudClaims.length !== 1 ? 's were' : ' was'} uploaded by a user whose account does not belong to the provider named on the invoice.
                          Rows marked <span className="font-bold">FRAUD</span> should be investigated before any approval action is taken.
                        </p>
                      </div>
                    )}

                    {/* Per-provider sub-sections */}
                    {Array.from(providerMap.entries()).map(([providerName, provClaims]) => {
                      const provKey = `${batch.batchId}::${providerName}`
                      const isProvExpanded = expandedProvider === provKey
                      const provHasFraud = provClaims.some(c =>
                        c.fraudSignals?.some(s => s.title === 'Provider Mismatch — Possible Fraud')
                      )
                      return (
                        <div key={providerName} className="border-b last:border-b-0">
                          {/* Provider sub-header */}
                          <div
                            className={`flex items-center gap-3 px-6 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${provHasFraud ? 'bg-red-50/60 dark:bg-red-950/20' : 'bg-muted/30'}`}
                            onClick={() => setExpandedProvider(isProvExpanded ? null : provKey)}
                          >
                            <Button variant="ghost" size="icon" className="h-5 w-5">
                              {isProvExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                            </Button>
                            <Building2 className={`h-3.5 w-3.5 ${provHasFraud ? 'text-red-500' : 'text-muted-foreground'}`} />
                            <span className={`text-sm font-medium ${provHasFraud ? 'text-red-700 dark:text-red-300' : ''}`}>{providerName}</span>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{provClaims.length} claim{provClaims.length > 1 ? 's' : ''}</Badge>
                            {provHasFraud && (
                              <Badge className="text-[9px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border border-red-300 dark:border-red-700 gap-0.5">
                                <AlertTriangle className="h-2.5 w-2.5" /> FRAUD
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">{formatCurrency(provClaims.reduce((s, c) => s + (c.invoiceAmount || 0), 0))}</span>
                          </div>

                          {/* Provider claims table */}
                          {isProvExpanded && (
                            <div className="px-6 py-2">
                              <Table>
                                <TableHeader>
                                  <TableRow className="text-xs">
                                    <TableHead>Claim #</TableHead>
                                    <TableHead>Member</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Fraud</TableHead>
                                    <TableHead>Docs</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="w-8"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {provClaims.map(c => {
                                    const claimFraudSignals = c.fraudSignals || []
                                    const mismatch = claimFraudSignals.find(s => s.title === 'Provider Mismatch — Possible Fraud')
                                    const criticals = claimFraudSignals.filter(s => s.level === 'critical').length
                                    return (
                                      <TableRow
                                        key={c.id}
                                        className={`cursor-pointer text-xs ${mismatch ? 'bg-red-50/70 dark:bg-red-950/20 border-l-2 border-l-red-500' : ''}`}
                                        onClick={() => setSelectedClaim(c)}
                                      >
                                        <TableCell className="font-medium">
                                          <div>
                                            <div className="flex items-center gap-1">
                                              {c.claimNumber}
                                              {c.aiExtracted && <Sparkles className="h-2.5 w-2.5 text-violet-500" />}
                                              {mismatch && <AlertTriangle className="h-3 w-3 text-red-500" />}
                                            </div>
                                            {c.barcode && <p className="font-mono text-[9px] text-red-500">{c.barcode}</p>}
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <p className="font-medium">{sanitizeMemberField(c.memberName)}</p>
                                          <p className="text-[10px] text-muted-foreground">{sanitizeMemberField(c.memberNumber)}</p>
                                        </TableCell>
                                        <TableCell>{formatCurrency(c.invoiceAmount)}</TableCell>
                                        <TableCell><Badge className={`text-[10px] ${getStatusColor(c.status)}`} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge></TableCell>
                                        <TableCell>
                                          {mismatch ? (
                                            <Badge className="text-[9px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border border-red-300 dark:border-red-700 gap-0.5">
                                              <AlertTriangle className="h-2.5 w-2.5" /> FRAUD
                                            </Badge>
                                          ) : criticals > 0 ? (
                                            <Badge className="text-[9px] px-1.5 py-0 bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border border-orange-200 gap-0.5">
                                              <AlertTriangle className="h-2.5 w-2.5" /> {criticals} signal{criticals > 1 ? 's' : ''}
                                            </Badge>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell>{c.documents.length > 0 ? <Badge variant="outline" className="text-[10px]"><Paperclip className="mr-0.5 h-2.5 w-2.5" />{c.documents.length}</Badge> : '-'}</TableCell>
                                        <TableCell className="text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                                        <TableCell>
                                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setSelectedClaim(c) }}>
                                            <Eye className="h-3 w-3" />
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })}
        </TabsContent>

        {/* ── BY BRANCH (Provider Users) ── */}
        {(user?.role === 'provider_admin' || user?.role === 'provider_user') && (
          <TabsContent value="branches" className="mt-4 space-y-3">
            {(() => {
              // Group claims by branch (uploadedBy / batchNumber pattern)
              const branchMap = new Map<string, ClaimRecord[]>()
              for (const c of filteredClaims) {
                // Use uploadedBy as a proxy for branch grouping, or 'Main Branch' if none
                const branchKey = c.uploadedBy || 'Main Branch'
                if (!branchMap.has(branchKey)) branchMap.set(branchKey, [])
                branchMap.get(branchKey)!.push(c)
              }
              if (branchMap.size === 0) return (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Building2 className="h-12 w-12 opacity-20" />
                    <p>No claims found for your branches.</p>
                  </CardContent>
                </Card>
              )
              return Array.from(branchMap.entries()).map(([branch, branchClaims]) => {
                const totalAmt = branchClaims.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
                const approved = branchClaims.filter(c => c.status === 'approved' || c.status === 'paid').length
                const pending = branchClaims.filter(c => ['submitted', 'under_review', 'incomplete'].includes(c.status)).length
                const rejected = branchClaims.filter(c => c.status === 'rejected').length
                return (
                  <Card key={branch}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4" /> {branch}
                      </CardTitle>
                      <CardDescription className="flex gap-4 text-xs">
                        <span>{branchClaims.length} claims</span>
                        <span>{formatCurrency(totalAmt)}</span>
                        <span className="text-green-600">{approved} approved</span>
                        <span className="text-amber-600">{pending} pending</span>
                        <span className="text-red-600">{rejected} rejected</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Claim #</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Docs</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="w-8"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {branchClaims.map(c => (
                            <TableRow key={c.id} className="cursor-pointer text-xs" onClick={() => setSelectedClaim(c)}>
                              <TableCell className="font-medium">
                                <div>
                                  <div className="flex items-center gap-1">{c.claimNumber}{c.aiExtracted && <Sparkles className="h-2.5 w-2.5 text-violet-500" />}</div>
                                  {c.barcode && <p className="font-mono text-[9px] text-red-500">{c.barcode}</p>}
                                </div>
                              </TableCell>
                              <TableCell>
                                <p className="font-medium">{sanitizeMemberField(c.memberName)}</p>
                                <p className="text-[10px] text-muted-foreground">{sanitizeMemberField(c.memberNumber)}</p>
                              </TableCell>
                              <TableCell>{formatCurrency(c.invoiceAmount)}</TableCell>
                              <TableCell><Badge className={`text-[10px] ${getStatusColor(c.status)}`} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge></TableCell>
                              <TableCell>{c.documents.length > 0 ? <Badge variant="outline" className="text-[10px]"><Paperclip className="mr-0.5 h-2.5 w-2.5" />{c.documents.length}</Badge> : '-'}</TableCell>
                              <TableCell className="text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setSelectedClaim(c) }}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )
              })
            })()}
          </TabsContent>
        )}

        {/* ── SINGLE CLAIMS ── */}
        <TabsContent value="single" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" /> Single Claims
                </CardTitle>
                <CardDescription>
                  Claims submitted individually (not via batch upload) — {singleClaims.length} total
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 shrink-0">
                      <Download className="h-4 w-4" /> Export
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Single Claims ({singleClaims.length})</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => exportExcelFor(singleClaims, 'single-claims')} className="gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-green-600" /> Download Excel
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportPdfFor(singleClaims, 'Single Claims')} className="gap-2">
                      <Printer className="h-4 w-4 text-red-500" /> Download PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowColumnCustomizer(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />Columns
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                {claimTableHeaderNoCheckbox}
                <TableBody>
                  {singleClaims.length === 0
                    ? <TableRow><TableCell colSpan={visibleCols.length + 1} className="text-center py-12 text-muted-foreground">No single claims yet</TableCell></TableRow>
                    : singleClaims.map(c => <ClaimRow key={c.id} claim={c} compact />)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── CLAIM DETAIL DIALOG — wide side-by-side layout ── */}
      <Dialog open={!!selectedClaim} onOpenChange={(open) => { if (!open) { if (viewerOpen) return; setSelectedClaim(null); setViewingDoc(null); setViewerUrl(null); setViewerBytes(null); setViewerReady(false) } }}>
        <DialogContent
          className="max-w-[95vw] w-[1200px] p-0 gap-0 overflow-hidden h-[95vh] flex flex-col"
          // Always prevent Radix's auto-focus-and-scroll behaviour — without this
          // the left panel scrolls past the Fraud Signals banner on open at normal
          // browser zoom levels, so the critical-signal alert is hidden until the
          // user scrolls up.
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={viewerOpen ? e => e.preventDefault() : undefined}
          style={viewerOpen ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
        >
          <DialogTitle className="sr-only">{selectedClaim?.claimNumber ?? 'Claim Details'}</DialogTitle>

          {/* ── Header bar ── */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-gradient-to-r from-muted/60 to-background shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="font-black tracking-tight text-sm font-mono">{selectedClaim?.claimNumber}</span>
              {selectedClaim?.aiExtracted && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-violet-500/10 text-violet-500 border border-violet-500/20">
                  <Sparkles className="h-2.5 w-2.5" /> AI
                </span>
              )}
              {selectedClaim?.batchNumber && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground bg-muted border border-border">{selectedClaim.batchNumber}</span>
              )}
              <span className="text-muted-foreground/40 hidden sm:inline">·</span>
              <span className="text-base font-black tabular-nums hidden sm:inline text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedClaim?.invoiceAmount ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 pr-8">
              {selectedClaim && (
                <>
                  <Badge className={getStatusColor(selectedClaim.status)} variant="secondary" style={{ fontSize: '10px' }}>
                    {selectedClaim.status.replace(/_/g, ' ')}
                  </Badge>
                  <Badge className={getPriorityColor(selectedClaim.priority)} variant="secondary" style={{ fontSize: '10px' }}>
                    {selectedClaim.priority}
                  </Badge>
                </>
              )}
            </div>
          </div>

          {selectedClaim && (
            <div className="flex flex-1 overflow-hidden">

              {/* ══════ LEFT — compact details panel ══════ */}
              <div className="w-[320px] shrink-0 flex flex-col border-r overflow-y-auto bg-background">

                {/* Incomplete banner */}
                {selectedClaim.status === 'incomplete' && (
                  <div className="mx-3 mt-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Returned — Action Required</p>
                    </div>
                    <Textarea
                      placeholder="Describe corrections made…"
                      value={resubmitNotes}
                      onChange={e => setResubmitNotes(e.target.value)}
                      rows={2}
                      className="text-xs"
                    />
                    <Button size="sm" className="w-full h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={handleResubmit} disabled={resubmitting}>
                      {resubmitting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Send className="mr-1.5 h-3 w-3" />}
                      Resubmit
                    </Button>
                  </div>
                )}

                {/* ── Fraud Signals Panel ── */}
                {(() => {
                  const c = selectedClaim
                  const amt = c.invoiceAmount || 0

                  // Prefer signals stored at processing time on the server.
                  // Fall back to client-side computation for older claims.
                  let signals: { level: 'critical' | 'warning' | 'info'; title: string; detail: string; detectedAt?: string }[] =
                    c.fraudSignals && c.fraudSignals.length > 0
                      ? c.fraudSignals
                      : []

                  if (signals.length === 0) {
                    // Client-side fallback for claims pre-dating server-side computation
                    if (amt > 0 && amt % 1000 === 0 && amt >= 10000)
                      signals.push({ level: amt >= 100000 ? 'critical' : 'warning', title: 'Round-Amount Billing', detail: `Invoice is exactly ${formatCurrency(amt)} — a perfect round number. Genuine itemised medical bills produce irregular totals from aggregated line items. This pattern is associated with inflated or estimated invoices.` })
                    if (!c.memberNumber || c.memberName?.toLowerCase().includes('unknown'))
                      signals.push({ level: 'critical', title: 'Unknown / Missing Patient Identity', detail: `Member number is ${c.memberNumber ? `"${c.memberNumber}"` : 'absent'} and patient name is "${c.memberName || 'blank'}". Without verified identity this claim cannot be cross-checked against policy eligibility or prior claim history — a primary indicator of a ghost claim.` })
                    if (amt > 200000)
                      signals.push({ level: 'warning', title: 'High-Value Claim', detail: `${formatCurrency(amt)} exceeds the KES 200,000 threshold. Requires claims officer approval and a matching pre-authorisation letter.` })
                    const dupClaims = claims.filter(x => x.id !== c.id && x.invoiceNumber && x.invoiceNumber === c.invoiceNumber)
                    if (dupClaims.length > 0)
                      signals.push({ level: 'critical', title: 'Duplicate Invoice Number', detail: `Invoice number "${c.invoiceNumber}" also appears on ${dupClaims.map(x => x.claimNumber).join(', ')} — potential double-billing by the provider.` })
                    if (c.aiExtracted && c.aiConfidence && c.aiConfidence < 0.70)
                      signals.push({ level: 'warning', title: 'Low OCR Confidence', detail: `AI extracted fields with only ${(c.aiConfidence * 100).toFixed(0)}% confidence — manual field-by-field verification required before approval.` })
                    if (c.serviceDate && c.invoiceDate) {
                      const sd = new Date(c.serviceDate), id = new Date(c.invoiceDate)
                      if (id > sd) signals.push({ level: 'critical', title: 'Impossible Date Sequence', detail: `Invoice date (${formatDate(c.invoiceDate)}) is after service date (${formatDate(c.serviceDate)}). The invoice must be dated on or before the service date — an invoice created after the service was rendered indicates retroactive billing or deliberate date manipulation.` })
                    }
                  }

                  if (signals.length === 0) return null

                  const bgMap = { critical: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800', warning: 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800', info: 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' }
                  const textMap = { critical: 'text-red-700 dark:text-red-300', warning: 'text-amber-700 dark:text-amber-300', info: 'text-blue-700 dark:text-blue-300' }
                  const dotMap = { critical: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-blue-500' }

                  const crit = signals.filter(s => s.level === 'critical').length
                  const warn = signals.filter(s => s.level === 'warning').length
                  return (
                    <div className="mx-2 mt-2 space-y-1.5">
                      {/* Section label */}
                      <div className="flex items-center gap-1.5 px-1">
                        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                          {crit > 0 ? `${crit} Critical` : ''}{crit > 0 && warn > 0 ? ' · ' : ''}{warn > 0 ? `${warn} Warning` : ''}{' '}Signal{signals.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {signals.map((s, i) => (
                        <div key={i} className={`rounded-lg border-l-4 bg-card shadow-sm p-3 ${
                          s.level === 'critical'
                            ? 'border-l-red-500 border border-red-200 dark:border-red-800/60'
                            : s.level === 'warning'
                            ? 'border-l-amber-500 border border-amber-200 dark:border-amber-800/60'
                            : 'border-l-blue-500 border border-blue-200 dark:border-blue-800/60'
                        }`}>
                          <div className="flex items-start gap-2">
                            <span className={`inline-flex mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${
                              s.level === 'critical' ? 'bg-red-600 text-white' : s.level === 'warning' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'
                            }`}>{s.level}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-foreground leading-tight">{s.title}</p>
                              {(s as any).detectedAt && (
                                <p className="text-[9px] text-muted-foreground mt-0.5">{formatDate((s as any).detectedAt)}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{s.detail}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Field groups */}
                {(() => {
                  const ai = selectedClaim.aiExtracted
                  const AiBadge = () => (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 ml-1 shrink-0 cursor-help">
                          <Sparkles className="h-2 w-2" />OCR
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                        This value was automatically extracted from the uploaded document by the OCR engine. Verify it matches the source document exactly — extraction errors can occur on poor-quality scans, handwritten text, or unusual layouts.
                      </TooltipContent>
                    </Tooltip>
                  )
                  const ManualBadge = () => (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold bg-sky-500/10 text-sky-500 dark:text-sky-400 border border-sky-500/20 ml-1 shrink-0 cursor-help">
                          <TrendingUp className="h-2 w-2" />Manual
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                        This value was entered manually by the submitter and has not been cross-validated with source documents. Manual entries carry a higher risk of error or intentional misrepresentation — verify carefully against the attached invoice.
                      </TooltipContent>
                    </Tooltip>
                  )
                  const Field = ({ label, value, fieldKey, isAi, mono, large, tooltip }: { label: string; value?: string | null; fieldKey?: string; isAi?: boolean; mono?: boolean; large?: boolean; tooltip?: string }) => {
                    if (!value && editingField !== fieldKey) return null
                    const badge = ai ? (isAi !== false ? <AiBadge /> : <ManualBadge />) : <ManualBadge />
                    const isEditing = !!fieldKey && editingField === fieldKey
                    const isShowingHistory = !!fieldKey && fieldHistoryKey === fieldKey
                    return (
                      <div className="group relative">
                        <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5 flex items-center flex-wrap gap-x-0.5">
                          {tooltip ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">{label}</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                {tooltip}
                              </TooltipContent>
                            </Tooltip>
                          ) : label}
                          {badge}
                          {fieldKey && !isEditing && (
                            <>
                              <button type="button" title="Edit field" onClick={() => startFieldEdit(fieldKey, value ?? '')}
                                className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-muted transition-opacity">
                                <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                              </button>
                              <button type="button" title="View change history" onClick={() => loadFieldHistory(fieldKey)}
                                className={`ml-0.5 p-0.5 rounded hover:bg-muted transition-opacity ${isShowingHistory ? 'opacity-100 text-blue-500' : 'opacity-0 group-hover:opacity-100'}`}>
                                <History className="h-2.5 w-2.5" />
                              </button>
                            </>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <input
                              autoFocus
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveFieldEdit(fieldKey!); if (e.key === 'Escape') cancelFieldEdit() }}
                              className="flex-1 text-xs border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <button type="button" onClick={() => saveFieldEdit(fieldKey!)} disabled={!!savingField}
                              className="p-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                              {savingField === fieldKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </button>
                            <button type="button" onClick={cancelFieldEdit} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
                              <Undo2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <p className={`${large ? 'text-base font-extrabold' : 'text-xs font-semibold'} ${mono ? 'font-mono' : ''} text-foreground break-words leading-snug`}>{value}</p>
                        )}
                        {isShowingHistory && (
                          <div className="mt-1 rounded border bg-muted/40 divide-y text-[10px]">
                            {fieldHistory.length === 0
                              ? <p className="px-2 py-1.5 text-muted-foreground italic">No edits recorded yet</p>
                              : fieldHistory.map((h, i) => (
                                  <div key={i} className="px-2 py-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium text-muted-foreground">{h.actor}</span>
                                      <span className="text-muted-foreground/60">{new Date(h.at).toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="line-through text-red-500 font-mono">{h.from || '—'}</span>
                                      <ChevronRightIcon className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                                      <span className="text-emerald-600 font-mono font-semibold">{h.to || '—'}</span>
                                    </div>
                                  </div>
                                ))
                            }
                          </div>
                        )}
                      </div>
                    )
                  }
                  const Section = ({ icon, label, color, children }: { icon: React.ReactNode; label: string; color: string; children: React.ReactNode }) => (
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b ${color}`}>
                        <span className="opacity-70">{icon}</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-80">{label}</span>
                      </div>
                      <div className="px-2.5 py-2 grid grid-cols-2 gap-x-3 gap-y-2">
                        {children}
                      </div>
                    </div>
                  )

                  return (
                    <TooltipProvider delayDuration={300}>
                    <div className="px-2 py-2 space-y-2">

                      {/* Member & Patient */}
                      <Section icon={<User className="h-3.5 w-3.5 text-blue-500" />} label="Member & Patient" color="bg-blue-500/5 border-blue-500/10">
                        <div className="col-span-2">
                          <Field
                            label="Member Name"
                            value={selectedClaim.memberName}
                            fieldKey="memberName"
                            isAi={true}
                            tooltip="The insured member's full legal name as registered on the policy. 'Unknown Patient' is a critical red flag — it may indicate a ghost claim where no verified policyholder is associated with the service."
                          />
                        </div>
                        <Field
                          label="Member No."
                          value={selectedClaim.memberNumber}
                          fieldKey="memberNumber"
                          isAi={true}
                          mono
                          tooltip="Unique policy membership number. Cross-check against the insurer's membership register to confirm the member had active coverage on the service date."
                        />
                        <Field
                          label="Patient ID"
                          value={selectedClaim.patientId}
                          fieldKey="patientId"
                          isAi={true}
                          mono
                          tooltip="The patient's identifier at the provider's facility. Should correspond to the member number — mismatches may indicate the treated patient is not the policyholder."
                        />
                        <div className="col-span-2">
                          <Field
                            label="Provider"
                            value={selectedClaim.provider?.name}
                            isAi={true}
                            tooltip="The healthcare facility or practitioner submitting this claim. Confirm the provider is on the approved panel and accredited for all services billed on this invoice."
                          />
                        </div>
                      </Section>

                      {/* Financial */}
                      <Section icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />} label="Financial" color="bg-emerald-500/5 border-emerald-500/10">
                        <div className="col-span-2">
                          <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5 flex items-center flex-wrap gap-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Invoice Amount</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                Total amount claimed by the provider. Verify each line item against the attached invoice. Exact round numbers (e.g. Ksh 10,000.00) are a known fraud indicator — genuine itemised bills aggregate line items and rarely produce perfect round totals.
                              </TooltipContent>
                            </Tooltip>
                            {ai ? <AiBadge /> : <ManualBadge />}
                            {(() => {
                              const amt = selectedClaim.invoiceAmount || 0
                              return amt >= 10000 && amt % 1000 === 0
                                ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300/50 cursor-help">
                                        <AlertTriangle className="h-2 w-2" />Round Amount
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                      This invoice total is a perfect round number — a pattern strongly associated with estimated or inflated billing. Genuine itemised invoices aggregate multiple line items and rarely produce exact round totals. Request itemised breakdown.
                                    </TooltipContent>
                                  </Tooltip>
                                )
                                : null
                            })()}
                          </div>
                          <p className="text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedClaim.invoiceAmount)}</p>
                        </div>
                        <div className="col-span-2">
                          <Field
                            label="Invoice #"
                            value={selectedClaim.invoiceNumber}
                            fieldKey="invoiceNumber"
                            isAi={true}
                            mono
                            tooltip="The provider's unique invoice reference number. If this number appears on any other claim in the system, it is a duplicate billing attempt — a common provider fraud pattern."
                          />
                        </div>
                        {/* Invoice Date + Service Date side by side for easy comparison */}
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5 flex items-center flex-wrap gap-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Invoice Date</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                Date on the provider's invoice. Must be on or before the service date — a provider cannot issue an invoice after the service was already rendered, as this indicates retroactive or backdated billing.
                              </TooltipContent>
                            </Tooltip>
                            {ai ? <AiBadge /> : <ManualBadge />}
                            {selectedClaim.serviceDate && selectedClaim.invoiceDate && new Date(selectedClaim.invoiceDate) > new Date(selectedClaim.serviceDate)
                              ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-bold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-300/50 cursor-help">
                                      <AlertTriangle className="h-2 w-2" />After Service
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                    This invoice is dated AFTER the service date — the provider created the invoice retroactively, after the service was already rendered. The invoice must be dated on or before the service date.
                                  </TooltipContent>
                                </Tooltip>
                              )
                              : null}
                          </div>
                          {selectedClaim.invoiceDate
                            ? <p className="text-xs font-semibold">{formatDate(selectedClaim.invoiceDate)}</p>
                            : <p className="text-xs text-muted-foreground/50">—</p>}
                        </div>
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5 flex items-center flex-wrap gap-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-muted-foreground/40">Service Date</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                The date medical services were rendered. The invoice must be dated on or before this date — if the invoice date is later, the invoice was created retroactively. Cross-check against clinical notes, prescriptions, and admission records.
                              </TooltipContent>
                            </Tooltip>
                            <ManualBadge />
                            {selectedClaim.serviceDate && selectedClaim.invoiceDate && new Date(selectedClaim.invoiceDate) > new Date(selectedClaim.serviceDate)
                              ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-bold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-300/50 cursor-help">
                                      <AlertTriangle className="h-2 w-2" />Invoice Later
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                    The invoice is dated after the service date — the provider raised this invoice retroactively, after the service was already performed. This is an impossible sequence and indicates date manipulation.
                                  </TooltipContent>
                                </Tooltip>
                              )
                              : null}
                          </div>
                          {selectedClaim.serviceDate
                            ? <p className="text-xs font-semibold">{formatDate(selectedClaim.serviceDate)}</p>
                            : <p className="text-xs text-muted-foreground/50">—</p>}
                        </div>
                      </Section>

                      {/* Clinical Story — from OCR/AI extraction */}
                      {(() => {
                        const cs = ocrData?.clinicalSections
                        const diag = cs?.diagnosis || selectedClaim.diagnosis
                        const treat = cs?.treatment || selectedClaim.treatment
                        const meds = cs?.medications ?? []
                        const lab = cs?.labResults
                        const cc = cs?.chiefComplaint
                        const notes = cs?.doctorNotes
                        const docTypes = ocrData?.documents.filter(d => d.documentType && d.documentType !== 'unknown') ?? []
                        const hasAny = diag || treat || meds.length || lab || cc || notes || docTypes.length > 0

                        if (!hasAny && !selectedClaim.diagnosisCode && !selectedClaim.procedureCode) return null

                        const docTypeMeta: Record<string, { label: string; cls: string }> = {
                          invoice:          { label: 'Invoice',        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30' },
                          prescription:     { label: 'Prescription',   cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/30' },
                          lab_result:       { label: 'Lab Results',    cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-400/30' },
                          medical_report:   { label: 'Medical Report', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30' },
                          discharge_summary:{ label: 'Discharge',      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30' },
                          referral:         { label: 'Referral',       cls: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-400/30' },
                          claim_form:       { label: 'Claim Form',     cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-400/30' },
                          pre_auth:         { label: 'Pre-Auth',       cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-400/30' },
                          supporting:       { label: 'Supporting',     cls: 'bg-gray-500/15 text-gray-600 dark:text-gray-300 border-gray-400/30' },
                        }

                        return (
                          <Section icon={<Brain className="h-3.5 w-3.5 text-amber-500" />} label="Clinical Overview" color="bg-amber-500/5 border-amber-500/10">
                            <div className="col-span-2 space-y-2.5">

                              {/* Document types identified */}
                              {docTypes.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center gap-1 cursor-help border-b border-dashed border-muted-foreground/40">
                                          <Tag className="h-2.5 w-2.5" /> Documents Identified
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        Document types detected in the uploaded files. A valid claim should include an invoice at minimum. Supporting documents (lab results, prescription, referral) strengthen the claim's legitimacy.
                                      </TooltipContent>
                                    </Tooltip>
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {docTypes.map((d, i) => {
                                      const m = docTypeMeta[d.documentType]
                                      return m ? (
                                        <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold border ${m.cls}`}>
                                          <FileText className="h-2.5 w-2.5 shrink-0" />{m.label}
                                        </span>
                                      ) : null
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Chief complaint */}
                              {cc && (
                                <div>
                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Chief Complaint</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        The patient's primary reason for seeking medical attention, as recorded by the clinician. Should be clinically consistent with the diagnosis — a mismatch is a red flag.
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <p className="text-xs leading-snug break-words">{cc}</p>
                                </div>
                              )}

                              {/* Diagnosis */}
                              {diag && (
                                <div>
                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5 flex items-center flex-wrap gap-x-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Diagnosis</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        The medical condition for which treatment was sought. Verify the ICD-10 code matches the written diagnosis and that both are clinically consistent with the treatment procedures and invoice cost profile.
                                      </TooltipContent>
                                    </Tooltip>
                                    {ai ? <AiBadge /> : <ManualBadge />}
                                  </div>
                                  <p className="text-xs font-semibold leading-snug break-words">{diag}</p>
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    {selectedClaim.diagnosisCode && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge variant="outline" className="font-mono text-[10px] px-2 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 cursor-help">
                                            ICD-10: {selectedClaim.diagnosisCode}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                          International Classification of Diseases code. Verify this code correctly represents the stated diagnosis and is appropriate for the procedures billed.
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {selectedClaim.procedureCode && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge variant="outline" className="font-mono text-[10px] px-2 bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 cursor-help">
                                            CPT: {selectedClaim.procedureCode}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                          Current Procedural Terminology code identifying the procedure performed. Confirm it matches the treatment description and is billable under the member's plan.
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Treatment */}
                              {treat && (
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Treatment / Procedure</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        The clinical procedures or services performed. Every line item on the invoice must correspond to a procedure listed here. Procedures must also be clinically appropriate for the stated diagnosis.
                                      </TooltipContent>
                                    </Tooltip>
                                  </p>
                                  <p className="text-xs leading-snug break-words">{treat}</p>
                                </div>
                              )}

                              {/* Medications prescribed */}
                              {meds.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Medications Prescribed</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        Medications listed in the prescription or clinical notes. Verify each is appropriate for the diagnosis and that billed quantities match the prescription. Flag expensive medications not supported by clinical notes.
                                      </TooltipContent>
                                    </Tooltip>
                                  </p>
                                  <ul className="space-y-0.5">
                                    {meds.slice(0, 6).map((m, i) => (
                                      <li key={i} className="flex items-start gap-1 text-[10px] text-foreground">
                                        <span className="text-violet-500 mt-0.5 shrink-0">·</span>
                                        <span className="leading-snug">{m}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Lab results */}
                              {lab && (
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Lab / Investigations</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        Laboratory tests or investigations ordered. Confirm that supporting lab result documents are attached and that each test is appropriate for the stated diagnosis. Billing for tests without attached results is a fraud indicator.
                                      </TooltipContent>
                                    </Tooltip>
                                  </p>
                                  <p className="text-xs leading-snug text-muted-foreground break-words">{lab}</p>
                                </div>
                              )}

                              {/* Doctor's notes */}
                              {notes && (
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-0.5">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40">Doctor's Notes</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                        Clinical notes recorded by the attending physician. Look for inconsistencies with the diagnosis, unsigned notes, generic or templated language, or copy-paste patterns seen across multiple claims from the same provider.
                                      </TooltipContent>
                                    </Tooltip>
                                  </p>
                                  <p className="text-xs leading-snug italic text-muted-foreground border-l-2 border-amber-400/40 pl-2 break-words">{notes}</p>
                                </div>
                              )}

                              {/* OCR engine badge */}
                              {ocrData?.ocrEngine && (
                                <p className="text-[9px] text-muted-foreground/50 flex items-center gap-1">
                                  <ScanLine className="h-2.5 w-2.5" />
                                  Extracted by {ocrData.ocrEngine}
                                  {ocrData.overallConfidence != null && ` · ${(ocrData.overallConfidence * 100).toFixed(0)}% confidence`}
                                </p>
                              )}
                            </div>
                          </Section>
                        )
                      })()}

                      {/* Metadata */}
                      <Section icon={<Hash className="h-3.5 w-3.5 text-slate-400" />} label="Metadata" color="bg-muted/30">
                        <div className="col-span-2">
                          <Field
                            label="Batch"
                            value={selectedClaim.batchNumber}
                            isAi={false}
                            mono
                            tooltip="The submission batch this claim was grouped under. Claims in the same batch were submitted together — if one claim in the batch is fraudulent, review all others in the same batch for related patterns."
                          />
                        </div>
                        <div className="col-span-2">
                          <Field
                            label="Uploaded by"
                            value={selectedClaim.uploadedBy}
                            isAi={false}
                            tooltip="The user account that submitted this claim. Verify this is an authorised submitter for the provider. A high volume of flagged claims from the same submitter may indicate an insider threat or compromised account."
                          />
                        </div>
                        <div className="col-span-2">
                          <Field
                            label="Submitted"
                            value={formatDate(selectedClaim.submittedAt)}
                            isAi={false}
                            tooltip="Timestamp when this claim entered the system. Claims submitted outside business hours, on weekends, or in unusual burst patterns warrant additional scrutiny."
                          />
                        </div>
                        {selectedClaim.aiConfidence && (
                          <div className="col-span-2">
                            <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help border-b border-dashed border-muted-foreground/40">OCR Confidence</span>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-[300px] text-xs leading-relaxed">
                                  The AI engine's self-assessed accuracy for extracting field values from uploaded documents. Below 70% requires manual field-by-field verification. Low confidence is caused by poor scan quality, handwritten text, or unusual document formatting.
                                </TooltipContent>
                              </Tooltip>
                              <AiBadge />
                            </p>
                            <div className="flex items-center gap-3">
                              <Progress value={selectedClaim.aiConfidence * 100} className="h-2 flex-1" />
                              <span className={`text-sm font-black tabular-nums w-10 text-right shrink-0 ${selectedClaim.aiConfidence > 0.9 ? 'text-emerald-500' : selectedClaim.aiConfidence > 0.75 ? 'text-amber-500' : 'text-red-500'}`}>
                                {(selectedClaim.aiConfidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        )}
                      </Section>

                      {/* B4: Coverage Breakdown — shows when member number is present */}
                      {selectedClaim.memberNumber && (
                        <div className="px-2 pb-2">
                          <CoverageBreakdown
                            memberId={selectedClaim.memberNumber}
                            claimId={selectedClaim.id}
                            invoiceAmount={selectedClaim.invoiceAmount}
                          />
                        </div>
                      )}

                    </div>
                    </TooltipProvider>
                  )
                })()}
              </div>

              {/* ══════ RIGHT — inline document viewer ══════ */}
              <div className="flex-1 flex flex-col bg-muted/20 min-w-0">
                {/* Document selector strip */}
                {selectedClaim.documents.length > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-background overflow-x-auto shrink-0">
                    {selectedClaim.documents.map((doc, i) => {
                      const ocrDoc = ocrData?.documents.find(d => d.id === doc.id)
                      const dtype = ocrDoc?.documentType ?? doc.documentType
                      const dtypeLabel: Record<string, { label: string; cls: string }> = {
                        invoice:          { label: 'Invoice',        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/30' },
                        prescription:     { label: 'Rx',             cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-400/30' },
                        lab_result:       { label: 'Lab',            cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-400/30' },
                        medical_report:   { label: 'Report',         cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-400/30' },
                        discharge_summary:{ label: 'Discharge',      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-400/30' },
                        referral:         { label: 'Referral',       cls: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-400/30' },
                        claim_form:       { label: 'Claim Form',     cls: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-400/30' },
                        pre_auth:         { label: 'Pre-Auth',       cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-400/30' },
                        supporting:       { label: 'Supporting',     cls: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-400/30' },
                      }
                      const dInfo = dtype ? dtypeLabel[dtype] : null
                      const isActive = viewingDoc?.name === doc.name
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setViewingDoc(doc); setViewerOpen(false) }}
                          className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors ${
                            isActive ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                          }`}
                        >
                          <FileText className="h-2.5 w-2.5 shrink-0" />
                          <span className="max-w-[120px] truncate">{doc.name}</span>
                          {dInfo && (
                            <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold border ${isActive ? 'bg-white/20 text-white border-white/30' : dInfo.cls}`}>
                              {dInfo.label}
                            </span>
                          )}
                          <span className="opacity-50 ml-0.5">{(doc.size / 1024).toFixed(0)}KB</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Inline document viewer */}
                <div className="flex-1 overflow-hidden flex flex-col">
                  {viewingDoc && !viewerReady && (
                    <div className="flex items-center gap-2 text-muted-foreground m-auto">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Loading {viewingDoc.name}…</span>
                    </div>
                  )}
                  {viewingDoc && viewerReady && (viewerBytes || viewerUrl) && (
                    <InlinePdfViewer
                      key={viewingDoc.name}
                      bytes={viewerBytes}
                      url={viewerUrl}
                      onFullScreen={() => setViewerOpen(true)}
                      annotations={ocrData?.fields ?? []}
                      fraudSignalCount={(selectedClaim?.fraudSignals ?? []).length}
                      claimId={selectedClaim?.id}
                    />
                  )}
                  {viewingDoc && viewerReady && !viewerBytes && !viewerUrl && (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground m-auto text-center p-6">
                      <FileText className="h-10 w-10 opacity-20" />
                      <p className="text-sm">Preview not available</p>
                      <Button size="sm" variant="outline" onClick={() => setViewerOpen(true)}>
                        <Eye className="mr-2 h-3.5 w-3.5" /> Open Full Viewer
                      </Button>
                    </div>
                  )}
                  {!viewingDoc && selectedClaim.documents.length > 0 && (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground m-auto text-center p-6">
                      <FileText className="h-10 w-10 opacity-20" />
                      <p className="text-sm">Select a document above to preview it</p>
                    </div>
                  )}
                  {selectedClaim.documents.length === 0 && (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground m-auto">
                      <FileText className="h-10 w-10 opacity-20" />
                      <p className="text-sm">No documents attached</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── NEW CLAIM DIALOG ── */}
      <Dialog open={showNewClaim} onOpenChange={(open) => { if (!open) resetForm(); setShowNewClaim(open) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Claim</DialogTitle>
            <DialogDescription>Upload a document for AI extraction or fill in all fields manually</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* AI extraction section */}
            <div className="rounded-lg border-2 border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-5 w-5 text-violet-600" />
                <h3 className="font-semibold text-sm">AI Document Extraction</h3>
                <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 text-[10px]">Optional</Badge>
              </div>
              <div className="space-y-2">
                {attachedFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border bg-background p-2">
                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif" multiple onChange={handleFileAttach} />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-3 w-3" /> Attach Document
                </Button>
                {attachedFiles.length > 0 && !aiExtracted && (
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={handleAiExtract} disabled={aiExtracting}>
                    {aiExtracting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Extracting...</> : <><Sparkles className="mr-2 h-3 w-3" /> Extract with AI</>}
                  </Button>
                )}
              </div>
              {aiExtracting && <div className="mt-3"><Progress value={65} className="h-1" /><p className="text-xs text-violet-600 mt-1">AI is analysing the document...</p></div>}
              {aiExtracted && (
                <div className="mt-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2">
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2"><CheckCircle className="h-4 w-4" /> AI extraction complete — fields filled below</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Form fields */}
            <div className="space-y-4">
              {/* Patient / Member */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> Patient / Member</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Member Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="Full name" value={formData.memberName} onChange={(e) => setField('memberName', e.target.value)} className={formErrors.memberName ? 'border-destructive' : ''} />
                    {formErrors.memberName && <p className="text-xs text-destructive">{formErrors.memberName}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Member Number</Label>
                    <Input placeholder="MBR-XXXXXX" value={formData.memberNumber} onChange={(e) => setField('memberNumber', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Patient ID</Label>
                    <Input placeholder="e.g. UH283003051" value={formData.patientId} onChange={(e) => setField('patientId', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Provider & Invoice */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Provider & Invoice</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Provider <span className="text-destructive">*</span></Label>
                    <Select value={formData.provider} onValueChange={(v) => setField('provider', v)}>
                      <SelectTrigger className={formErrors.provider ? 'border-destructive' : ''}><SelectValue placeholder="Select provider" /></SelectTrigger>
                      <SelectContent>{PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                    {formErrors.provider && <p className="text-xs text-destructive">{formErrors.provider}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Amount (KES) <span className="text-destructive">*</span></Label>
                    <Input type="number" placeholder="0.00" value={formData.invoiceAmount} onChange={(e) => setField('invoiceAmount', e.target.value)} className={formErrors.invoiceAmount ? 'border-destructive' : ''} />
                    {formErrors.invoiceAmount && <p className="text-xs text-destructive">{formErrors.invoiceAmount}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Number</Label>
                    <Input placeholder="e.g. INV-2024-001" value={formData.invoiceNumber} onChange={(e) => setField('invoiceNumber', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Date</Label>
                    <Input type="date" value={formData.invoiceDate} onChange={(e) => setField('invoiceDate', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Service / Visit Date</Label>
                    <Input type="date" value={formData.serviceDate} onChange={(e) => setField('serviceDate', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priority</Label>
                    <Select value={formData.priority} onValueChange={(v) => setField('priority', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['low', 'normal', 'high', 'urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Medical */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Medical Information</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2">
                    <Label>Diagnosis</Label>
                    <Input placeholder="e.g. Malaria, Type 2 Diabetes" value={formData.diagnosis} onChange={(e) => setField('diagnosis', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Diagnosis Code (ICD)</Label>
                    <Input placeholder="e.g. B50.9" value={formData.diagnosisCode} onChange={(e) => setField('diagnosisCode', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Procedure Code (CPT)</Label>
                    <Input placeholder="e.g. 99214" value={formData.procedureCode} onChange={(e) => setField('procedureCode', e.target.value)} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label>Treatment / Prescription</Label>
                    <Textarea placeholder="Describe treatment given..." value={formData.treatment} onChange={(e) => setField('treatment', e.target.value)} rows={2} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label>Notes</Label>
                    <Textarea placeholder="Additional notes..." value={formData.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { resetForm(); setShowNewClaim(false) }}>Cancel</Button>
            <Button onClick={handleCreateClaim}>
              <Plus className="mr-2 h-4 w-4" /> Submit Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DOCUMENT VIEWER — full-screen portal, shown when user clicks "Open Full Viewer" ── */}
      {viewingDoc && viewerReady && viewerOpen && (
        <DocumentViewer
          key={selectedClaim?.barcode || viewingDoc.name}
          bytes={viewerBytes}
          url={viewerUrl}
          ready={viewerReady}
          filename={viewingDoc.name}
          mimeType={viewingDoc.type}
          claimId={selectedClaim?.id}
          barcode={selectedClaim?.barcode}
          ocrFields={ocrData?.fields ?? []}
          onClose={() => { setViewerOpen(false) }}
        />
      )}

      {/* ── DELETE CONFIRMATION ── */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {showDeleteConfirm === 'bulk' ? `Delete ${selectedIds.size} Claims` : 'Delete Claim'}
            </DialogTitle>
            <DialogDescription>
              {showDeleteConfirm === 'bulk'
                ? `Delete ${selectedIds.size} selected claims? This cannot be undone.`
                : 'Delete this claim? This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {showDeleteConfirm && showDeleteConfirm !== 'bulk' && (() => {
            const c = claims.find(cl => cl.id === showDeleteConfirm)
            return c ? (
              <div className="rounded-lg border p-3 bg-muted/50 text-sm space-y-1">
                <p><span className="text-muted-foreground">Claim:</span> <span className="font-medium">{c.claimNumber}</span></p>
                <p><span className="text-muted-foreground">Member:</span> <span className="font-medium">{sanitizeMemberField(c.memberName)}</span></p>
                <p><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{formatCurrency(c.invoiceAmount)}</span></p>
              </div>
            ) : null
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (showDeleteConfirm === 'bulk') { deleteClaims(Array.from(selectedIds)); setSelectedIds(new Set()) }
              else if (showDeleteConfirm) { deleteClaim(showDeleteConfirm); const next = new Set(selectedIds); next.delete(showDeleteConfirm); setSelectedIds(next) }
              setShowDeleteConfirm(null)
            }}>
              <Trash2 className="mr-2 h-4 w-4" /> {showDeleteConfirm === 'bulk' ? `Delete ${selectedIds.size} Claims` : 'Delete Claim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── FRAUD DENIAL TO PROVIDER ── */}
      <Dialog open={!!denialClaim} onOpenChange={(o) => !o && setDenialClaim(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Send className="h-5 w-5" />
              Send Denial Notification to Provider
            </DialogTitle>
            <DialogDescription>
              Notify the provider that this claim has been permanently rejected due to confirmed fraud.
              This is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          {denialClaim && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claim</span>
                  <span className="font-mono font-semibold">{denialClaim.claimNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span>{denialClaim.provider?.name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Member</span>
                  <span>{sanitizeMemberField(denialClaim.memberName)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold line-through text-muted-foreground">{formatCurrency(denialClaim.invoiceAmount)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Denial message to provider <span className="text-muted-foreground text-xs">(optional — pre-filled)</span></Label>
                <Textarea
                  rows={5}
                  value={denialNote || `Dear ${denialClaim.provider?.name || 'Provider'},\n\nThis is to formally notify you that claim ${denialClaim.claimNumber} has been permanently declined following a fraud investigation by our Fraud & Risk team.\n\nNo payment will be made against this invoice. Please contact CIC Insurance for further clarification.\n\nRegards,\nCIC Claims Department`}
                  onChange={(e) => setDenialNote(e.target.value)}
                  className="resize-none text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenialClaim(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={sendingDenial}
              onClick={async () => {
                if (!denialClaim) return
                setSendingDenial(true)
                try {
                  await api.post(`/claims/${denialClaim.id}/notify-denial`, { message: denialNote })
                  toast.success('Denial notification sent to provider')
                } catch {
                  toast.error('Failed to send notification')
                } finally {
                  setSendingDenial(false)
                  setDenialClaim(null)
                }
              }}
            >
              {sendingDenial ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Denial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── COLUMN CUSTOMIZER ── */}
      <Dialog open={showColumnCustomizer} onOpenChange={setShowColumnCustomizer}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Customize Columns
            </DialogTitle>
            <DialogDescription>
              Toggle visibility and drag to reorder columns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-2">
            {columnDefs.map((col, idx) => (
              <div
                key={col.id}
                draggable
                onDragStart={() => setDragColIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); if (dragColIdx === null || dragColIdx === idx) return; const next = [...columnDefs]; const [moved] = next.splice(dragColIdx, 1); next.splice(idx, 0, moved); setColumnDefs(next); setDragColIdx(idx) }}
                onDragEnd={() => setDragColIdx(null)}
                className={`flex items-center gap-3 px-2 py-2 rounded-md cursor-grab select-none transition-colors ${dragColIdx === idx ? 'opacity-50 bg-muted' : 'hover:bg-muted/60'}`}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm font-medium">{col.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={col.visible}
                  onClick={() => setColumnDefs(prev => prev.map((c, i) => i === idx ? { ...c, visible: !c.visible } : c))}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${col.visible ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${col.visible ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setColumnDefs(DEFAULT_COLUMNS)}>
              <RotateCcw className="mr-2 h-3 w-3" /> Reset to default
            </Button>
            <Button size="sm" onClick={() => setShowColumnCustomizer(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
