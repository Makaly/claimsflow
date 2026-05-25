import { Fragment, useState, useCallback, useEffect, useRef } from 'react'
import CameraScanner from '@/components/CameraScanner'
import { useDropzone } from 'react-dropzone'
import { downloadXlsx } from '@/lib/xlsx-export'
import * as pdfjsLib from 'pdfjs-dist'
import {
  Upload, X, CheckCircle, AlertCircle,
  Loader2, CloudUpload, Brain, Sparkles,
  FileSpreadsheet, Download, Eye, EyeOff, FileText,
  Link2, ArrowRight, ShieldCheck, ClipboardList, Scan,
  User, Receipt, Stethoscope, ScanBarcode, TrendingUp,
  ListOrdered, CheckCircle2, XCircle,
  CreditCard, Calendar, Building2, Hash, RotateCcw, History,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  MousePointer, Highlighter, MessageSquare,
  Pen, FileSignature, Eraser, Square, Stamp,
  Underline, Strikethrough, ChevronDown, Save, MapPin,
  Copy, Check, AlertTriangle, Trash2,
  ScanLine, Printer, RefreshCw, WifiOff, Wifi, Camera, CameraOff,
  Layers, FileX, RotateCw, FileStack,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrency, cn } from '@/lib/utils'
import { useClaimsStore } from '@/store/claimsStore'
import { useAuthStore } from '@/store/authStore'
import { useBatchSessionStore, saveClaims, loadClaims } from '@/store/batchSessionStore'
import { cacheFile, cacheFiles, restoreFiles, restoreAsFiles, clearCachedFiles } from '@/lib/fileCache'
import { stampBarcodeOnPdf, stampBarcodeOnImage, splitAndStampPdf } from '@/lib/pdfBarcode'
import { extractInvoicesFromPdf, type ExtractedInvoiceData } from '@/lib/pdfTextExtract'
import api from '@/services/api'
import { useScanMetering } from '@/hooks/useScanMetering'
import { getDeviceInfo as getDeviceInfoForScan } from '@/lib/deviceInfo'

// Worker configured globally in main.tsx

type Step = 'upload' | 'ai_extracting' | 'manual_processing' | 'review' | 'publishing' | 'complete'

interface ExtractedClaim {
  id: string
  barcode: string
  fileName: string
  fileSize: number
  fileUrl: string
  fileType: string
  claimNumber: string
  patientName: string
  patientId: string
  memberNumber: string   // AK Number / membership number
  providerName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  serviceDate: string
  diagnosis: string
  diagnosisCode: string
  procedureCode: string
  treatment: string
  aiConfidence: number
  aiVerified: boolean
  status: 'extracting' | 'extracted' | 'verified' | 'published' | 'error'
  fileBytes?: Uint8Array   // stamped PDF bytes kept in memory for IDB caching
  splitFrom?: string
  invoiceIndex?: number
  totalInvoicesInPdf?: number
  pageRange?: string
  documentPages?: Array<{
    pageNumber: number
    category: string
    categoryLabel: string
    confidence: number
    summary: string
  }>
  lineItems?: Array<{
    description: string
    quantity?: number
    unitPrice?: number
    totalPrice?: number
    taxAmount?: number
    discount?: number
    serviceDate?: string
    procedureCode?: string
    ocrConfidence?: number
    lineNumber?: number
  }>
  /** Structural warnings from the backend extraction validator. */
  validationWarnings?: string[]
  dbId?: string            // backend claim UUID (set after publish)
  annotations?: Annotation[] // persisted PDF annotations
}

// ---- Barcode Generator ----
// Format: C + YYYYMMDDHHMMSS + sequential (resets daily)
// Example: C20240104503243
let barcodeDate = ''
let barcodeCounter = 0

function generateBarcode(): string {
  const now = new Date()
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const timeStr = String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')

  // Reset counter if new day
  if (dateStr !== barcodeDate) {
    barcodeDate = dateStr
    barcodeCounter = 0
  }
  barcodeCounter++

  return `C${dateStr}${timeStr}${String(barcodeCounter).padStart(2, '0')}`
}

// ---- AI Extraction with multi-invoice detection ----
interface ExtractionResult {
  invoices: Array<{
    patientName: string; patientId: string; memberNumber: string; providerName: string
    invoiceNumber: string; invoiceDate: string; invoiceAmount: number
    serviceDate: string; diagnosis: string; diagnosisCode: string
    procedureCode: string; treatment: string; aiConfidence: number
    pageRange: string; documentPages?: Array<{ pageNumber: number; category: string; categoryLabel: string; confidence: number; summary: string }>
    lineItems?: Array<{
      description: string; quantity?: number; unitPrice?: number; totalPrice?: number
      taxAmount?: number; discount?: number; serviceDate?: string; procedureCode?: string
      ocrConfidence?: number; lineNumber?: number
    }>
  }>
}

// Use file content to generate a deterministic hash for unique-per-file data
function hashBytes(bytes: Uint8Array): number {
  let h = 0
  const step = Math.max(1, Math.floor(bytes.length / 500))
  for (let i = 0; i < bytes.length; i += step) {
    h = ((h << 5) - h + bytes[i]) | 0
  }
  return Math.abs(h)
}

// Seeded random from hash - ensures same file always produces same extraction
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const patientPool = [
  { name: 'David Nyunda', id: 'GN-15761E-23' },
  { name: 'Jane Atieno Odhiambo', id: 'KN-22347-21' },
  { name: 'Peter Mwangi Kamau', id: 'MP-88120-24' },
  { name: 'Grace Waithera Njoroge', id: 'AK-44521-22' },
  { name: 'Samuel Kipchirchir Kosgei', id: 'EH-33190-23' },
  { name: 'Mary Akinyi Owino', id: 'NW-71604-24' },
  { name: 'Joseph Karanja Maina', id: 'KH-55823-22' },
  { name: 'Elizabeth Wambui Ndungu', id: 'GH-90152-23' },
  { name: 'Michael Ochieng Otieno', id: 'NH-12487-24' },
  { name: 'Catherine Njeri Muturi', id: 'AV-67834-21' },
  { name: 'Francis Kiprop Bett', id: 'MS-45210-23' },
  { name: 'Agnes Chebet Rono', id: 'MH-78963-24' },
  { name: 'Robert Wekesa Simiyu', id: 'KN-33456-22' },
  { name: 'Margaret Achieng Ouma', id: 'NH-56712-23' },
  { name: 'John Mugo Ndirangu', id: 'AK-89034-24' },
]
const providerPool = [
  'Guru Nanak Ramgarhia Sikh Hospital', 'Nairobi Hospital', 'Aga Khan University Hospital',
  'MP Shah Hospital', 'Karen Hospital', 'Kenyatta National Hospital',
  'Gertrude Children\'s Hospital', 'Avenue Hospital', 'Mater Hospital',
  'Nairobi Women\'s Hospital', 'Coptic Hospital', 'Metropolitan Hospital',
]
const diagnosisPool = [
  { name: 'Acute Malaria (Plasmodium falciparum)', code: 'B50.9', proc: '99214', treatment: 'Artemether-Lumefantrine 80/480mg, IV Artesunate, blood transfusion 2 units' },
  { name: 'Type 2 Diabetes Mellitus - uncontrolled', code: 'E11.65', proc: '99215', treatment: 'Metformin 1000mg BD, Glimepiride 2mg OD, HbA1c monitoring, dietary counseling' },
  { name: 'Community-acquired Pneumonia', code: 'J18.9', proc: '99222', treatment: 'IV Ceftriaxone 1g BD, Azithromycin 500mg OD, chest physiotherapy, O2 therapy' },
  { name: 'Lumbar Disc Herniation L4-L5', code: 'M51.16', proc: '99203', treatment: 'MRI lumbar spine, physiotherapy 10 sessions, Pregabalin 75mg BD, epidural injection' },
  { name: 'Essential Hypertension - stage 2', code: 'I10', proc: '99213', treatment: 'Amlodipine 10mg OD, Losartan 50mg OD, ECG, renal function tests' },
  { name: 'Acute Gastroenteritis', code: 'A09', proc: '99283', treatment: 'ORS, IV Normal Saline 1L, Ondansetron 4mg IV, stool culture' },
  { name: 'Urinary Tract Infection', code: 'N39.0', proc: '99214', treatment: 'Ciprofloxacin 500mg BD x7 days, urine culture, renal ultrasound' },
  { name: 'Upper Respiratory Tract Infection', code: 'J06.9', proc: '99213', treatment: 'Amoxicillin 500mg TDS, Paracetamol 1g QDS, steam inhalation' },
  { name: 'Iron Deficiency Anaemia', code: 'D50.9', proc: '99204', treatment: 'Ferrous sulphate 200mg TDS, folic acid 5mg OD, CBC monitoring, dietary advice' },
  { name: 'Acute Appendicitis', code: 'K35.80', proc: '44970', treatment: 'Laparoscopic appendectomy, IV Metronidazole, post-op care 3 days' },
  { name: 'Fracture of distal radius', code: 'S52.501A', proc: '25600', treatment: 'Closed reduction, POP cast application, X-ray control, analgesics' },
  { name: 'Acute Tonsillitis', code: 'J03.90', proc: '99214', treatment: 'Penicillin V 500mg QDS, Ibuprofen 400mg TDS, throat swab culture' },
]

const simulateExtractFromPdf = async (file: File, _baseIndex: number): Promise<ExtractionResult> => {
  // Read actual file bytes to generate unique per-file data
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const fileHash = hashBytes(bytes)
  const rand = seededRandom(fileHash)

  // Try to get actual page count from PDF
  let actualPageCount = 1
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
    actualPageCount = pdf.getPageCount()
  } catch { /* not a valid PDF or encrypted */ }

  // Determine number of invoices based on actual page count
  // Heuristic: ~2-3 pages per invoice
  const numInvoices = actualPageCount >= 6 ? Math.ceil(actualPageCount / 3) :
                      actualPageCount >= 4 ? 2 :
                      1

  const invoices = []
  let currentPage = 1
  const pagesPerInvoice = Math.max(1, Math.floor(actualPageCount / numInvoices))

  for (let i = 0; i < numInvoices; i++) {
    // Each invoice gets unique data seeded by file hash + invoice index
    const patIdx = Math.floor(rand() * patientPool.length)
    const provIdx = Math.floor(rand() * providerPool.length)
    const diagIdx = Math.floor(rand() * diagnosisPool.length)
    const diag = diagnosisPool[diagIdx]
    const patient = patientPool[patIdx]

    const amount = Math.floor(rand() * 350000) + 3000
    const daysAgo = Math.floor(rand() * 60) + 1
    const svcDate = new Date(Date.now() - daysAgo * 86400000)

    // Generate invoice number from file name if possible
    const fnMatch = file.name.match(/INV\w*(\d+)/i) || file.name.match(/(\d{6,})/i)
    const invSuffix = fnMatch ? fnMatch[1] : String(1000 + Math.floor(rand() * 9000))

    const pageStart = currentPage
    const pageEnd = Math.min(pageStart + pagesPerInvoice - 1, actualPageCount)
    currentPage = pageEnd + 1

    invoices.push({
      patientName: patient.name,
      patientId: patient.id,
      memberNumber: '',
      providerName: providerPool[provIdx],
      invoiceNumber: `CB-${invSuffix}-${String(20 + i + Math.floor(rand() * 10))}`,
      invoiceDate: svcDate.toISOString().split('T')[0],
      invoiceAmount: amount,
      serviceDate: new Date(svcDate.getTime() - Math.floor(rand() * 5) * 86400000).toISOString().split('T')[0],
      diagnosis: diag.name,
      diagnosisCode: diag.code,
      procedureCode: diag.proc,
      treatment: diag.treatment,
      // 0 confidence — never claim AI-extracted on synthetic fallback data.
      // The UI shows "Fill in fields manually or auto-fill" when confidence is 0.
      aiConfidence: 0,
      pageRange: pageStart === pageEnd ? `${pageStart}` : `${pageStart}-${pageEnd}`,
    })
  }

  // Simulate processing time (shorter now since we actually read the file)
  await new Promise(r => setTimeout(r, 800 + rand() * 1200))

  return { invoices }
}

// Fallback-only batch number — used only if the server reservation call fails.
// Each tab gets its own counter via crypto.randomUUID to avoid cross-tab collisions.
const _tabSuffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0')
let _fallbackSeq = 0
function _fallbackBatchNumber(): string {
  _fallbackSeq++
  return `BTH-${new Date().getFullYear()}-F${_tabSuffix.slice(0, 4)}${String(_fallbackSeq).padStart(2, '0')}`
}

// Persistent claim sequence — survives page refreshes so numbers never repeat
let _claimSeq = parseInt(localStorage.getItem('_claimSeq') || '300', 10)
function nextClaimNumber(): string {
  _claimSeq++
  localStorage.setItem('_claimSeq', String(_claimSeq))
  return `CLM-${new Date().getFullYear()}-${String(_claimSeq).padStart(5, '0')}`
}

// ---- Tiny layout helpers used inside DocPreviewModal ----
function DPSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-gray-400">{label}</p>
      </div>
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-gray-100/40 dark:bg-gray-800/40 divide-y divide-gray-200 dark:divide-gray-700/50 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
function DPField({ label, value, bold, mono, accent }: { label: string; value: React.ReactNode; bold?: boolean; mono?: boolean; accent?: string }) {
  return (
    <div className="px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</p>
      <p className={`text-xs leading-snug break-words ${bold ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'} ${mono ? 'font-mono' : ''} ${accent || ''}`}>
        {value || <span className="text-gray-500 dark:text-gray-600 italic">—</span>}
      </p>
    </div>
  )
}

// ---- Editable field (inline input, styled to match the dark panel) ----
function EF({ label, value, onChange, bold, mono, accent, required, copy }: {
  label: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  bold?: boolean; mono?: boolean; accent?: string; required?: boolean; copy?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const isEmpty = required && !value.trim()
  const handleCopy = () => {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <div className={`px-3 py-2 group ${isEmpty ? 'bg-amber-950/20' : ''}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className={`text-[9px] uppercase tracking-wider flex items-center gap-1 ${isEmpty ? 'text-amber-500/80' : 'text-gray-500'}`}>
          {label}{isEmpty && <span className="text-amber-500">*</span>}
        </p>
        {copy && value && (
          <button onClick={handleCopy} title="Copy" className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 dark:text-gray-600 hover:text-violet-400">
            {copied ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
          </button>
        )}
      </div>
      <input
        value={value}
        onChange={onChange}
        placeholder={isEmpty ? 'Required — fill in' : undefined}
        className={`w-full bg-transparent text-xs outline-none border-b transition-colors leading-snug break-all ${
          isEmpty
            ? 'border-amber-500/40 placeholder:text-amber-700 text-amber-300 focus:border-amber-400'
            : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-violet-500/60'
        } ${bold ? 'font-semibold text-gray-900 dark:text-white' : isEmpty ? '' : 'text-gray-700 dark:text-gray-300'} ${mono ? 'font-mono' : ''} ${accent || ''}`}
      />
    </div>
  )
}

function DateEF({ label, value, onChange, required }: {
  label: string; value: string
  onChange: (val: string) => void
  required?: boolean
}) {
  const MONTHS: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  }
  const toIso = (str: string): string => {
    if (!str?.trim()) return ''
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
    const m1 = str.match(/^(\d{1,2})[-/ ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-/ ](\d{4})/i)
    if (m1) return `${m1[3]}-${MONTHS[m1[2].toLowerCase()]}-${String(m1[1]).padStart(2,'0')}`
    const m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m2) return `${m2[3]}-${String(m2[2]).padStart(2,'0')}-${String(m2[1]).padStart(2,'0')}`
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return ''
  }
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const isoVal = toIso(value)
  const isEmpty = required && !value?.trim()
  const isFuture = isoVal && isoVal > today
  const showOriginal = value && isoVal && isoVal !== value.trim()
  return (
    <div className={`px-3 py-2 ${isEmpty ? 'bg-amber-950/20' : ''}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className={`text-[9px] uppercase tracking-wider flex items-center gap-1 ${isEmpty ? 'text-amber-500/80' : 'text-gray-500'}`}>
          {label}
          {isEmpty && <span className="text-amber-500">*</span>}
          {isFuture && <span className="inline-flex items-center gap-0.5 text-amber-400 text-[8px]"><AlertTriangle className="h-2 w-2" />Future</span>}
        </p>
        <div className="flex items-center gap-1">
          {!isoVal && (
            <>
              <button onClick={() => onChange(yesterday)} title="Yesterday" className="text-[8px] text-gray-500 dark:text-gray-600 hover:text-violet-400 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-700 px-1 rounded">-1d</button>
              <button onClick={() => onChange(today)} title="Today" className="text-[8px] text-gray-500 dark:text-gray-600 hover:text-violet-400 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-700 px-1 rounded">Today</button>
            </>
          )}
          {isoVal && <button onClick={() => onChange('')} title="Clear date" className="text-gray-400 dark:text-gray-700 hover:text-red-400 transition-colors"><X className="h-2.5 w-2.5" /></button>}
        </div>
      </div>
      <input
        type="date"
        value={isoVal}
        max={label.toLowerCase().includes('service') ? today : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-transparent text-xs outline-none border-b transition-colors [color-scheme:light] dark:[color-scheme:dark] ${
          isEmpty ? 'border-amber-500/40 text-amber-300 focus:border-amber-400'
          : isFuture ? 'border-amber-500/30 text-amber-300 focus:border-amber-400'
          : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-violet-500/60 text-gray-700 dark:text-gray-300'
        }`}
      />
      {showOriginal && <p className="text-[8px] text-gray-400 dark:text-gray-700 mt-0.5 font-mono">Extracted: {value}</p>}
    </div>
  )
}

// ---- Annotation type ----
type AnnotationType = 'highlight' | 'underline' | 'strikethrough' | 'note' | 'stamp' | 'whiteout' | 'redaction' | 'draw' | 'signature'
type AnnotationTool = 'pointer' | 'ocr_zone' | AnnotationType

// OCR zone field targets
const OCR_FIELD_OPTIONS = [
  { value: 'patientName',   label: 'Patient Name' },
  { value: 'patientId',     label: 'Patient ID' },
  { value: 'memberNumber',  label: 'Member Number' },
  { value: 'providerName',  label: 'Provider' },
  { value: 'invoiceNumber', label: 'Invoice Number' },
  { value: 'invoiceDate',   label: 'Invoice Date' },
  { value: 'invoiceAmount', label: 'Amount' },
  { value: 'serviceDate',   label: 'Service Date' },
  { value: 'diagnosis',     label: 'Diagnosis' },
  { value: 'diagnosisCode', label: 'Diagnosis Code' },
  { value: 'procedureCode', label: 'Procedure Code' },
  { value: 'treatment',     label: 'Treatment' },
] as const

const STAMPS = [
  { label: 'APPROVED',     color: '#10b981', bg: 'rgba(16,185,129,0.12)'  },
  { label: 'RECEIVED',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
  { label: 'REVIEWED',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)'  },
  { label: 'REJECTED',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  { label: 'CONFIDENTIAL', color: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
  { label: 'COPY',         color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  { label: 'VERIFIED',     color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'   },
]

interface Annotation {
  id: string
  page: number
  type: AnnotationType
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  points?: Array<{ x: number; y: number }>
  createdBy?: string
  createdAt?: string
}

// ---- Annotation toolbar button ----
function ToolBtn({ active, onClick, icon, label, color, trailingIcon }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
  color: 'gray'|'amber'|'blue'|'red'|'purple'|'cyan'; trailingIcon?: React.ReactNode
}) {
  const ac: Record<string, string> = {
    amber:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
    blue:   'bg-blue-500/20 text-blue-300 border-blue-500/40',
    red:    'bg-red-500/20 text-red-300 border-red-500/40',
    purple: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
    gray:   'bg-gray-200 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600',
    cyan:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  }
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all whitespace-nowrap ${
      active ? ac[color] : 'text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700'
    }`}>
      {icon} {label} {trailingIcon}
    </button>
  )
}

// ---- Full-screen Document Preview Modal ----
function DocPreviewModal({ doc, onClose, onSave }: {
  doc: ExtractedClaim
  onClose: () => void
  onSave: (updated: ExtractedClaim) => void
}) {
  // Editable mirror of doc fields
  const [edit, setEdit] = useState({
    patientName:   doc.patientName,
    patientId:     doc.patientId,
    memberNumber:  doc.memberNumber,
    providerName:  doc.providerName,
    invoiceNumber: doc.invoiceNumber,
    invoiceDate:   doc.invoiceDate,
    invoiceAmount: String(doc.invoiceAmount),
    serviceDate:   doc.serviceDate || new Date().toISOString().split('T')[0],
    diagnosis:     doc.diagnosis,
    diagnosisCode: doc.diagnosisCode,
    procedureCode: doc.procedureCode,
    treatment:     doc.treatment,
  })
  const dirty = JSON.stringify(edit) !== JSON.stringify({
    patientName: doc.patientName, patientId: doc.patientId, memberNumber: doc.memberNumber,
    providerName: doc.providerName, invoiceNumber: doc.invoiceNumber, invoiceDate: doc.invoiceDate,
    invoiceAmount: String(doc.invoiceAmount), serviceDate: doc.serviceDate || new Date().toISOString().split('T')[0], diagnosis: doc.diagnosis,
    diagnosisCode: doc.diagnosisCode, procedureCode: doc.procedureCode, treatment: doc.treatment,
  })
  const ef = (field: keyof typeof edit) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setEdit(prev => ({ ...prev, [field]: e.target.value }))
  const setField = (field: keyof typeof edit) => (val: string) =>
    setEdit(prev => ({ ...prev, [field]: val }))

  const autoFillFromOcr = async () => {
    setOcrFilling(true)
    try {
      // Try multiple sources to get the file bytes
      let blob: Blob | null = null

      // 1. Try fetching from the file URL (works for API URLs with auth).
      // Strip any /api prefix before passing to the Axios instance — the
      // instance already has baseURL='/api', so passing '/api/...' doubles it.
      if (doc.fileUrl && !doc.fileUrl.startsWith('blob:')) {
        try {
          const relUrl = doc.fileUrl.replace(/^\/api\//, '/')
          const { data } = await api.get(relUrl, { responseType: 'blob' })
          blob = data
        } catch { /* try next */ }
      }

      // 2. Try blob URL directly
      if (!blob && doc.fileUrl) {
        try {
          const res = await fetch(doc.fileUrl)
          if (res.ok) blob = await res.blob()
        } catch { /* try next */ }
      }

      // 3. Try restoring from IndexedDB cache
      if (!blob && doc.fileUrl) {
        try {
          const { restoreFileByName } = await import('@/lib/fileCache')
          const cached = await restoreFileByName(doc.fileName)
          if (cached) blob = cached
        } catch { /* try next */ }
      }

      if (!blob) {
        console.error('OCR: Could not access file bytes from any source')
        setOcrFilling(false)
        return
      }

      const file = new File([blob], doc.fileName, { type: doc.fileType || blob.type || 'application/pdf' })
      const { invoices } = await extractInvoicesFromPdf(file, undefined, localStorage.getItem('visionModel') || undefined)

      if (invoices.length > 0) {
        const inv = invoices[0]
        // Only fill fields that OCR extracted valid data for (not placeholders)
        const isPlaceholder = (v: string) => !v || v === 'OCR Processing Required' || v === 'Unknown Patient' || v === 'Upload to backend for extraction' || v === 'Unknown Provider'
        setEdit(prev => ({
          patientName:   !isPlaceholder(inv.patientName)      ? inv.patientName      : prev.patientName,
          patientId:     inv.patientId                        || prev.patientId,
          memberNumber:  inv.membershipNumber                 || prev.memberNumber,
          providerName:  !isPlaceholder(inv.providerName)     ? inv.providerName      : prev.providerName,
          invoiceNumber: inv.invoiceNumber                    || prev.invoiceNumber,
          invoiceDate:   inv.invoiceDate                      || prev.invoiceDate,
          invoiceAmount: inv.invoiceAmount ? String(inv.invoiceAmount) : prev.invoiceAmount,
          serviceDate:   inv.serviceDate                      || prev.serviceDate,
          diagnosis:     inv.diagnosis                        || prev.diagnosis,
          diagnosisCode: inv.diagnosisCode                    || prev.diagnosisCode,
          procedureCode: inv.procedureCode                    || prev.procedureCode,
          treatment:     inv.treatment                        || prev.treatment,
        }))

        // Update confidence on parent doc
        onSave({
          ...doc,
          aiConfidence:  inv.confidence || 0.8,
          patientName:   !isPlaceholder(inv.patientName) ? inv.patientName : doc.patientName,
          memberNumber:  inv.membershipNumber || doc.memberNumber,
          providerName:  !isPlaceholder(inv.providerName) ? inv.providerName : doc.providerName,
          invoiceNumber: inv.invoiceNumber || doc.invoiceNumber,
          invoiceDate:   inv.invoiceDate || doc.invoiceDate,
          invoiceAmount: inv.invoiceAmount || doc.invoiceAmount,
          diagnosis:     inv.diagnosis || doc.diagnosis,
          diagnosisCode: inv.diagnosisCode || doc.diagnosisCode,
          procedureCode: inv.procedureCode || doc.procedureCode,
          treatment:     inv.treatment || doc.treatment,
          lineItems:     inv.lineItems?.length ? inv.lineItems : doc.lineItems,
        })
      }
    } catch (err) {
      console.error('OCR auto-fill failed:', err)
    } finally {
      setOcrFilling(false)
    }
  }

  // Auto-save: debounce field changes → push to parent without closing modal
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    setSavedStatus('unsaved')
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      setSavedStatus('saving')
      onSave({
        ...doc,
        patientName:   edit.patientName,
        patientId:     edit.patientId,
        memberNumber:  edit.memberNumber,
        providerName:  edit.providerName,
        invoiceNumber: edit.invoiceNumber,
        invoiceDate:   edit.invoiceDate,
        invoiceAmount: parseFloat(edit.invoiceAmount) || doc.invoiceAmount,
        serviceDate:   edit.serviceDate,
        diagnosis:     edit.diagnosis,
        diagnosisCode: edit.diagnosisCode,
        procedureCode: edit.procedureCode,
        treatment:     edit.treatment,
      })
      setSavedStatus('saved')
    }, 600)
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current) }
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps

  const [pdfDoc, setPdfDoc]     = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum]   = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [zoom, setZoom]         = useState(1.0)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [thumbs, setThumbs]     = useState<string[]>([])
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pointer')
  const [annotations, setAnnotations] = useState<Annotation[]>(doc.annotations ?? [])
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [annotationSyncStatus, setAnnotationSyncStatus] = useState<'saved'|'saving'|'unsaved'>('saved')
  const annotationSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ocrFilling, setOcrFilling] = useState(false)
  const [drawing, setDrawing]   = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawPoints, setDrawPoints] = useState<Array<{ x: number; y: number }>>([])
  const [notePopup, setNotePopup] = useState<{ x: number; y: number; page: number } | null>(null)
  const [noteText, setNoteText] = useState('')
  const [showStampPicker, setShowStampPicker] = useState(false)
  const [selectedStamp, setSelectedStamp] = useState(STAMPS[0].label)
  const [showSignaturePad, setShowSignaturePad] = useState(false)

  // OCR zone selection state
  const [ocrZoneResult, setOcrZoneResult] = useState<{
    text: string
    x: number; y: number; w: number; h: number
    processing: boolean
  } | null>(null)
  const [ocrZoneField, setOcrZoneField] = useState<string>('patientName')
  const [savedStatus, setSavedStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const sigCanvasRef = useRef<HTMLCanvasElement>(null)
  const sigDrawingRef = useRef(false)
  const sigPointsRef = useRef<Array<{ x: number; y: number }>>([])
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  const { user } = useAuthStore()

  const mainRef    = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const renderRef  = useRef<pdfjsLib.RenderTask | null>(null)
  const renderIdRef = useRef(0)  // increments on every render request; stale renders self-abort

  const isPdf  = doc.fileType === 'application/pdf' || doc.fileName.toLowerCase().endsWith('.pdf')
  const isImg  = doc.fileType?.startsWith('image/')

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Load PDF
  useEffect(() => {
    if (!isPdf) { setLoading(false); return }
    setLoading(true); setError(null)
    let dead = false
    ;(async () => {
      try {
        let src: string | { data: Uint8Array } = doc.fileUrl
        if (doc.fileUrl.startsWith('blob:') || doc.fileUrl.startsWith('data:')) {
          const r = await fetch(doc.fileUrl)
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          src = { data: new Uint8Array(await r.arrayBuffer()) }
        }
        const pdf = await pdfjsLib.getDocument(src).promise
        if (dead) { pdf.destroy(); return }
        setPdfDoc(pdf); setNumPages(pdf.numPages)
        // Build thumbnails in background
        const t: string[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg  = await pdf.getPage(i)
          const vp  = pg.getViewport({ scale: 0.14 })
          const c   = document.createElement('canvas')
          c.width = vp.width; c.height = vp.height
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
          t.push(c.toDataURL())
          if (!dead) setThumbs([...t])
        }
      } catch (e: any) {
        if (!dead) setError(e?.message || 'Failed to load PDF')
      } finally {
        if (!dead) setLoading(false)
      }
    })()
    return () => { dead = true }
  }, [doc.fileUrl, isPdf])

  // Render page — uses a monotonic ID so a stale async never clears a fresher render
  useEffect(() => {
    if (!pdfDoc || !mainRef.current) return
    const myId = ++renderIdRef.current
    if (renderRef.current) renderRef.current.cancel()
    ;(async () => {
      try {
        const pg = await pdfDoc.getPage(pageNum)
        if (myId !== renderIdRef.current) return   // superseded by newer render
        const vp = pg.getViewport({ scale: zoom, rotation })
        const c  = mainRef.current!
        if (!c) return
        // Only resize (clears canvas) if we are still the current render
        if (myId !== renderIdRef.current) return
        c.width  = vp.width; c.height = vp.height
        if (overlayRef.current) { overlayRef.current.width = vp.width; overlayRef.current.height = vp.height }
        const task = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp })
        renderRef.current = task
        await task.promise
        if (myId === renderIdRef.current) redrawAnnotations()
      } catch (e: any) { if (e?.name !== 'RenderingCancelledException') console.error(e) }
    })()
  }, [pdfDoc, pageNum, zoom, rotation])

  // commitAnnotations — called directly at every annotation mutation.
  // Notifies parent SYNCHRONOUSLY (no effect gap) so publishClaims always sees latest data.
  // Debounces DB write separately.
  const commitAnnotations = useCallback((next: Annotation[]) => {
    setAnnotations(next)
    onSave({ ...doc, annotations: next })   // synchronous parent update
    setAnnotationSyncStatus('unsaved')

    // Always write to localStorage under the DocumentViewer key so annotations
    // survive a DB loss — DocumentViewer will find them here as a fallback.
    // Key by barcode (globally unique per claim) so different documents with the
    // same filename never share annotation storage.
    const lsKey = doc.barcode
      ? `docview:barcode:${doc.barcode}`
      : `docview:${doc.fileName.replace(/[^a-z0-9._-]/gi, '_')}`
    try {
      localStorage.setItem(lsKey, JSON.stringify({ annotations: next, notes: [], savedAt: new Date().toISOString() }))
    } catch { /* storage quota — non-fatal */ }

    if (annotationSyncRef.current) clearTimeout(annotationSyncRef.current)
    annotationSyncRef.current = setTimeout(async () => {
      setAnnotationSyncStatus('saving')
      if (doc.dbId) {
        try { await api.patch(`/claims/${doc.dbId}/annotations`, { annotations: next }) } catch { /* non-fatal */ }
      }
      setAnnotationSyncStatus('saved')
    }, 800)
  }, [doc, onSave]) // eslint-disable-line react-hooks/exhaustive-deps

  const redrawAnnotations = useCallback(() => {
    const c = overlayRef.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (!showAnnotations) return
    annotations.filter(a => a.page === pageNum).forEach(a => {
      ctx.save()
      if ((a.type === 'highlight') && a.w && a.h) {
        ctx.fillStyle   = 'rgba(251,191,36,0.28)'
        ctx.strokeStyle = 'rgba(251,191,36,0.75)'
        ctx.lineWidth   = 1.5
        ctx.fillRect(a.x, a.y, a.w, a.h)
        ctx.strokeRect(a.x, a.y, a.w, a.h)
      } else if (a.type === 'underline' && a.w && a.h) {
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth   = 2.5
        const y = a.y + Math.abs(a.h)
        ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke()
      } else if (a.type === 'strikethrough' && a.w && a.h) {
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth   = 2.5
        const y = a.y + Math.abs(a.h) / 2
        ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke()
      } else if (a.type === 'whiteout' && a.w && a.h) {
        ctx.fillStyle   = '#ffffff'
        ctx.strokeStyle = 'rgba(200,200,200,0.5)'
        ctx.lineWidth   = 1
        ctx.fillRect(a.x, a.y, a.w, a.h)
        ctx.strokeRect(a.x, a.y, a.w, a.h)
      } else if (a.type === 'redaction' && a.w && a.h) {
        ctx.fillStyle   = '#000000'
        ctx.fillRect(a.x, a.y, a.w, a.h)
        ctx.strokeStyle = '#1f2937'
        ctx.lineWidth   = 1
        ctx.strokeRect(a.x, a.y, a.w, a.h)
      } else if (a.type === 'note') {
        // Pin icon
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x+18, a.y)
        ctx.lineTo(a.x+18, a.y+18); ctx.lineTo(a.x+10, a.y+18)
        ctx.lineTo(a.x, a.y+10); ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#92400e'; ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('N', a.x+11, a.y+10)
        // Text bubble
        if (a.text) {
          const fontSize = 11; ctx.font = `${fontSize}px sans-serif`
          const maxW = 160; const lineH = fontSize + 3
          const words = (a.text as string).split(' ')
          const lines: string[] = []; let line = ''
          for (const word of words) {
            const test = line ? `${line} ${word}` : word
            if (ctx.measureText(test).width > maxW - 8 && line) { lines.push(line); line = word }
            else line = test
          }
          if (line) lines.push(line)
          if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, -1) + '…' }
          const bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 12)
          const bh = lines.length * lineH + 8
          const bx = a.x + 22; const by = a.y - 2
          ctx.fillStyle = '#fffde7'; ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke()
          ctx.fillStyle = '#1c1917'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
          lines.forEach((l, i) => ctx.fillText(l, bx + 5, by + 4 + i * lineH))
        }
      } else if (a.type === 'stamp' && a.text) {
        const stamp = STAMPS.find(s => s.label === a.text) || STAMPS[0]
        ctx.font        = 'bold 13px monospace'
        const tw        = ctx.measureText(a.text).width
        const pw        = tw + 16; const ph = 22
        ctx.fillStyle   = stamp.bg
        ctx.strokeStyle = stamp.color
        ctx.lineWidth   = 1.5
        ctx.beginPath()
        ctx.roundRect(a.x - pw / 2, a.y - ph / 2, pw, ph, 4)
        ctx.fill(); ctx.stroke()
        ctx.fillStyle   = stamp.color
        ctx.textAlign   = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(a.text, a.x, a.y)
      } else if ((a.type === 'draw' || a.type === 'signature') && a.points && a.points.length > 1) {
        ctx.strokeStyle = a.type === 'signature' ? '#1d4ed8' : '#7c3aed'
        ctx.lineWidth   = a.type === 'signature' ? 2 : 1.5
        ctx.lineJoin    = 'round'; ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(a.points[0].x, a.points[0].y)
        a.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
        ctx.stroke()
      }
      ctx.restore()
    })
  }, [annotations, pageNum, showAnnotations])

  useEffect(() => { redrawAnnotations() }, [annotations, pageNum, showAnnotations, redrawAnnotations])

  const auditMeta = () => ({ createdBy: user?.email || user?.name || 'unknown', createdAt: new Date().toISOString() })

  const canvasXY = (clientX: number, clientY: number) => {
    const c = overlayRef.current!; const r = c.getBoundingClientRect()
    return { x: (clientX - r.left) * (c.width / r.width), y: (clientY - r.top) * (c.height / r.height) }
  }
  const canvasXYMouse = (e: React.MouseEvent<HTMLCanvasElement>) => canvasXY(e.clientX, e.clientY)
  const canvasXYTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0] || e.changedTouches[0]
    return canvasXY(t.clientX, t.clientY)
  }

  const isRectTool = (t: AnnotationTool) => ['highlight','underline','strikethrough','whiteout','redaction','ocr_zone'].includes(t)
  const isFreehandTool = (t: AnnotationTool) => t === 'draw' || t === 'signature'

  // Preview rect while dragging
  const previewRect = (p: { x: number; y: number }) => {
    if (!drawStart) return
    redrawAnnotations()
    const ctx = overlayRef.current!.getContext('2d')!
    const w = p.x - drawStart.x; const h = p.y - drawStart.y
    if (activeTool === 'highlight') {
      ctx.fillStyle = 'rgba(251,191,36,0.22)'; ctx.strokeStyle = 'rgba(251,191,36,0.7)'
      ctx.lineWidth = 1.5; ctx.fillRect(drawStart.x, drawStart.y, w, h); ctx.strokeRect(drawStart.x, drawStart.y, w, h)
    } else if (activeTool === 'underline') {
      ctx.strokeStyle = 'rgba(59,130,246,0.7)'; ctx.lineWidth = 2
      const y = drawStart.y + Math.abs(h)
      ctx.beginPath(); ctx.moveTo(drawStart.x, y); ctx.lineTo(drawStart.x + w, y); ctx.stroke()
    } else if (activeTool === 'strikethrough') {
      ctx.strokeStyle = 'rgba(239,68,68,0.7)'; ctx.lineWidth = 2
      const y = drawStart.y + Math.abs(h) / 2
      ctx.beginPath(); ctx.moveTo(drawStart.x, y); ctx.lineTo(drawStart.x + w, y); ctx.stroke()
    } else if (activeTool === 'whiteout') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.strokeStyle = 'rgba(200,200,200,0.5)'
      ctx.lineWidth = 1; ctx.fillRect(drawStart.x, drawStart.y, w, h); ctx.strokeRect(drawStart.x, drawStart.y, w, h)
    } else if (activeTool === 'redaction') {
      ctx.fillStyle = 'rgba(0,0,0,0.85)'
      ctx.fillRect(drawStart.x, drawStart.y, w, h)
    } else if (activeTool === 'ocr_zone') {
      ctx.fillStyle = 'rgba(6,182,212,0.12)'; ctx.strokeStyle = 'rgba(6,182,212,0.9)'
      ctx.lineWidth = 2; ctx.setLineDash([6, 3])
      ctx.fillRect(drawStart.x, drawStart.y, w, h); ctx.strokeRect(drawStart.x, drawStart.y, w, h)
      ctx.setLineDash([])
      // Label
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = 'rgba(6,182,212,0.9)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText('OCR Zone', drawStart.x + 4, drawStart.y + 4)
    }
  }

  const startDraw = (p: { x: number; y: number }) => {
    if (activeTool === 'pointer') return
    if (activeTool === 'note') { setNotePopup({ ...p, page: pageNum }); return }
    if (activeTool === 'stamp') {
      commitAnnotations([...annotations, { id: Math.random().toString(36).slice(2), page: pageNum, type: 'stamp', x: p.x, y: p.y, text: selectedStamp, ...auditMeta() }])
      return
    }
    if (isRectTool(activeTool)) { setDrawing(true); setDrawStart(p); return }
    if (isFreehandTool(activeTool)) { setDrawing(true); setDrawPoints([p]); return }
  }

  const moveDraw = (p: { x: number; y: number }) => {
    if (!drawing) return
    if (isRectTool(activeTool)) { previewRect(p); return }
    if (isFreehandTool(activeTool)) {
      setDrawPoints(prev => {
        const next = [...prev, p]
        // live preview
        redrawAnnotations()
        const ctx = overlayRef.current?.getContext('2d')
        if (ctx && next.length > 1) {
          ctx.strokeStyle = activeTool === 'signature' ? '#1d4ed8' : '#7c3aed'
          ctx.lineWidth = activeTool === 'signature' ? 2 : 1.5
          ctx.lineJoin = 'round'; ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(next[0].x, next[0].y)
          next.slice(1).forEach(q => ctx.lineTo(q.x, q.y)); ctx.stroke()
        }
        return next
      })
    }
  }

  // OCR zone: crop region from PDF canvas and run Tesseract
  const runOcrOnZone = async (x: number, y: number, w: number, h: number) => {
    const pdfCanvas = mainRef.current
    if (!pdfCanvas) return

    // Normalize coordinates (handle negative width/height from drag direction)
    const sx = w < 0 ? x + w : x
    const sy = h < 0 ? y + h : y
    const sw = Math.abs(w)
    const sh = Math.abs(h)

    if (sw < 10 || sh < 10) return

    setOcrZoneResult({ text: '', x: sx, y: sy, w: sw, h: sh, processing: true })

    try {
      // Upscale small zones so Tesseract has enough pixels to work with
      const upscale = sw < 200 || sh < 60 ? 3 : sw < 400 || sh < 120 ? 2 : 1
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = sw * upscale
      cropCanvas.height = sh * upscale
      const cropCtx = cropCanvas.getContext('2d')!
      cropCtx.imageSmoothingEnabled = true
      cropCtx.imageSmoothingQuality = 'high'
      cropCtx.drawImage(pdfCanvas, sx, sy, sw, sh, 0, 0, sw * upscale, sh * upscale)

      let extractedText = ''

      // Use the dedicated zone-text endpoint — returns raw Tesseract output without invoice parsing
      try {
        const blob = await new Promise<Blob>((resolve, reject) =>
          cropCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas crop failed')), 'image/png')
        )
        const formData = new FormData()
        formData.append('file', new File([blob], 'ocr-zone.png', { type: 'image/png' }))
        const { data } = await (await import('@/services/api')).default.post('/ocr/zone-text', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30000,
        })
        if (data.success && data.text) extractedText = data.text
      } catch { /* fall through to client-side Tesseract */ }

      // Client-side Tesseract fallback if backend is unavailable
      if (!extractedText) {
        try {
          const Tesseract = await import('tesseract.js')
          const { data: { text } } = await Tesseract.recognize(cropCanvas, 'eng', {})
          extractedText = text.trim()
        } catch (err) {
          console.error('Client-side OCR failed:', err)
        }
      }

      setOcrZoneResult(prev => prev ? { ...prev, text: extractedText || '(No text detected)', processing: false } : null)
    } catch (err) {
      console.error('OCR zone extraction failed:', err)
      setOcrZoneResult(prev => prev ? { ...prev, text: '(OCR failed)', processing: false } : null)
    }
  }

  const applyOcrZoneToField = (field: string) => {
    if (!ocrZoneResult?.text || ocrZoneResult.text.startsWith('(')) return
    let value = ocrZoneResult.text.replace(/\n/g, ' ').trim()
    if (field === 'invoiceAmount') {
      // Strip currency symbols and thousands-separator commas so the value is
      // a plain decimal string that <input type="number"> and parseFloat() accept.
      value = value.replace(/[^0-9.]/g, '')
    }
    setEdit(prev => ({ ...prev, [field]: value }))
    setOcrZoneResult(null)
    redrawAnnotations()
    // Record this manual hit in the analytics knowledge base (fire-and-forget).
    import('@/services/api').then(({ default: api }) => {
      api.post('/document-classifiers/zone-hits', {
        fieldName:      field,
        extractedValue: value,
        confidence:     0.9,
        engine:         'manual',
        claimId:        doc.dbId   ?? undefined,
        documentId:     doc.fileUrl ? undefined : undefined,
      }).catch(() => {/* non-fatal */})
    })
  }

  const endDraw = (p: { x: number; y: number }) => {
    if (!drawing) return
    if (isRectTool(activeTool) && drawStart) {
      const w = p.x - drawStart.x; const h = p.y - drawStart.y
      // OCR zone: don't create annotation, run OCR instead
      if (activeTool === 'ocr_zone') {
        setDrawing(false); setDrawStart(null)
        if (Math.abs(w) > 10 && Math.abs(h) > 10) {
          runOcrOnZone(drawStart.x, drawStart.y, w, h)
        }
        return
      }
      if (Math.abs(w) > 4 && Math.abs(h) > 4)
        commitAnnotations([...annotations, { id: Math.random().toString(36).slice(2), page: pageNum, type: activeTool as AnnotationType, x: drawStart.x, y: drawStart.y, w, h, ...auditMeta() }])
      setDrawing(false); setDrawStart(null)
    } else if (isFreehandTool(activeTool)) {
      const pts = [...drawPoints, p]
      if (pts.length > 2)
        commitAnnotations([...annotations, { id: Math.random().toString(36).slice(2), page: pageNum, type: activeTool as AnnotationType, x: pts[0].x, y: pts[0].y, points: pts, ...auditMeta() }])
      setDrawing(false); setDrawPoints([])
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => startDraw(canvasXYMouse(e))
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => moveDraw(canvasXYMouse(e))
  const onMouseUp   = (e: React.MouseEvent<HTMLCanvasElement>) => endDraw(canvasXYMouse(e))

  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); startDraw(canvasXYTouch(e)) }
  const onTouchMove  = (e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); moveDraw(canvasXYTouch(e)) }
  const onTouchEnd   = (e: React.TouchEvent<HTMLCanvasElement>) => { e.preventDefault(); endDraw(canvasXYTouch(e)) }

  const pageAnnotations = annotations.filter(a => a.page === pageNum)

  const [mobileTab, setMobileTab] = useState<'pdf' | 'data'>('pdf')

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 select-none">

      {/* ══ Top bar ══ */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0 min-h-[52px]">
        {/* Doc identity */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-600/20 border border-violet-500/30 shrink-0">
            <FileText className="h-4 w-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-gray-900 dark:text-white tracking-tight">{doc.claimNumber}</span>
              <Badge className="bg-violet-600/25 text-violet-300 border-violet-500/30 text-[10px] h-4 px-1.5">
                <Sparkles className="mr-0.5 h-2.5 w-2.5" /> AI Extracted
              </Badge>
              <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${
                doc.aiConfidence > 0.9 ? 'border-emerald-500/40 text-emerald-400' :
                doc.aiConfidence > 0.75 ? 'border-amber-500/40 text-amber-400' :
                'border-red-500/40 text-red-400'
              }`}>
                {(doc.aiConfidence * 100).toFixed(0)}% confidence
              </Badge>
            </div>
            <p className="text-[11px] text-gray-500 truncate mt-0.5">{doc.fileName}</p>
          </div>
        </div>

        {/* PDF nav + zoom — hidden on small mobile to save space */}
        {isPdf && pdfDoc && (
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl px-2 py-1 border border-gray-200 dark:border-gray-700">
            <button disabled={pageNum <= 1} onClick={() => setPageNum(p => p - 1)}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums px-2 min-w-[44px] text-center">{pageNum}/{numPages}</span>
            <button disabled={pageNum >= numPages} onClick={() => setPageNum(p => p + 1)}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
            <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <div className="hidden sm:flex items-center gap-0.5">
              <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
              {[0.75, 1, 1.5, 2].map(z => (
                <button key={z} onClick={() => setZoom(z)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${zoom === z ? 'bg-violet-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                  {z * 100}%
                </button>
              ))}
              <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
              <button onClick={() => setRotation(r => (r + 90) % 360)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Rotate 90°">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          {doc.fileUrl && (
            <a href={doc.fileUrl} download={doc.fileName}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          )}
          <button onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-xl bg-red-600/10 border border-red-500/30 text-red-400 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all"
            title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ══ Mobile tab bar ══ */}
      <div className="flex md:hidden border-b border-gray-200 dark:border-gray-800 bg-gray-50/90 dark:bg-gray-900/90 shrink-0">
        <button
          onClick={() => setMobileTab('pdf')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            mobileTab === 'pdf'
              ? 'text-violet-400 border-violet-500'
              : 'text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <FileText className="h-3.5 w-3.5" /> Document
        </button>
        <button
          onClick={() => setMobileTab('data')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            mobileTab === 'data'
              ? 'text-violet-400 border-violet-500'
              : 'text-gray-500 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <ClipboardList className="h-3.5 w-3.5" /> Data Fields
        </button>
      </div>

      {/* ══ Body ══ */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: thumbnail strip — hidden on mobile */}
        {isPdf && numPages > 0 && (
          <div className="hidden md:block w-[96px] bg-gray-100/90 dark:bg-gray-900/80 border-r border-gray-200 dark:border-gray-800 overflow-y-auto shrink-0 py-3 space-y-2.5">
            {Array.from({ length: numPages }).map((_, i) => (
              <button key={i} onClick={() => setPageNum(i + 1)}
                className="w-full flex flex-col items-center gap-1 px-2 group">
                <div className={`w-full rounded-lg overflow-hidden ring-2 transition-all duration-150 ${
                  pageNum === i + 1
                    ? 'ring-violet-500 shadow-md shadow-violet-500/25'
                    : 'ring-transparent group-hover:ring-gray-300 dark:group-hover:ring-gray-600'
                }`}>
                  {thumbs[i]
                    ? <img src={thumbs[i]} alt={`p${i+1}`} className="w-full block" />
                    : <div className="aspect-[3/4] bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <Loader2 className="h-3 w-3 text-gray-500 dark:text-gray-600 animate-spin" />
                      </div>
                  }
                </div>
                <span className={`text-[9px] tabular-nums font-medium transition-colors ${
                  pageNum === i + 1 ? 'text-violet-400' : 'text-gray-500 dark:text-gray-600 group-hover:text-gray-600 dark:group-hover:text-gray-400'
                }`}>{i + 1}</span>
              </button>
            ))}
          </div>
        )}

        {/* Center: document canvas — hidden on mobile when data tab active */}
        <div className={`flex-1 flex-col overflow-hidden bg-gray-200 dark:bg-[#1a1b1e] ${mobileTab === 'data' ? 'hidden md:flex' : 'flex'}`}>

          {/* Annotation toolbar */}
          {isPdf && pdfDoc && (
            <div className="flex items-center overflow-x-auto gap-x-2 sm:gap-x-3 gap-y-1 px-3 py-1.5 bg-gray-100/90 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800 shrink-0 whitespace-nowrap">
              {/* Group: Select */}
              <ToolBtn active={activeTool==='pointer'} onClick={() => setActiveTool('pointer')} icon={<MousePointer className="h-3 w-3"/>} label="Select" color="gray"/>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-800"/>
              {/* Group: Markup */}
              <ToolBtn active={activeTool==='highlight'}     onClick={() => setActiveTool('highlight')}     icon={<Highlighter className="h-3 w-3"/>}    label="Highlight"      color="amber"/>
              <ToolBtn active={activeTool==='underline'}     onClick={() => setActiveTool('underline')}     icon={<Underline className="h-3 w-3"/>}      label="Underline"      color="blue"/>
              <ToolBtn active={activeTool==='strikethrough'} onClick={() => setActiveTool('strikethrough')} icon={<Strikethrough className="h-3 w-3"/>}  label="Strikethrough"  color="red"/>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-800"/>
              {/* Group: Cover */}
              <ToolBtn active={activeTool==='whiteout'}  onClick={() => setActiveTool('whiteout')}  icon={<Eraser className="h-3 w-3"/>} label="Whiteout"  color="gray"/>
              <ToolBtn active={activeTool==='redaction'} onClick={() => setActiveTool('redaction')} icon={<Square className="h-3 w-3"/>} label="Redact"    color="gray"/>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-800"/>
              {/* Group: Notes & Stamps */}
              <ToolBtn active={activeTool==='note'} onClick={() => setActiveTool('note')} icon={<MessageSquare className="h-3 w-3"/>} label="Note" color="blue"/>
              <div className="relative">
                <ToolBtn active={activeTool==='stamp'} onClick={() => { setActiveTool('stamp'); setShowStampPicker(s => !s) }} icon={<Stamp className="h-3 w-3"/>} label={selectedStamp} color="purple" trailingIcon={<ChevronDown className="h-2.5 w-2.5 ml-0.5"/>}/>
                {showStampPicker && (
                  <div className="absolute top-full left-0 mt-1 z-30 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 w-40">
                    {STAMPS.map(s => (
                      <button key={s.label} onClick={() => { setSelectedStamp(s.label); setShowStampPicker(false); setActiveTool('stamp') }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left">
                        <span className="text-[10px] font-bold font-mono" style={{ color: s.color }}>{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-800"/>
              {/* Group: Draw & Sign */}
              <ToolBtn active={activeTool==='draw'}      onClick={() => setActiveTool('draw')}      icon={<Pen className="h-3 w-3"/>}           label="Draw"      color="purple"/>
              <ToolBtn active={activeTool==='signature'} onClick={() => { setActiveTool('signature'); setShowSignaturePad(true) }} icon={<FileSignature className="h-3 w-3"/>} label="Sign" color="blue"/>
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-800"/>
              {/* OCR Zone selection tool */}
              <ToolBtn
                active={activeTool === 'ocr_zone'}
                onClick={() => { setActiveTool('ocr_zone'); setOcrZoneResult(null) }}
                icon={<ScanBarcode className="h-3 w-3" />}
                label="OCR Zone"
                color="cyan"
              />
              {/* Right side: visibility + clear + sync status */}
              <div className="ml-auto flex items-center gap-2">
                {/* Annotation sync status */}
                <span className={`text-[10px] transition-all ${
                  annotationSyncStatus === 'saved'   ? 'text-emerald-600' :
                  annotationSyncStatus === 'saving'  ? 'text-amber-500' : 'text-gray-600'
                }`}>
                  {annotationSyncStatus === 'saving'  && <span className="flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin inline"/> Saving…</span>}
                  {annotationSyncStatus === 'saved'   && annotations.length > 0 && <span className="flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 inline"/> Saved</span>}
                </span>
                {/* Show/Hide toggle */}
                <button
                  onClick={() => setShowAnnotations(v => !v)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                    showAnnotations
                      ? 'bg-gray-200 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600'
                      : 'text-gray-500 dark:text-gray-600 border-transparent hover:text-gray-600 dark:hover:text-gray-400'
                  }`}
                  title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
                >
                  {showAnnotations ? <Eye className="h-3 w-3"/> : <EyeOff className="h-3 w-3"/>}
                  {showAnnotations ? 'Hide' : 'Show'}
                </button>
                {pageAnnotations.length > 0 && (
                  <button onClick={() => commitAnnotations(annotations.filter(a => a.page !== pageNum))}
                    className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 transition-colors px-1.5">
                    <X className="h-3 w-3" /> Clear page
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Signature pad overlay */}
          {showSignaturePad && (
            <div className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center">
              <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 w-[420px] shadow-2xl">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white flex items-center gap-2"><FileSignature className="h-4 w-4 text-blue-400"/> Draw your signature</p>
                  <button onClick={() => { setShowSignaturePad(false); setActiveTool('pointer') }} className="text-gray-500 hover:text-gray-900 dark:hover:text-white"><X className="h-4 w-4"/></button>
                </div>
                <canvas ref={sigCanvasRef} width={380} height={160}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white cursor-crosshair touch-none"
                  onMouseDown={e => {
                    sigDrawingRef.current = true
                    const r = sigCanvasRef.current!.getBoundingClientRect()
                    const p = { x: (e.clientX - r.left) * (sigCanvasRef.current!.width / r.width), y: (e.clientY - r.top) * (sigCanvasRef.current!.height / r.height) }
                    sigPointsRef.current = [p]
                    const ctx = sigCanvasRef.current!.getContext('2d')!
                    ctx.beginPath(); ctx.moveTo(p.x, p.y)
                  }}
                  onMouseMove={e => {
                    if (!sigDrawingRef.current) return
                    const r = sigCanvasRef.current!.getBoundingClientRect()
                    const p = { x: (e.clientX - r.left) * (sigCanvasRef.current!.width / r.width), y: (e.clientY - r.top) * (sigCanvasRef.current!.height / r.height) }
                    sigPointsRef.current.push(p)
                    const ctx = sigCanvasRef.current!.getContext('2d')!
                    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
                    ctx.lineTo(p.x, p.y); ctx.stroke()
                  }}
                  onMouseUp={() => { sigDrawingRef.current = false }}
                  onTouchStart={e => {
                    e.preventDefault(); sigDrawingRef.current = true
                    const t = e.touches[0]; const r = sigCanvasRef.current!.getBoundingClientRect()
                    const p = { x: (t.clientX - r.left) * (sigCanvasRef.current!.width / r.width), y: (t.clientY - r.top) * (sigCanvasRef.current!.height / r.height) }
                    sigPointsRef.current = [p]
                    const ctx = sigCanvasRef.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(p.x, p.y)
                  }}
                  onTouchMove={e => {
                    e.preventDefault(); if (!sigDrawingRef.current) return
                    const t = e.touches[0]; const r = sigCanvasRef.current!.getBoundingClientRect()
                    const p = { x: (t.clientX - r.left) * (sigCanvasRef.current!.width / r.width), y: (t.clientY - r.top) * (sigCanvasRef.current!.height / r.height) }
                    sigPointsRef.current.push(p)
                    const ctx = sigCanvasRef.current!.getContext('2d')!
                    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
                    ctx.lineTo(p.x, p.y); ctx.stroke()
                  }}
                  onTouchEnd={e => { e.preventDefault(); sigDrawingRef.current = false }}
                />
                <p className="text-[10px] text-gray-500 dark:text-gray-600 mt-1.5 text-center">Draw above, then click Place to stamp on page {pageNum}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => {
                    const ctx = sigCanvasRef.current!.getContext('2d')!
                    ctx.clearRect(0, 0, sigCanvasRef.current!.width, sigCanvasRef.current!.height)
                    sigPointsRef.current = []
                  }} className="flex-1 py-2 rounded-xl text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Clear</button>
                  <button onClick={() => {
                    const pts = [...sigPointsRef.current]
                    if (pts.length > 2) {
                      // Scale points from sig canvas coords to PDF canvas coords, centered
                      const c = overlayRef.current!
                      const sx = c.width / 2 - 100; const sy = c.height * 0.6
                      const sigW = sigCanvasRef.current!.width; const sigH = sigCanvasRef.current!.height
                      const scaled = pts.map(p => ({ x: sx + (p.x / sigW) * 200, y: sy + (p.y / sigH) * 60 }))
                      commitAnnotations([...annotations, { id: Math.random().toString(36).slice(2), page: pageNum, type: 'signature', x: scaled[0].x, y: scaled[0].y, points: scaled, ...auditMeta() }])
                    }
                    setShowSignaturePad(false); setActiveTool('pointer')
                    sigPointsRef.current = []
                  }} className="flex-1 py-2 rounded-xl text-xs bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors">Place on Document</button>
                </div>
              </div>
            </div>
          )}

          {/* Canvas scroll area */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-8"
            style={{ cursor: activeTool === 'pointer' ? 'default' : activeTool === 'note' || activeTool === 'stamp' ? 'cell' : 'crosshair' }}>

            {/* Loading spinner — shown while PDF loads */}
            {loading && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="relative h-14 w-14">
                  <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-800" />
                  <div className="absolute inset-0 rounded-full border-4 border-t-violet-500 animate-spin" />
                </div>
                <p className="text-gray-500 text-sm animate-pulse">Loading document…</p>
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <AlertCircle className="h-12 w-12 text-red-400/50" />
                <p className="text-red-400 text-sm text-center max-w-xs">{error}</p>
              </div>
            )}

            {/* PDF canvas — always mounted so mainRef is valid when pdfDoc loads.
                Hidden via CSS while loading so the render effect fires correctly. */}
            {isPdf && (
              <div className={`relative shadow-2xl shadow-black/70 rounded overflow-hidden ${loading || error ? 'hidden' : ''}`}>
                <canvas ref={mainRef} className="block" />
                <canvas ref={overlayRef} className="absolute inset-0"
                  onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
                  onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
                />
                {/* Note creation popup */}
                {notePopup && (
                  <div className="absolute z-20 bg-gray-50 dark:bg-gray-900 border border-blue-500/40 rounded-xl p-3 shadow-2xl w-56"
                    style={{ left: Math.min(notePopup.x, (mainRef.current?.width || 600) - 230), top: notePopup.y }}>
                    <p className="text-[10px] text-blue-400 font-semibold uppercase tracking-wider mb-1.5">Add Note — Page {notePopup.page}</p>
                    <textarea autoFocus value={noteText} onChange={e => setNoteText(e.target.value)}
                      placeholder="Type your note here…"
                      className="w-full h-20 bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-white resize-none outline-none rounded-lg p-2 placeholder:text-gray-500 dark:placeholder:text-gray-600 border border-gray-200 dark:border-gray-700 focus:border-blue-500/50" />
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => {
                        if (noteText.trim())
                          commitAnnotations([...annotations, { id: Math.random().toString(36).slice(2), page: notePopup.page, type: 'note', x: notePopup.x, y: notePopup.y, text: noteText }])
                        setNotePopup(null); setNoteText('')
                      }} className="flex-1 bg-blue-600/20 text-blue-300 text-xs rounded-lg py-1.5 hover:bg-blue-600/40 border border-blue-500/30 transition-colors font-medium">
                        Add Note
                      </button>
                      <button onClick={() => { setNotePopup(null); setNoteText('') }}
                        className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs rounded-lg py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* OCR Zone result popup */}
                {ocrZoneResult && (() => {
                  const canvasW = mainRef.current?.width || 800
                  const popupW = 260
                  const rawLeft = ocrZoneResult.x + ocrZoneResult.w / 2 - popupW / 2
                  const left = Math.max(4, Math.min(rawLeft, canvasW - popupW - 4))
                  const top = ocrZoneResult.y + ocrZoneResult.h + 8
                  return (
                    <div
                      className="absolute z-30 bg-white dark:bg-gray-950 border border-cyan-500/50 rounded-xl shadow-2xl shadow-cyan-900/40"
                      style={{ left, top, width: popupW }}
                    >
                      {/* Header */}
                      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 border-b border-gray-200 dark:border-gray-800">
                        <ScanBarcode className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                        <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">OCR Zone Result</p>
                        <button
                          onClick={() => { setOcrZoneResult(null); redrawAnnotations() }}
                          className="ml-auto text-gray-500 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="p-2.5 space-y-2">
                        {/* Extracted text preview */}
                        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 min-h-[48px] flex items-center">
                          {ocrZoneResult.processing ? (
                            <div className="flex items-center gap-2 w-full justify-center">
                              <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
                              <span className="text-xs text-gray-600 dark:text-gray-400">Reading zone…</span>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-900 dark:text-white leading-relaxed line-clamp-3 break-words w-full">
                              {ocrZoneResult.text || '(No text detected)'}
                            </p>
                          )}
                        </div>

                        {/* Field selector */}
                        {!ocrZoneResult.processing && ocrZoneResult.text && !ocrZoneResult.text.startsWith('(') && (
                          <>
                            <div>
                              <p className="text-[10px] text-gray-500 mb-1">Assign to field</p>
                              <select
                                value={ocrZoneField}
                                onChange={e => setOcrZoneField(e.target.value)}
                                className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded-lg px-2 py-1.5 outline-none focus:border-cyan-500/60"
                              >
                                {OCR_FIELD_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <button
                              onClick={() => applyOcrZoneToField(ocrZoneField)}
                              className="w-full bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-300 text-xs font-medium rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1.5"
                            >
                              <ArrowRight className="h-3 w-3" />
                              Apply to {OCR_FIELD_OPTIONS.find(o => o.value === ocrZoneField)?.label}
                            </button>
                          </>
                        )}

                        {/* Dismiss button (always shown) */}
                        {!ocrZoneResult.processing && (
                          <button
                            onClick={() => { setOcrZoneResult(null); redrawAnnotations() }}
                            className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded-lg py-1.5 transition-colors"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {!loading && !error && isImg && (
              <img src={doc.fileUrl} alt={doc.fileName}
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl shadow-black/70" />
            )}

            {!loading && !error && !isPdf && !isImg && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <FileText className="h-20 w-20 text-gray-400 dark:text-gray-700" />
                <p className="text-gray-500 dark:text-gray-600 text-sm">Preview not available for this file type</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: AI data panel — full-width on mobile when data tab active, otherwise hidden */}
        <div className={`bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 overflow-y-auto shrink-0 flex flex-col w-full md:w-[310px] md:border-l ${mobileTab === 'pdf' ? 'hidden md:flex' : 'flex'}`}>
          {/* Panel header */}
          <div className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-2 shrink-0">
            <div className={`flex items-center justify-center h-7 w-7 rounded-lg shrink-0 ${doc.aiConfidence === 0 ? 'bg-blue-600/20 border border-blue-500/20' : 'bg-violet-600/20 border border-violet-500/20'}`}>
              {doc.aiConfidence === 0 ? <ClipboardList className="h-3.5 w-3.5 text-blue-400" /> : <Brain className="h-3.5 w-3.5 text-violet-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900 dark:text-white leading-none">
                {doc.aiConfidence === 0 ? 'Claim Data' : 'AI Extracted Data'}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {doc.aiConfidence === 0 ? 'Fill in fields manually or auto-fill' : 'Verified by AI'}
              </p>
            </div>
            <button
              onClick={autoFillFromOcr}
              disabled={ocrFilling}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium border border-violet-500/30 text-violet-400 hover:bg-violet-600/20 hover:border-violet-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              title="Run OCR on this document and auto-fill all fields"
            >
              {ocrFilling ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanBarcode className="h-3 w-3" />}
              {ocrFilling ? 'Scanning…' : 'Auto-fill'}
            </button>
          </div>

          <div className="p-4 space-y-4 pb-6">

            {/* Barcode */}
            <div className="rounded-xl border border-red-500/20 bg-gradient-to-b from-red-950/50 via-red-950/20 to-transparent p-4">
              <div className="flex items-center justify-center gap-1.5 mb-2">
                <ScanBarcode className="h-4 w-4 text-red-400" />
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-400/70">Claim Barcode</p>
              </div>
              <p className="font-mono text-base font-bold text-red-400 tracking-widest text-center break-all leading-snug">{doc.barcode}</p>
              <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                {doc.pageRange && <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-md px-2 py-0.5 border border-gray-200 dark:border-gray-700">Pages {doc.pageRange}</span>}
                {doc.splitFrom && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">Split {doc.invoiceIndex}/{doc.totalInvoicesInPdf}</Badge>}
              </div>
            </div>

            {/* Patient — editable */}
            <DPSection icon={<User className="h-3.5 w-3.5 text-blue-400" />} label="Patient">
              <EF label="Full Name"        value={edit.patientName}  onChange={ef('patientName')} bold required />
              <EF label="Patient ID"       value={edit.patientId}    onChange={ef('patientId')}   mono />
              <EF label="AK / Member No."  value={edit.memberNumber} onChange={ef('memberNumber')} mono accent="text-blue-400 font-bold" required copy />
            </DPSection>

            {/* Invoice — editable */}
            <DPSection icon={<Receipt className="h-3.5 w-3.5 text-emerald-400" />} label="Invoice">
              <EF label="Provider"     value={edit.providerName}  onChange={ef('providerName')} required />
              <div className="px-3 py-1 flex gap-3">
                <div className="flex-1"><EF label="Invoice #" value={edit.invoiceNumber} onChange={ef('invoiceNumber')} mono required copy /></div>
                <div className="flex-1"><DateEF label="Date" value={edit.invoiceDate} onChange={setField('invoiceDate')} required /></div>
              </div>
              <div className="px-3 py-2 bg-gradient-to-r from-emerald-950/40 to-transparent">
                <p className="text-[9px] uppercase tracking-wider text-emerald-400/60 mb-1 flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" /> Total Amount
                </p>
                <input
                  type="number" min="0" step="0.01"
                  value={edit.invoiceAmount}
                  onChange={ef('invoiceAmount')}
                  className="w-full bg-transparent text-2xl font-black text-emerald-400 tabular-nums outline-none border-b border-transparent hover:border-emerald-500/30 focus:border-emerald-500/60 transition-colors"
                />
              </div>
              <DateEF label="Service Date" value={edit.serviceDate} onChange={setField('serviceDate')} />
            </DPSection>

            {/* Billing — line items extracted by AI */}
            {doc.lineItems && doc.lineItems.length > 0 && (() => {
              const items = doc.lineItems!
              const calcTotal = items.reduce((s, i) => s + (i.totalPrice ?? 0), 0)
              const invoiceAmt = parseFloat(edit.invoiceAmount) || 0
              const discrepancy = invoiceAmt > 0 ? Math.abs(invoiceAmt - calcTotal) > 0.5 : false
              return (
                <DPSection icon={<ListOrdered className="h-3.5 w-3.5 text-sky-400" />} label={`Billing · ${items.length} item${items.length !== 1 ? 's' : ''}`}>
                  {/* Total reconciliation */}
                  <div className={`mx-3 mb-2 rounded-lg px-3 py-2 flex items-center justify-between text-xs ${discrepancy ? 'bg-red-950/40 border border-red-500/25' : 'bg-emerald-950/30 border border-emerald-500/20'}`}>
                    <span className="text-gray-400">Σ items</span>
                    <span className={`font-mono font-semibold ${discrepancy ? 'text-red-400' : 'text-emerald-400'}`}>
                      {formatCurrency(calcTotal)}
                    </span>
                    {discrepancy
                      ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  </div>
                  {/* Line item rows */}
                  <div className="mx-3 space-y-1 max-h-64 overflow-y-auto pr-0.5">
                    {items.map((item, i) => {
                      const hasArithErr = item.quantity != null && item.unitPrice != null && item.totalPrice != null
                        && Math.abs(item.quantity * item.unitPrice - item.totalPrice) > 0.5
                      const conf = item.ocrConfidence ?? 0.85
                      const confColor = conf >= 0.8 ? 'text-emerald-400' : conf >= 0.55 ? 'text-amber-400' : 'text-red-400'
                      return (
                        <div key={i} className={`rounded-lg border px-2.5 py-2 text-xs ${hasArithErr ? 'border-red-500/30 bg-red-950/20' : 'border-gray-700/50 bg-gray-800/30'}`}>
                          {/* Description + confidence */}
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <span className="font-medium text-gray-200 leading-tight flex-1">{item.description}</span>
                            <span className={`font-mono text-[10px] shrink-0 ${confColor}`}>{Math.round(conf * 100)}%</span>
                          </div>
                          {/* Qty × Rate = Total */}
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 flex-wrap">
                            {item.quantity != null && item.unitPrice != null ? (
                              <>
                                <span className="font-mono">{item.quantity}</span>
                                <span>×</span>
                                <span className="font-mono">{formatCurrency(item.unitPrice)}</span>
                                <span>=</span>
                              </>
                            ) : null}
                            <span className={`font-mono font-bold ${hasArithErr ? 'text-red-400' : 'text-sky-300'}`}>
                              {item.totalPrice != null ? formatCurrency(item.totalPrice) : '—'}
                            </span>
                            {hasArithErr && (
                              <span title="Arithmetic mismatch">
                                <AlertTriangle className="h-3 w-3 text-red-400" />
                              </span>
                            )}
                          </div>
                          {/* Optional metadata */}
                          {(item.serviceDate || item.procedureCode) && (
                            <div className="mt-1 flex gap-2 text-[10px] text-gray-500">
                              {item.serviceDate && <span>{item.serviceDate}</span>}
                              {item.procedureCode && <span className="font-mono">{item.procedureCode}</span>}
                            </div>
                          )}
                          {item.taxAmount != null && item.taxAmount > 0 && (
                            <div className="mt-0.5 text-[10px] text-gray-500">
                              VAT: <span className="font-mono">{formatCurrency(item.taxAmount)}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </DPSection>
              )
            })()}

            {/* Medical — editable */}
            <DPSection icon={<Stethoscope className="h-3.5 w-3.5 text-amber-400" />} label="Medical">
              <EF label="Diagnosis"     value={edit.diagnosis}     onChange={ef('diagnosis')} />
              <div className="px-3 py-1 flex gap-3">
                <div className="flex-1"><EF label="ICD Code"   value={edit.diagnosisCode} onChange={ef('diagnosisCode')} mono /></div>
                <div className="flex-1"><EF label="Procedure"  value={edit.procedureCode} onChange={ef('procedureCode')} mono /></div>
              </div>
              <EF label="Treatment" value={edit.treatment} onChange={ef('treatment')} />
            </DPSection>

            {/* AI Confidence */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100/40 dark:bg-gray-800/40 px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">AI Confidence</p>
                <span className={`text-sm font-black tabular-nums ${
                  doc.aiConfidence > 0.9 ? 'text-emerald-400' : doc.aiConfidence > 0.75 ? 'text-amber-400' : 'text-red-400'
                }`}>{(doc.aiConfidence * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  doc.aiConfidence > 0.9 ? 'bg-emerald-500' : doc.aiConfidence > 0.75 ? 'bg-amber-500' : 'bg-red-500'
                }`} style={{ width: `${doc.aiConfidence * 100}%` }} />
              </div>
            </div>

            {/* Document pages */}
            {doc.documentPages && doc.documentPages.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-600 flex items-center gap-1.5">
                  <FileText className="h-3 w-3" /> Document Pages ({doc.documentPages.length})
                </p>
                <div className="space-y-1">
                  {doc.documentPages.map((pg) => {
                    const catColors: Record<string, string> = {
                      invoice: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                      claim_form: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                      prescription: 'bg-green-500/15 text-green-400 border-green-500/30',
                      lab_result: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
                      medical_report: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
                      discharge_summary: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
                      referral: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
                      pre_auth: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    }
                    return (
                      <button key={pg.pageNumber} onClick={() => setPageNum(pg.pageNumber)}
                        className="w-full flex items-center gap-2 rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-gray-100/30 dark:bg-gray-800/30 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 p-2 transition-colors text-left">
                        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-600 w-5 shrink-0">p{pg.pageNumber}</span>
                        <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${catColors[pg.category] || 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600'}`}>
                          {pg.categoryLabel}
                        </Badge>
                        {pg.summary && <span className="text-[9px] text-gray-500 truncate">{pg.summary}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Annotations */}
            {annotations.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-amber-400/60 font-bold flex items-center gap-1.5">
                  <Highlighter className="h-3 w-3" /> Annotations ({annotations.length})
                </p>
                <div className="space-y-1">
                  {annotations.map(a => (
                    <div key={a.id} className="flex items-center gap-2 rounded-lg bg-gray-100/50 dark:bg-gray-800/50 px-2 py-1.5">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${a.type === 'highlight' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                      <span className="text-[10px] text-gray-600 dark:text-gray-400 flex-1 truncate">
                        p{a.page} — {a.type === 'highlight' ? 'Highlight' : a.text || 'Note'}
                      </span>
                      <button onClick={() => commitAnnotations(annotations.filter(x => x.id !== a.id))}
                        className="text-gray-400 dark:text-gray-700 hover:text-red-400 transition-colors shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Auto-save status ── */}
          <div className="sticky bottom-0 px-4 py-2.5 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 shrink-0">
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
              {/* Field save status */}
              <span className={`flex items-center gap-1 transition-all ${
                savedStatus === 'saved'   ? 'text-emerald-500' :
                savedStatus === 'saving'  ? 'text-amber-400' : 'text-gray-500'
              }`}>
                {savedStatus === 'saved'   && <><CheckCircle className="h-3 w-3"/> Fields saved</>}
                {savedStatus === 'saving'  && <><Loader2 className="h-3 w-3 animate-spin"/> Saving fields…</>}
                {savedStatus === 'unsaved' && <><Save className="h-3 w-3"/> Unsaved…</>}
              </span>
              {/* Annotation save status */}
              {annotations.length > 0 && (
                <span className={`flex items-center gap-1 transition-all ${
                  annotationSyncStatus === 'saved'   ? 'text-emerald-500' :
                  annotationSyncStatus === 'saving'  ? 'text-amber-400' : 'text-gray-500'
                }`}>
                  {annotationSyncStatus === 'saved'   && <><CheckCircle className="h-3 w-3"/> {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} saved{doc.dbId ? ' to DB' : ' locally'}</>}
                  {annotationSyncStatus === 'saving'  && <><Loader2 className="h-3 w-3 animate-spin"/> Saving annotations…</>}
                  {annotationSyncStatus === 'unsaved' && <><Save className="h-3 w-3"/> Saving annotations…</>}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function mergeInvoice(ocr: ExtractedInvoiceData, ai: ExtractedInvoiceData): ExtractedInvoiceData {
  const PLACEHOLDER = /^(Unknown Patient|Unknown Provider|OCR Processing Required|Upload to backend for extraction)$/i
  const empty = (v: string | undefined) => !v || PLACEHOLDER.test(v)

  // For amounts: prefer whichever is non-zero; if both non-zero and close (within 5%), take AI
  const mergedAmount = (() => {
    if (!ai.invoiceAmount && !ocr.invoiceAmount) return 0
    if (!ai.invoiceAmount) return ocr.invoiceAmount
    if (!ocr.invoiceAmount) return ai.invoiceAmount
    const ratio = Math.abs(ai.invoiceAmount - ocr.invoiceAmount) / Math.max(ai.invoiceAmount, ocr.invoiceAmount)
    return ratio <= 0.05 ? ai.invoiceAmount : Math.max(ai.invoiceAmount, ocr.invoiceAmount)
  })()

  const merged = {
    patientName:      !empty(ai.patientName)      ? ai.patientName      : ocr.patientName,
    patientId:        ai.patientId                || ocr.patientId,
    providerName:     !empty(ai.providerName)     ? ai.providerName     : ocr.providerName,
    invoiceNumber:    ai.invoiceNumber             || ocr.invoiceNumber,
    invoiceDate:      ai.invoiceDate               || ocr.invoiceDate,
    invoiceAmount:    mergedAmount,
    membershipNumber: ai.membershipNumber          || ocr.membershipNumber,
    diagnosis:        ai.diagnosis                 || ocr.diagnosis,
    diagnosisCode:    ai.diagnosisCode             || ocr.diagnosisCode,
    procedureCode:    ai.procedureCode             || ocr.procedureCode,
    treatment:        ai.treatment                 || ocr.treatment,
    serviceDate:      ai.serviceDate               || ocr.serviceDate,
    insuranceCompany: ai.insuranceCompany          || ocr.insuranceCompany,
    accountName:      ai.accountName               || ocr.accountName,
    rawText:          ocr.rawText                  || ai.rawText,
    ocrMethod:        'backend-ocr' as const,
    pageRange:        ai.pageRange                 || ocr.pageRange,
    documentPages:    ai.documentPages             || ocr.documentPages,
    lineItems:        ai.lineItems?.length ? ai.lineItems : ocr.lineItems,
    confidence:       0,
  }

  // Boost confidence when merge fills gaps that neither alone had
  const countFilled = (src: ExtractedInvoiceData) => [
    !empty(src.patientName), !!src.invoiceNumber, !!src.invoiceAmount,
    !empty(src.providerName), !!src.invoiceDate, !!src.diagnosis,
  ].filter(Boolean).length
  const mergedFilled = [
    !empty(merged.patientName), !!merged.invoiceNumber, !!merged.invoiceAmount,
    !empty(merged.providerName), !!merged.invoiceDate, !!merged.diagnosis,
  ].filter(Boolean).length
  const baseConfidence = Math.max(ai.confidence, ocr.confidence)
  const gapBonus = Math.max(0, mergedFilled - Math.max(countFilled(ai), countFilled(ocr))) * 0.05
  merged.confidence = Math.min(0.99, baseConfidence + gapBonus)

  return merged
}

// ── AI / OCR Processing insight panel ────────────────────────────────────────

const PROCESSING_INSIGHTS = [
  { icon: '🔍', title: 'Smart Field Detection', body: 'The engine reads invoice headers, line-item tables, and footers simultaneously — extracting member number, provider, amounts, and dates in a single pass.' },
  { icon: '🛡️', title: 'Fraud Pattern Matching', body: 'Round-amount billing (e.g. KES 50,000 exactly) is automatically flagged. Genuine itemised medical bills produce irregular totals from individual line items.' },
  { icon: '📋', title: 'Duplicate Detection', body: 'Every invoice number is cross-checked against the provider\'s full claim history. Double-billing is caught before it reaches a reviewer.' },
  { icon: '⚡', title: 'Confidence Scoring', body: 'Each extracted field receives a 0–100% confidence score. Fields below 70% are highlighted for manual verification — protecting your data accuracy.' },
  { icon: '🏥', title: 'Provider Normalisation', body: "Names like 'AKU Nairobi' and 'The Aga Khan University Hospital' resolve to the same provider record — eliminating false mismatch alerts." },
  { icon: '📅', title: 'Date Sequence Checks', body: 'Service date cannot legally be after the invoice date. Future-dated invoices and claims older than 90 days are flagged automatically.' },
  { icon: '💡', title: 'OCR Quality Tip', body: 'High-resolution, well-lit scans consistently produce 95%+ confidence. Blurry documents score lower and require additional manual review.' },
  { icon: '🔗', title: 'Cross-Provider Analysis', body: 'Members billed at two different hospitals on the same service date trigger a critical fraud signal — a pattern indicative of identity misuse.' },
  { icon: '📊', title: 'Anomaly Scoring', body: 'Each claim receives a statistical anomaly score based on seven factors: amount deviation, member velocity, submission timing, and more.' },
  { icon: '🤖', title: 'Gradient Boosting Model', body: 'A trained machine learning model computes a fraud probability score alongside the rule-based checks — two independent fraud signals per claim.' },
]

function ProcessingInsightCard({
  isAi, claims, uploadedFiles, currentExtractIndex, aiExtractPct, ocrProgress,
}: {
  isAi: boolean
  claims: any[]
  uploadedFiles: File[]
  currentExtractIndex: number
  aiExtractPct: number
  ocrProgress: string
}) {
  const [insightIdx, setInsightIdx] = useState(0)
  const [insightVisible, setInsightVisible] = useState(true)

  useEffect(() => {
    const id = setInterval(() => {
      setInsightVisible(false)
      setTimeout(() => {
        setInsightIdx(i => (i + 1) % PROCESSING_INSIGHTS.length)
        setInsightVisible(true)
      }, 400)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const insight = PROCESSING_INSIGHTS[insightIdx]
  const doneCount = claims.filter(c => c.status !== 'extracting').length
  const totalCount = uploadedFiles.length
  const avgConf = claims.filter(c => c.aiConfidence > 0).length > 0
    ? claims.filter(c => c.aiConfidence > 0).reduce((s, c) => s + c.aiConfidence, 0)
      / claims.filter(c => c.aiConfidence > 0).length
    : null

  const v = isAi
    ? {
        pill: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
        ring: 'ring-violet-300 dark:ring-violet-500/40',
        scanLine: '#8b5cf6', shimA: '#8b5cf6', shimB: '#c4b5fd',
        icon: 'text-violet-600 dark:text-violet-400',
        cardBorder: 'border-violet-200 dark:border-violet-500/30',
        activeBg: 'bg-violet-50 border-violet-300 dark:bg-violet-500/10 dark:border-violet-500/40',
        insightBg: 'bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:border-violet-500/30',
        insightText: 'text-violet-800 dark:text-violet-200',
        insightSub: 'text-violet-600 dark:text-violet-300',
        iconHalo: 'bg-violet-100 dark:bg-violet-500/20',
        shimmer: 'linear-gradient(90deg,#8b5cf6 0%,#a78bfa 40%,#c4b5fd 50%,#a78bfa 60%,#8b5cf6 100%)',
      }
    : {
        pill: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
        ring: 'ring-blue-300 dark:ring-blue-500/40',
        scanLine: '#3b82f6', shimA: '#3b82f6', shimB: '#93c5fd',
        icon: 'text-blue-600 dark:text-blue-400',
        cardBorder: 'border-blue-200 dark:border-blue-500/30',
        activeBg: 'bg-blue-50 border-blue-300 dark:bg-blue-500/10 dark:border-blue-500/40',
        insightBg: 'bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30',
        insightText: 'text-blue-800 dark:text-blue-200',
        insightSub: 'text-blue-600 dark:text-blue-300',
        iconHalo: 'bg-blue-100 dark:bg-blue-500/20',
        shimmer: 'linear-gradient(90deg,#3b82f6 0%,#60a5fa 40%,#93c5fd 50%,#60a5fa 60%,#3b82f6 100%)',
      }

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes _cf_shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes _cf_scan    { 0%{top:0%;opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes _cf_ripple  { 0%{transform:scale(1);opacity:.5} 100%{transform:scale(2.8);opacity:0} }
        @keyframes _cf_fadein  { 0%{opacity:0;transform:translateY(6px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes _cf_glow    { 0%,100%{opacity:.6} 50%{opacity:1} }
        ._cf_shimmer_bar { background:${v.shimmer}; background-size:200% auto; animation:_cf_shimmer 1.6s linear infinite; border-radius:9999px; }
        ._cf_scan_line   { position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${v.scanLine},transparent);animation:_cf_scan 2.2s ease-in-out infinite;pointer-events:none; }
        ._cf_ripple      { position:absolute;inset:0;border-radius:9999px;border:2px solid ${v.scanLine};animation:_cf_ripple 2s ease-out infinite; }
        ._cf_ripple2     { position:absolute;inset:0;border-radius:9999px;border:2px solid ${v.scanLine};animation:_cf_ripple 2s ease-out .7s infinite; }
        ._cf_fadein      { animation:_cf_fadein .45s ease both; }
        ._cf_glow        { animation:_cf_glow 2s ease-in-out infinite; }
      `}</style>

      {/* ── Main card ──────────────────────────────────────────────────── */}
      <Card className={`border-2 ${v.cardBorder} overflow-hidden`}>
        {/* Gradient header strip */}
        <div className={`h-1.5 w-full _cf_shimmer_bar`} />

        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Pulsing icon */}
              <div className="relative w-10 h-10 flex items-center justify-center">
                <div className="_cf_ripple" />
                <div className="_cf_ripple2" />
                <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center ${v.iconHalo}`}>
                  {isAi
                    ? <Brain className={`h-5 w-5 ${v.icon} _cf_glow`} />
                    : <Scan className={`h-5 w-5 ${v.icon} _cf_glow`} />
                  }
                </div>
              </div>
              <div>
                <CardTitle className="text-base">
                  {isAi ? 'AI Extracting Data' : 'Pre-filling from Documents'}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Processing file {currentExtractIndex + 1} of {totalCount}
                  {ocrProgress && <span className={`ml-1 font-medium ${v.insightSub}`}>· {ocrProgress}</span>}
                </p>
              </div>
            </div>
            {/* Live stats pills */}
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full font-medium ${v.pill}`}>
                {doneCount}/{totalCount} done
              </span>
              {avgConf !== null && (
                <span className={`px-2 py-1 rounded-full font-medium ${
                  avgConf >= 0.85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : avgConf >= 0.70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                }`}>
                  {Math.round(avgConf * 100)}% avg conf
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pb-5">
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
              <div
                className="_cf_shimmer_bar transition-all duration-700"
                style={{ width: `${Math.max(2, aiExtractPct)}%`, height: '100%' }}
              />
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>
                {aiExtractPct < 30 ? 'Reading document structure…'
                  : aiExtractPct < 60 ? 'Extracting fields and amounts…'
                  : aiExtractPct < 85 ? 'Running fraud signal checks…'
                  : aiExtractPct < 95 ? 'Verifying extracted data…'
                  : 'Finalising…'}
              </span>
              <span className="font-mono font-medium">{aiExtractPct.toFixed(0)}%</span>
            </div>
          </div>

          {/* Stage pipeline */}
          <div className="flex items-center gap-1 text-xs">
            {(['Reading', 'Extracting', 'Fraud Checks', 'Verifying'] as const).map((stage, i) => {
              const threshold = [0, 30, 60, 85][i]
              const active = aiExtractPct >= threshold && aiExtractPct < [30, 60, 85, 101][i]
              const done   = aiExtractPct >= [30, 60, 85, 101][i]
              return (
                <Fragment key={stage}>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all ${
                    active ? `${v.pill} font-semibold ring-2 ${v.ring}` :
                    done   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                           : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-muted-foreground'
                  }`}>
                    {done && <CheckCircle className="h-3 w-3" />}
                    {active && <Loader2 className="h-3 w-3 animate-spin" />}
                    {stage}
                  </div>
                  {i < 3 && <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />}
                </Fragment>
              )
            })}
          </div>

          {/* File cards */}
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {claims.map((claim) => {
              const isActive = claim.status === 'extracting'
              const isDone   = claim.status === 'extracted' || claim.status === 'verified'
              return (
                <div
                  key={claim.id}
                  className={`relative flex items-center gap-3 rounded-xl border p-3 overflow-hidden transition-all duration-300 ${
                    isActive ? `${v.activeBg} shadow-sm` :
                    isDone   ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/10' :
                    'border-gray-100 bg-gray-50/50 opacity-60 dark:border-white/10 dark:bg-white/5'
                  }`}
                >
                  {/* Scan line animation — only on active card */}
                  {isActive && <div className="_cf_scan_line" />}

                  <div className="shrink-0 relative z-10">
                    {isActive && <Loader2 className={`h-5 w-5 animate-spin ${v.icon}`} />}
                    {claim.status === 'extracted' && <Sparkles className="h-5 w-5 text-violet-500" />}
                    {claim.status === 'verified'  && <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                    {!isActive && !isDone && <div className="h-5 w-5 rounded-full border-2 border-gray-300 dark:border-white/20" />}
                  </div>

                  <div className="flex-1 min-w-0 relative z-10">
                    <p className="text-sm font-medium truncate">{claim.fileName}</p>
                    {isActive ? (
                      <p className={`text-xs ${v.insightSub} animate-pulse`}>
                        {isAi ? 'Scanning document with AI…' : 'Reading fields for pre-fill…'}
                      </p>
                    ) : isDone ? (
                      <p className="text-xs text-muted-foreground">
                        {[claim.patientName, claim.invoiceAmount > 0 && formatCurrency(claim.invoiceAmount), claim.diagnosis]
                          .filter(Boolean).join(' · ') || 'Fields extracted'}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">Queued…</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 relative z-10">
                    {claim.aiConfidence > 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        claim.aiConfidence >= 0.85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' :
                        claim.aiConfidence >= 0.70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' :
                        'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      }`}>
                        {Math.round(claim.aiConfidence * 100)}%
                      </span>
                    )}
                    {isDone && <CheckCircle className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" />}
                  </div>
                </div>
              )
            })}
          </div>

          {!isAi && (
            <p className="text-xs text-muted-foreground text-center">
              OCR extracts what it can — you verify and complete any gaps in the next step
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Rotating insight card ──────────────────────────────────────── */}
      <div
        key={insightIdx}
        className={`_cf_fadein rounded-xl border p-4 ${v.insightBg} transition-all`}
        style={{ opacity: insightVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5" role="img">{insight.icon}</span>
          <div>
            <p className={`text-sm font-semibold ${v.insightText}`}>
              {insight.title}
            </p>
            <p className={`text-xs mt-1 leading-relaxed ${v.insightSub}`}>
              {insight.body}
            </p>
          </div>
          <div className="ml-auto shrink-0 flex gap-1">
            {PROCESSING_INSIGHTS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === insightIdx ? `w-4 ${isAi ? 'bg-violet-500' : 'bg-blue-500'}` : 'w-1.5 bg-gray-300 dark:bg-white/15'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function getScannerMeta(s: { id: string; type?: string; driver?: string }) {
  const id = s.id ?? ''
  const driver = s.driver ?? ''
  const isNetwork = id.startsWith('airscan:') || id.startsWith('escl:')
    || driver === 'escl' || s.type === 'network'
  let driverLabel = 'SANE'
  if (driver === 'escl' || id.startsWith('escl:')) driverLabel = 'eSCL'
  else if (id.startsWith('airscan:')) driverLabel = 'AirScan'
  else if (driver === 'wia' || driver === 'naps2-wia') driverLabel = 'WIA'
  else if (driver === 'naps2-twain') driverLabel = 'TWAIN'
  else if (driver.startsWith('naps2')) driverLabel = 'NAPS2'
  return { isNetwork, driverLabel }
}

function InstallSnippet({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="relative group">
      <code className="block bg-muted pr-9 pl-2 py-1.5 rounded text-[11px] font-mono whitespace-pre-wrap break-all">
        {command}
      </code>
      <button
        onClick={handleCopy}
        title="Copy command"
        className="absolute top-1 right-1 p-1 rounded hover:bg-background/80 transition-colors text-muted-foreground hover:text-violet-600"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

export default function BatchUpload() {
  const { addClaims } = useClaimsStore()
  const { user } = useAuthStore()
  const { session, upsertSession, clearSession } = useBatchSessionStore()

  const [provider, setProvider] = useState('')
  const [branch, setBranch] = useState('')           // branch name or id for the batch
  const [approvedProviders, setApprovedProviders] = useState<{ id: string; name: string }[]>([])
  const [providerBranches, setProviderBranches] = useState<{ id: string; name: string; code: string }[]>([])
  const [isProviderUser, setIsProviderUser] = useState(false)  // true when logged-in user is provider staff
  const [step, setStep] = useState<Step>('upload')
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [claims, setClaims] = useState<ExtractedClaim[]>([])
  const claimsRef = useRef<ExtractedClaim[]>([])   // always mirrors claims — safe to read in async publish
  const [currentExtractIndex, setCurrentExtractIndex] = useState(0)
  const [publishProgress, setPublishProgress] = useState(0)
  const [publishValidationErrors, setPublishValidationErrors] = useState<Record<string, string[]>>({})
  const [previewDoc, setPreviewDoc] = useState<ExtractedClaim | null>(null)
  const previewDocRef = useRef<ExtractedClaim | null>(null) // latest modal state for publish flush
  const [ocrProgress, setOcrProgress] = useState('')
  const [restoredSession, setRestoredSession] = useState(false)
  const [ocrRunning, setOcrRunning]             = useState<Set<string>>(new Set())
  const [publishingOne, setPublishingOne]       = useState<Set<string>>(new Set())
  const [reprocessingOne, setReprocessingOne]   = useState<Set<string>>(new Set())
  const [draftSaved, setDraftSaved]             = useState(false)
  type ExtractionMode = 'ai' | 'ocr' | 'combined'
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('ai')

  // ── Document scanner (hardware) ────────────────────────────────────────────
  type ScannerDevice = { id: string; name: string; vendor: string; model: string; type: string; driver?: string }
  const [inputTab, setInputTab] = useState<'upload' | 'scanner'>('upload')
  const [scanners, setScanners] = useState<ScannerDevice[]>([])
  const [scannersLoading, setScannersLoading] = useState(false)
  const [driverAvailable, setDriverAvailable] = useState(true)
  const [serverPlatform, setServerPlatform] = useState<'linux' | 'windows' | 'other'>('linux')
  const [cloudHostedScanner, setCloudHostedScanner] = useState(false)
  const [selectedScanner, setSelectedScanner] = useState('')

  // ── Scan preview (approve before upload) ──────────────────────────────────
  const [scanPreviewBlob, setScanPreviewBlob]     = useState<Blob | null>(null)
  const [scanPreviewUrl,  setScanPreviewUrl]      = useState<string | null>(null)
  const [scanPreviewPage, setScanPreviewPage]     = useState(1)
  const [scanPreviewPages, setScanPreviewPages]   = useState(1)
  const [scanPreviewZoom, setScanPreviewZoom]     = useState(1.0)
  const scanPreviewCanvasRef                      = useRef<HTMLCanvasElement>(null)
  const scanPreviewDocRef                         = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const scanPreviewRenderRef                      = useRef<pdfjsLib.RenderTask | null>(null)
  const [scanPreviewTs, setScanPreviewTs]         = useState('')

  // ── Camera scanner (fullscreen overlay) ───────────────────────────────────
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false)

  // ── Local scan agent (localhost:7420) ──────────────────────────────────────
  const AGENT_URL = 'http://127.0.0.1:7420'
  const AGENT_MIN_VERSION = '1.1.0'
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null) // null = checking
  const [agentHostname, setAgentHostname] = useState<string | null>(null)
  const [agentOs,       setAgentOs]       = useState<string | null>(null)
  const [agentVersion,  setAgentVersion]  = useState<string | null>(null)

  const agentNeedsUpgrade = agentAvailable === true && !!agentVersion &&
    agentVersion.localeCompare(AGENT_MIN_VERSION, undefined, { numeric: true, sensitivity: 'base' }) < 0

  const [scanDpi, setScanDpi] = useState('300')
  const [scanMode, setScanMode] = useState('Color')
  type ScanSource = 'auto' | 'flatbed' | 'feeder' | 'feeder-duplex'
  type ScanPaperSize = 'auto' | 'a4' | 'a5' | 'letter' | 'legal'
  const [scanSource, setScanSource] = useState<ScanSource>('auto')
  const [scanSkipBlank, setScanSkipBlank] = useState(true)
  const [scanPaperSize, setScanPaperSize] = useState<ScanPaperSize>('auto')
  const [scannerCaps, setScannerCaps] = useState<{ sources: string[]; duplex: boolean } | null>(null)
  const [scannerCapsLoading, setScannerCapsLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  // ── Scan metering (per-org enable/disable + billing) ──────────────────────
  const meter = useScanMetering()

  // Animated progress during extraction — ticks every 500 ms from 0→92 % over
  // EXPECTED_MS, then jumps to the real percentage once files finish.
  const [aiExtractPct, setAiExtractPct] = useState(0)
  const extractStartRef  = useRef(0)
  const extractedCntRef  = useRef(0)
  const claimsLenRef     = useRef(0)
  extractedCntRef.current = claims.filter(c => c.status !== 'extracting').length
  claimsLenRef.current    = claims.length

  useEffect(() => {
    if (step !== 'ai_extracting' && step !== 'manual_processing') {
      setAiExtractPct(0)
      return
    }
    extractStartRef.current = Date.now()
    const EXPECTED_MS = 330_000   // assume up to ~5.5 min for a large merged PDF
    const id = setInterval(() => {
      const elapsed  = Date.now() - extractStartRef.current
      const realPct  = (extractedCntRef.current / Math.max(claimsLenRef.current, 1)) * 100
      const timePct  = Math.min(92, (elapsed / EXPECTED_MS) * 100)
      setAiExtractPct(Math.max(realPct, timePct))
    }, 500)
    return () => clearInterval(id)
  }, [step])

  // ── Vision model selection ──────────────────────────────────────────────
  // Populated from GET /ocr/models. Persisted in localStorage so user's
  // choice survives page reloads. Defaults to whatever the backend reports
  // as its recommended available model.
  type VisionModelOption = {
    id: string; label: string; provider: string; available: boolean;
    tier: 'best' | 'recommended' | 'fast' | 'local' | 'fallback'; description: string;
  }
  const [visionModels, setVisionModels] = useState<VisionModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    localStorage.getItem('visionModel') || ''
  )

  useEffect(() => {
    let cancelled = false
    api.get('/ocr/models').then(({ data }) => {
      if (cancelled) return
      const models: VisionModelOption[] = data.models || []
      setVisionModels(models)
      const stored = localStorage.getItem('visionModel')
      const validStored = stored && models.find(m => m.id === stored && m.available)
      if (!validStored) {
        const TIER_ORDER: VisionModelOption['tier'][] = ['best', 'recommended', 'fast', 'local', 'fallback']
        const topTier = TIER_ORDER.map(t => models.find(m => m.tier === t && m.available)?.id).find(Boolean)
        const fallback = data.defaultModel || topTier || models.find(m => m.available)?.id || ''
        setSelectedModel(fallback)
      } else {
        setSelectedModel(stored!)
      }
    }).catch(err => console.warn('Failed to load vision models:', err))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedModel) localStorage.setItem('visionModel', selectedModel)
  }, [selectedModel])

  const rerunOcr = useCallback(async (claimId: string) => {
    const claim = claims.find(c => c.id === claimId)
    if (!claim) return
    setOcrRunning(prev => new Set(prev).add(claimId))
    try {
      let file: File
      if (claim.fileBytes) {
        file = new File([claim.fileBytes.buffer as ArrayBuffer], claim.fileName, { type: claim.fileType || 'application/pdf' })
      } else {
        const resp = await fetch(claim.fileUrl)
        const blob = await resp.blob()
        file = new File([blob], claim.fileName, { type: claim.fileType || blob.type || 'application/pdf' })
      }
      let inv: ExtractedInvoiceData
      if (extractionMode === 'combined' && selectedModel && selectedModel !== 'tesseract') {
        const [ocrRes, aiRes] = await Promise.allSettled([
          extractInvoicesFromPdf(file, undefined, 'tesseract'),
          extractInvoicesFromPdf(file, undefined, selectedModel),
        ])
        const ocr = ocrRes.status === 'fulfilled' ? ocrRes.value.invoices[0] : null
        const ai  = aiRes.status  === 'fulfilled' ? aiRes.value.invoices[0]  : null
        inv = (ocr && ai) ? mergeInvoice(ocr, ai) : (ocr ?? ai)!
      } else {
        const primaryModel = extractionMode === 'ocr' ? 'tesseract' : selectedModel || undefined
        const result = await extractInvoicesFromPdf(file, undefined, primaryModel)
        inv = result.invoices[0]
      }
      if (inv) {
        const isPlaceholder = (v: string) => !v || v === 'OCR Processing Required' || v === 'Unknown Patient' || v === 'Upload to backend for extraction'
        setClaims(prev => prev.map(c => c.id !== claimId ? c : {
          ...c,
          patientName:   !isPlaceholder(inv.patientName)   ? inv.patientName   : c.patientName,
          patientId:     inv.patientId                     || c.patientId,
          memberNumber:  inv.membershipNumber               || c.memberNumber,
          providerName:  !isPlaceholder(inv.providerName)  ? inv.providerName  : c.providerName,
          invoiceNumber: inv.invoiceNumber                  || c.invoiceNumber,
          invoiceDate:   inv.invoiceDate                    || c.invoiceDate,
          invoiceAmount: inv.invoiceAmount                  || c.invoiceAmount,
          diagnosis:     inv.diagnosis                      || c.diagnosis,
          diagnosisCode: inv.diagnosisCode                  || c.diagnosisCode,
          procedureCode: inv.procedureCode                  || c.procedureCode,
          treatment:     inv.treatment                      || c.treatment,
          aiConfidence:  inv.confidence                     ?? c.aiConfidence,
        }))
      }
    } catch (err) {
      console.error('OCR rerun failed:', err)
    } finally {
      setOcrRunning(prev => { const s = new Set(prev); s.delete(claimId); return s })
    }
  }, [claims, selectedModel, extractionMode])

  // Publish a single claim row without affecting others
  const publishSingleClaim = useCallback(async (claimId: string) => {
    const c = claims.find(c => c.id === claimId)
    if (!c || c.status === 'published') return

    // Validate just this row
    const errors = validateAllClaims()
    if (errors[claimId]) {
      setPublishValidationErrors(prev => ({ ...prev, [claimId]: errors[claimId] }))
      return
    }
    setPublishValidationErrors(prev => { const n = { ...prev }; delete n[claimId]; return n })
    setPublishingOne(prev => new Set(prev).add(claimId))

    let batchNumber: string
    try {
      const { data } = await api.post('/batch-submissions/reserve-number')
      batchNumber = data.batchNumber
    } catch {
      batchNumber = _fallbackBatchNumber()
    }

    try {
      const { data: savedClaim } = await api.post('/claims', {
        claimNumber:  c.claimNumber,
        barcode:      c.barcode,
        patientName:  c.patientName,
        patientId:    c.patientId,
        memberNumber: c.memberNumber || c.patientId,
        memberName:   c.patientName,
        providerName: isProviderUser ? provider : (c.providerName || provider),
        invoiceNumber: c.invoiceNumber,
        invoiceDate:  c.invoiceDate || undefined,
        dateOfService: c.serviceDate || undefined,
        amount:       c.invoiceAmount,
        diagnosis:    c.diagnosis,
        diagnosisCode: c.diagnosisCode,
        procedureCode: c.procedureCode,
        treatment:    c.treatment,
        ocrConfidence: c.aiConfidence,
        batchNumber,
        uploadedBy:   user?.email || user?.name || 'unknown',
        branchName:   branch || undefined,
      })

      if (c.fileBytes && savedClaim?.id) {
        try {
          const fileBlob = new globalThis.File([c.fileBytes as unknown as BlobPart], c.fileName, { type: c.fileType || 'application/pdf' })
          const docForm = new FormData()
          docForm.append('file', fileBlob)
          await api.post(`/documents/upload?claimId=${savedClaim.id}${branch ? `&branchName=${encodeURIComponent(branch)}` : ''}`, docForm,
            { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 })
        } catch { /* non-fatal */ }
      }

      if (c.annotations?.length && savedClaim?.id) {
        await api.patch(`/claims/${savedClaim.id}/annotations`, { annotations: c.annotations }).catch(() => {})
      }

      // Flash "Published" briefly so the user sees confirmation, then remove
      // the card from the review list — the claim is now in the main Claims page.
      setClaims(prev => prev.map(x => x.id === claimId ? { ...x, status: 'published', dbId: savedClaim?.id } : x))
      setTimeout(() => {
        setClaims(prev => {
          const remaining = prev.filter(x => x.id !== claimId)
          // When the last claim is individually published, advance to complete
          if (remaining.length === 0) setStep('complete')
          return remaining
        })
      }, 900)
    } catch (err: any) {
      console.error('Single publish failed:', err?.response?.data || err.message)
    } finally {
      setPublishingOne(prev => { const s = new Set(prev); s.delete(claimId); return s })
    }
  }, [claims, provider, branch, isProviderUser, user])

  // Reprocess — clear extracted data and re-run OCR/AI on this claim
  const reprocessClaim = useCallback(async (claimId: string) => {
    setReprocessingOne(prev => new Set(prev).add(claimId))
    // Clear extracted fields so it reads as fresh
    setClaims(prev => prev.map(c => c.id !== claimId ? c : {
      ...c,
      status: 'extracted' as const,
      aiConfidence: 0,
      patientName: '', patientId: '', memberNumber: '',
      invoiceNumber: '', invoiceDate: '', invoiceAmount: 0,
      diagnosis: '', treatment: '', diagnosisCode: '', procedureCode: '',
    }))
    try {
      await rerunOcr(claimId)
    } finally {
      setReprocessingOne(prev => { const s = new Set(prev); s.delete(claimId); return s })
    }
  }, [rerunOcr])

  const sessionInitialised = useRef(false)
  const autoExtractPending = useRef(false)   // set when restored files need re-extraction
  const startAiExtractionRef = useRef<() => void>(() => {})

  // ── Provider / branch population based on logged-in user ─────────────────
  useEffect(() => {
    const role = user?.role

    const isProvider = role === 'provider_admin' || role === 'provider_user'
    setIsProviderUser(isProvider)

    if (isProvider && user?.providerId) {
      // Auto-populate provider name from the user's linked provider
      api.get(`/providers/${user.providerId}`)
        .then(({ data: p }) => {
          if (p?.name) setProvider(p.name)
          // Also load branches for this provider
          return api.get(`/branches?providerId=${user.providerId}`)
        })
        .then(({ data }) => {
          const list = Array.isArray(data) ? data : Array.isArray(data?.branches) ? data.branches : []
          const activeBranches = list.filter((b: any) => b.isActive && b.isApproved)
          setProviderBranches(activeBranches.map((b: any) => ({ id: b.id, name: b.name, code: b.code })))

          // If the user is linked to a specific branch, auto-select it
          if (user && (user as any).branchId) {
            const myBranch = activeBranches.find((b: any) => b.id === (user as any).branchId)
            if (myBranch) setBranch(myBranch.name)
          }
        })
        .catch(() => {})
    } else {
      // CIC staff – fetch all approved providers for free selection
      api.get('/providers')
        .then(({ data }) => {
          const list = Array.isArray(data) ? data : Array.isArray(data?.providers) ? data.providers : null
          if (list) {
            setApprovedProviders(
              list.filter((p: any) => p.status === 'approved')
                  .map((p: any) => ({ id: p.id, name: p.name }))
            )
          }
        })
        .catch(() => {})
    }
  }, [user])

  // ── Restore persisted session on first mount ──────────────────────────────
  useEffect(() => {
    if (sessionInitialised.current) return
    sessionInitialised.current = true

    if (!session || session.step === 'upload') return
    const savedClaims = loadClaims(session.sessionId) as ExtractedClaim[]
    if (savedClaims.length === 0) return

    setProvider(session.provider || '')
    setRestoredSession(true)

    if (session.step === 'ai_extracting') {
      // Mid-extraction restore: rebuild File objects from IndexedDB and re-run
      // extraction from scratch. The partial claims would be stale anyway.
      restoreAsFiles(session.sessionId).then(files => {
        if (files.length === 0) {
          // No cached files — fall back to review with whatever extracted
          const partialClaims = savedClaims.map(c =>
            c.status === 'extracting' ? { ...c, status: 'error' as const } : c
          )
          setClaims(partialClaims)
          setStep('review')
          return
        }
        // Files recovered — restart extraction automatically
        setUploadedFiles(files)
        autoExtractPending.current = true
        setStep('upload')   // momentary reset so startAiExtraction can fire
      }).catch(() => {
        const partialClaims = savedClaims.map(c =>
          c.status === 'extracting' ? { ...c, status: 'error' as const } : c
        )
        setClaims(partialClaims)
        setStep('review')
      })
      return
    }

    // For review / publishing / complete: restore state directly
    setStep(session.step as Step)
    setClaims(savedClaims)
    setPublishProgress(session.publishProgress || 0)

    // Rehydrate blob URLs from IndexedDB in the background
    restoreFiles(session.sessionId).then(cached => {
      if (cached.size === 0) return
      setClaims(prev => prev.map(c => {
        const hit = cached.get(c.fileName)
        return hit ? { ...c, fileUrl: hit.url } : c
      }))
    }).catch(() => {})
  }, [])

  // ── Auto-restart extraction after mid-session file restore ───────────────
  useEffect(() => {
    if (!autoExtractPending.current || uploadedFiles.length === 0 || step !== 'upload') return
    autoExtractPending.current = false
    setTimeout(() => startAiExtractionRef.current(), 0)
  }, [uploadedFiles, step])

  // Keep refs in sync so publishClaims can read latest state synchronously
  useEffect(() => { claimsRef.current = claims }, [claims])
  useEffect(() => { previewDocRef.current = previewDoc }, [previewDoc])

  // ── Persist state whenever it changes ────────────────────────────────────
  useEffect(() => {
    if (step === 'upload') return   // nothing worth saving yet
    const sid = session?.sessionId ?? `ses-${Date.now()}`
    // Claims go to sessionStorage (large data — avoids localStorage QuotaExceededError)
    if (claims.length > 0) saveClaims(sid, claims as any)
    // Only tiny metadata goes to localStorage
    upsertSession({
      step,
      provider,
      totalFiles: uploadedFiles.length || claims.length,
      extractedCount: claims.filter(c => c.status !== 'extracting').length,
      publishProgress,
    })
  }, [step, claims, provider, publishProgress])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const docFiles = acceptedFiles.filter(f =>
      !f.name.endsWith('.xlsx') && !f.name.endsWith('.xls') && !f.name.endsWith('.csv')
    )
    setUploadedFiles(prev => [...prev, ...docFiles])
    // Cache raw bytes so blob URLs can be recreated after page reload
    if (docFiles.length > 0) {
      const sid = session?.sessionId ?? `ses-${Date.now()}`
      upsertSession({ sessionId: sid })
      cacheFiles(sid, docFiles).catch(() => { /* non-fatal */ })
    }
  }, [session, upsertSession])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/tiff': ['.tiff', '.tif'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 100,
    maxSize: 50 * 1024 * 1024,
  })

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // ── Scanner helpers ────────────────────────────────────────────────────────
  const fetchScanners = useCallback(async () => {
    setScannersLoading(true)
    setScanError(null)
    try {
      const data = await (async () => {
        // Try the local scan agent first — works even on cloud-hosted deployments
        try {
          const r = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) })
          if (r.ok) {
            setAgentAvailable(true)
            const health = await r.json().catch(() => ({}))
            if (health?.hostname) setAgentHostname(String(health.hostname))
            if (health?.os)       setAgentOs(String(health.os))
            if (health?.version)  setAgentVersion(String(health.version))
            const sr = await fetch(`${AGENT_URL}/scanners`)
            return await sr.json()
          }
        } catch { /* agent not running — fall through to backend */ }
        setAgentAvailable(false)
        const { data: d } = await api.get('/scanner/devices')
        return d
      })()

      const devs: ScannerDevice[] = data.devices ?? []
      setScanners(devs)
      setDriverAvailable(data.driverAvailable ?? data.saneAvailable ?? true)
      setServerPlatform(data.platform ?? 'linux')
      setCloudHostedScanner(data.cloudHosted ?? false)
      if (devs.length > 0 && !selectedScanner) setSelectedScanner(devs[0].id)
    } catch {
      setScanners([])
    } finally {
      setScannersLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScanner])

  useEffect(() => {
    if (inputTab === 'scanner') fetchScanners()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputTab])

  // Fetch capabilities (available sources/duplex) whenever the selected scanner changes
  useEffect(() => {
    if (!selectedScanner || !agentAvailable) { setScannerCaps(null); return }
    let cancelled = false
    setScannerCapsLoading(true)
    fetch(`${AGENT_URL}/scanner/capabilities?deviceId=${encodeURIComponent(selectedScanner)}`)
      .then(r => r.ok ? r.json() : null)
      .then(caps => {
        if (cancelled) return
        setScannerCaps(caps ?? null)
        // Auto-select duplex feeder when available; otherwise keep 'auto'
        if (caps?.sources?.includes('feeder-duplex'))      setScanSource('feeder-duplex')
        else if (caps?.sources?.includes('feeder'))        setScanSource('feeder')
        else                                               setScanSource('flatbed')
      })
      .catch(() => { if (!cancelled) setScannerCaps(null) })
      .finally(() => { if (!cancelled) setScannerCapsLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScanner, agentAvailable])

  const handleScan = useCallback(async () => {
    if (!selectedScanner || scanning) return
    // Metering gate — admin can flip scanning off for an organization
    if (!meter.enabled) {
      setScanError('Scanning is disabled for your organization. Contact your administrator.')
      return
    }
    setScanning(true)
    setScanError(null)
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      let blob: Blob

      const scannerName = scanners.find(s => s.id === selectedScanner)?.name ?? selectedScanner

      // Re-verify the agent is still up — stale agentAvailable state from the
      // initial health check can cause a CORS/network error if the agent stopped.
      const agentStillUp = agentAvailable && await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok)
        .catch(() => false)
      if (!agentStillUp && agentAvailable) setAgentAvailable(false)

      if (agentStillUp) {
        // Route through local agent — scanner is on the user's machine
        // POST with params in the query string and no body — no Content-Type
        // means no CORS preflight, so Firefox doesn't block it when the page
        // is served over HTTPS and the agent is HTTP-only localhost.
        const scanParams = new URLSearchParams({
          deviceId: selectedScanner,
          resolution: String(parseInt(scanDpi, 10)),
          mode: scanMode,
          source: scanSource,
          paperSize: scanPaperSize,
          skipBlank: String(scanSkipBlank),
        })
        const resp = await fetch(`${AGENT_URL}/scan?${scanParams}`, { method: 'POST' })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}))
          meter.recordScan({
            deviceClass: 'desktop',
            machineHostname: agentHostname ?? undefined,
            os: agentOs ?? undefined,
            scannerName,
            resolution: parseInt(scanDpi, 10),
            mode: scanMode,
            success: false,
            errorMessage: err.error ?? 'Scan failed',
          })
          throw new Error(err.error ?? 'Scan failed')
        }
        blob = await resp.blob()
        meter.recordScan({
          deviceClass: 'desktop',
          machineHostname: agentHostname ?? undefined,
          os: agentOs ?? undefined,
          scannerName,
          resolution: parseInt(scanDpi, 10),
          mode: scanMode,
          success: true,
        })
      } else {
        // On-premises: scanner is on the server. Backend records metering itself.
        const resp = await api.post(
          '/scanner/scan',
          {
            deviceId: selectedScanner,
            resolution: parseInt(scanDpi, 10),
            mode: scanMode,
            source: scanSource,
            paperSize: scanPaperSize,
            skipBlank: scanSkipBlank,
            machineHostname: agentHostname ?? undefined,
            os: agentOs ?? undefined,
          },
          { responseType: 'blob' },
        )
        blob = resp.data
      }

      // Show preview for approval before adding to the upload queue.
      setScanPreviewTs(ts)
      setScanPreviewBlob(blob)
      setScanPreviewPage(1)
      setScanPreviewZoom(1.0)
      const blobUrl = URL.createObjectURL(blob)
      setScanPreviewUrl(blobUrl)
    } catch (err: any) {
      setScanError(err?.message ?? err?.response?.data?.message ?? 'Scan failed. Check scanner connection and try again.')
    } finally {
      setScanning(false)
    }
  }, [agentAvailable, agentHostname, agentOs, scanners, selectedScanner, scanning, scanDpi, scanMode, scanSource, scanPaperSize, scanSkipBlank, session, upsertSession, meter])

  // ── Scan preview helpers ──────────────────────────────────────────────────
  const closeScanPreview = useCallback(() => {
    if (scanPreviewUrl) URL.revokeObjectURL(scanPreviewUrl)
    scanPreviewDocRef.current?.destroy().catch(() => {})
    scanPreviewDocRef.current = null
    setScanPreviewBlob(null)
    setScanPreviewUrl(null)
    setScanPreviewPage(1)
    setScanPreviewPages(1)
    setScanPreviewZoom(1.0)
  }, [scanPreviewUrl])

  const handleScanApprove = useCallback(() => {
    if (!scanPreviewBlob) return
    const file = new File([scanPreviewBlob], `scan-${scanPreviewTs}.pdf`, { type: 'application/pdf' })
    setUploadedFiles(prev => [...prev, file])
    const sid = session?.sessionId ?? `ses-${Date.now()}`
    upsertSession({ sessionId: sid })
    cacheFile(sid, file).catch(() => {})
    closeScanPreview()
    setInputTab('upload')
  }, [scanPreviewBlob, scanPreviewTs, session, upsertSession, closeScanPreview])

  // Load PDF into canvas whenever preview URL or page/zoom changes
  useEffect(() => {
    if (!scanPreviewUrl) return
    let cancelled = false
    ;(async () => {
      try {
        if (!scanPreviewDocRef.current) {
          const resp = await fetch(scanPreviewUrl)
          const buf  = await resp.arrayBuffer()
          const doc  = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
          if (cancelled) { doc.destroy(); return }
          scanPreviewDocRef.current = doc
          setScanPreviewPages(doc.numPages)
        }
        const doc  = scanPreviewDocRef.current!
        const page = await doc.getPage(scanPreviewPage)
        if (cancelled) return
        const viewport = page.getViewport({ scale: scanPreviewZoom })
        const canvas   = scanPreviewCanvasRef.current
        if (!canvas) return
        canvas.width  = viewport.width
        canvas.height = viewport.height
        if (scanPreviewRenderRef.current) scanPreviewRenderRef.current.cancel()
        scanPreviewRenderRef.current = page.render({
          canvasContext: canvas.getContext('2d')!,
          viewport,
        })
        await scanPreviewRenderRef.current.promise
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') console.error('Preview render error', e)
      }
    })()
    return () => { cancelled = true }
  }, [scanPreviewUrl, scanPreviewPage, scanPreviewZoom])

  // ── Camera capture callback ────────────────────────────────────────────────
  const handleCameraCapture = useCallback((file: File) => {
    const { deviceClass } = getDeviceInfoForScan()
    meter.recordScan({
      deviceClass: deviceClass === 'mobile' ? 'mobile' : 'camera',
      success: true,
    })
    onDrop([file])
    setCameraScannerOpen(false)
    setInputTab('upload')
  }, [meter, onDrop])

  // Step 2: AI extracts data from each uploaded PDF (handles multi-invoice splitting)
  const startAiExtraction = async () => {
    if (uploadedFiles.length === 0) return
    setPublishValidationErrors({})
    setStep('ai_extracting')
    setCurrentExtractIndex(0)

    // Start with placeholder rows for each file
    let allClaims: ExtractedClaim[] = uploadedFiles.map((f) => ({
      id: Math.random().toString(36).slice(2),
      barcode: '',
      fileName: f.name,
      fileSize: f.size,
      fileUrl: URL.createObjectURL(f),
      fileType: f.type,
      claimNumber: '',
      patientName: '',
      patientId: '',
      memberNumber: '',
      providerName: '',
      invoiceNumber: '',
      invoiceDate: '',
      invoiceAmount: 0,
      serviceDate: '',
      diagnosis: '',
      diagnosisCode: '',
      procedureCode: '',
      treatment: '',
      aiConfidence: 0,
      aiVerified: false,
      status: 'extracting' as const,
    }))
    setClaims(allClaims)

    // Array to hold per-file results in order (ExtractedClaim[][] indexed by file)
    const perFileResults: ExtractedClaim[][] = uploadedFiles.map(() => [])

    // Per-file processing logic extracted into an inner async function so it can
    // run in parallel chunks of PARALLEL files at a time.
    const PARALLEL = 3

    const runFile = async (file: File, i: number): Promise<void> => {
      setCurrentExtractIndex(i)
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const isImage = file.type.startsWith('image/')

      // REAL extraction from PDF text
      type InvoiceRow = { patientName: string; patientId: string; memberNumber: string; providerName: string; invoiceNumber: string; invoiceDate: string; invoiceAmount: number; serviceDate: string; diagnosis: string; diagnosisCode: string; procedureCode: string; treatment: string; aiConfidence: number; pageRange: string; documentPages?: Array<{ pageNumber: number; category: string; categoryLabel: string; confidence: number; summary: string }>; lineItems?: Array<{ description: string; quantity?: number; unitPrice?: number; totalPrice?: number; taxAmount?: number; discount?: number; serviceDate?: string; procedureCode?: string; ocrConfidence?: number; lineNumber?: number }>; validationWarnings?: string[] }
      let result: { invoices: Array<InvoiceRow> }

      if (isPdf) {
        try {
          const primaryModel = extractionMode === 'ocr' ? 'tesseract' : selectedModel || undefined
          let srcInvoices: ExtractedInvoiceData[]
          let srcPageCount: number

          if (extractionMode === 'combined' && selectedModel && selectedModel !== 'tesseract') {
            const [ocrResult, aiResult] = await Promise.allSettled([
              extractInvoicesFromPdf(file, undefined, 'tesseract'),
              extractInvoicesFromPdf(file, setOcrProgress, selectedModel),
            ])
            const ocr = ocrResult.status === 'fulfilled' ? ocrResult.value : null
            const ai  = aiResult.status  === 'fulfilled' ? aiResult.value  : null
            if (ocr && ai) {
              srcPageCount = Math.max(ocr.pageCount, ai.pageCount)
              srcInvoices = ai.invoices.map((aiInv, j) =>
                mergeInvoice(ocr.invoices[j] ?? ocr.invoices[0], aiInv)
              )
            } else {
              // One pass failed — use whichever succeeded
              const fallback = ocr ?? ai!
              srcInvoices = fallback.invoices
              srcPageCount = fallback.pageCount
            }
          } else {
            const extracted = await extractInvoicesFromPdf(file, setOcrProgress, primaryModel)
            srcInvoices = extracted.invoices
            srcPageCount = extracted.pageCount
          }

          result = {
            invoices: srcInvoices.map((inv, idx) => {
              const startPage = idx === 0 ? 1 : Math.floor((idx / srcInvoices.length) * srcPageCount) + 1
              const endPage = Math.min(Math.floor(((idx + 1) / srcInvoices.length) * srcPageCount), srcPageCount)
              return {
                patientName: inv.patientName,
                patientId: inv.patientId,
                memberNumber: inv.membershipNumber,
                providerName: inv.providerName,
                invoiceNumber: inv.invoiceNumber,
                invoiceDate: inv.invoiceDate,
                invoiceAmount: inv.invoiceAmount,
                serviceDate: inv.serviceDate,
                diagnosis: inv.diagnosis,
                diagnosisCode: inv.diagnosisCode,
                procedureCode: inv.procedureCode,
                treatment: inv.treatment,
                aiConfidence: inv.confidence ?? 0.8,
                pageRange: inv.pageRange || (startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`),
                documentPages: inv.documentPages,
                lineItems: inv.lineItems,
                validationWarnings: inv.validationWarnings,
              }
            })
          }
        } catch (err) {
          console.error('PDF extraction failed, using filename-based fallback:', err)
          result = await simulateExtractFromPdf(file, i)
        }
      } else if (isImage) {
        // Camera captures and image uploads — send to the real OCR backend.
        // The /ocr/extract endpoint handles images via Tesseract (or the AI
        // vision model when one is selected).
        try {
          const primaryModel = extractionMode === 'ocr' ? 'tesseract' : selectedModel || undefined
          const extracted = await extractInvoicesFromPdf(file, setOcrProgress, primaryModel)
          result = {
            invoices: extracted.invoices.map((inv) => ({
              patientName:   inv.patientName,
              patientId:     inv.patientId,
              memberNumber:  inv.membershipNumber,
              providerName:  inv.providerName,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate:   inv.invoiceDate,
              invoiceAmount: inv.invoiceAmount,
              serviceDate:   inv.serviceDate,
              diagnosis:     inv.diagnosis,
              diagnosisCode: inv.diagnosisCode,
              procedureCode: inv.procedureCode,
              treatment:     inv.treatment,
              aiConfidence:  inv.confidence ?? 0.5,
              pageRange:     '1',
              documentPages: inv.documentPages,
              lineItems:     inv.lineItems,
              validationWarnings: inv.validationWarnings,
            }))
          }
          // Backend returned no invoices — surface an empty extraction rather
          // than fabricating data. The user reviews and fills in manually.
          if (result.invoices.length === 0) {
            result = {
              invoices: [{
                patientName: '', patientId: '', memberNumber: '',
                providerName: '', invoiceNumber: '', invoiceDate: '',
                invoiceAmount: 0, serviceDate: '',
                diagnosis: '', diagnosisCode: '', procedureCode: '', treatment: '',
                aiConfidence: 0, pageRange: '1',
              }]
            }
          }
        } catch (err) {
          console.error('Image OCR failed:', err)
          // On real backend failure, return an empty-field claim with 0 confidence
          // so the user knows extraction failed and can fill in manually.
          result = {
            invoices: [{
              patientName: '', patientId: '', memberNumber: '',
              providerName: '', invoiceNumber: '', invoiceDate: '',
              invoiceAmount: 0, serviceDate: '',
              diagnosis: '', diagnosisCode: '', procedureCode: '', treatment: '',
              aiConfidence: 0, pageRange: '1',
            }]
          }
        }
      } else {
        // Unknown file type (shouldn't happen — dropzone restricts inputs).
        result = await simulateExtractFromPdf(file, i)
      }

      const isMulti = result.invoices.length > 1

      // Generate barcodes for each invoice in this file
      const barcodes = result.invoices.map(() => generateBarcode())

      // For multi-invoice PDFs: split the PDF into separate files, then stamp each with its barcode
      // For single invoice: just stamp the barcode on the original
      let stampedFiles: Array<{ url: string; size: number; bytes?: Uint8Array }> = []

      if (isPdf && isMulti) {
        try {
          const arrayBuffer = await file.arrayBuffer()
          stampedFiles = await splitAndStampPdf(
            arrayBuffer,
            result.invoices.map((inv, j) => ({ barcode: barcodes[j], pageRange: inv.pageRange }))
          )
        } catch {
          // Fallback: stamp full PDF with first barcode
          stampedFiles = result.invoices.map(() => ({ url: URL.createObjectURL(file), size: file.size }))
        }
      } else if (isPdf) {
        try {
          const ab = await file.arrayBuffer()
          const stamped = await stampBarcodeOnPdf(ab, barcodes[0])
          stampedFiles = [{ url: stamped.url, size: file.size, bytes: stamped.bytes }]
        } catch {
          stampedFiles = [{ url: URL.createObjectURL(file), size: file.size }]
        }
      } else if (isImage) {
        try {
          const rawUrl = URL.createObjectURL(file)
          const url = await stampBarcodeOnImage(rawUrl, barcodes[0])
          stampedFiles = [{ url, size: file.size }]
        } catch {
          stampedFiles = [{ url: URL.createObjectURL(file), size: file.size }]
        }
      } else {
        stampedFiles = [{ url: URL.createObjectURL(file), size: file.size }]
      }

      const extracted: ExtractedClaim[] = []
      for (let j = 0; j < result.invoices.length; j++) {
        const inv = result.invoices[j]
        const barcode = barcodes[j]
        const stamped = stampedFiles[j] || stampedFiles[0]

        extracted.push({
          id: Math.random().toString(36).slice(2),
          barcode,
          fileName: isMulti ? `${file.name} [Invoice ${j + 1}/${result.invoices.length}]` : file.name,
          fileSize: stamped.size,
          fileUrl: stamped.url,
          fileBytes: stamped.bytes,   // kept in memory for IDB caching at publish time
          fileType: file.type,
          claimNumber: nextClaimNumber(),
          patientName: inv.patientName,
          patientId: inv.patientId,
          memberNumber: inv.memberNumber || '',
          providerName: inv.providerName,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          invoiceAmount: inv.invoiceAmount,
          serviceDate: inv.serviceDate,
          diagnosis: inv.diagnosis,
          diagnosisCode: inv.diagnosisCode,
          procedureCode: inv.procedureCode,
          treatment: inv.treatment,
          aiConfidence: inv.aiConfidence,
          aiVerified: false,
          status: 'extracted',
          splitFrom: isMulti ? file.name : undefined,
          invoiceIndex: isMulti ? j + 1 : undefined,
          totalInvoicesInPdf: isMulti ? result.invoices.length : undefined,
          pageRange: inv.pageRange,
          documentPages: inv.documentPages,
          lineItems: inv.lineItems,
          validationWarnings: inv.validationWarnings,
        })
      }
      perFileResults[i] = extracted

      // Streaming: update claims as each file completes — show real results for
      // completed files and placeholders for remaining ones.
      setClaims(() => {
        const ordered: ExtractedClaim[] = []
        for (let k = 0; k < uploadedFiles.length; k++) {
          if (perFileResults[k].length > 0) {
            ordered.push(...perFileResults[k])
          } else {
            const ph = allClaims.find(c => c.fileName === uploadedFiles[k].name && c.status === 'extracting')
            if (ph) ordered.push(ph)
          }
        }
        return ordered
      })
    }

    // Process in parallel chunks of PARALLEL files at a time
    for (let s = 0; s < uploadedFiles.length; s += PARALLEL) {
      await Promise.allSettled(
        uploadedFiles.slice(s, s + PARALLEL).map((f, j) => runFile(f, s + j))
      )
    }

    const finalClaims = perFileResults.flat()

    // AI verification pass
    await new Promise(r => setTimeout(r, 1000))
    for (const c of finalClaims) {
      c.aiVerified = true
      c.status = 'verified'
    }
    setClaims([...finalClaims])
    setStep('review')
  }
  // Keep the ref in sync so the auto-restart useEffect can call the latest version
  startAiExtractionRef.current = startAiExtraction

  // Step 2 (manual path): run OCR to pre-fill all fields, then go to review for user verification
  const startManualEntry = async () => {
    if (uploadedFiles.length === 0) return
    setPublishValidationErrors({})
    setStep('manual_processing')

    // Placeholder rows so the UI shows progress immediately
    let allClaims: ExtractedClaim[] = uploadedFiles.map((f) => ({
      id: Math.random().toString(36).slice(2),
      barcode: '',
      fileName: f.name,
      fileSize: f.size,
      fileUrl: URL.createObjectURL(f),
      fileType: f.type,
      claimNumber: '',
      patientName: '',
      patientId: '',
      memberNumber: '',
      providerName: '',
      invoiceNumber: '',
      invoiceDate: '',
      invoiceAmount: 0,
      serviceDate: '',
      diagnosis: '',
      diagnosisCode: '',
      procedureCode: '',
      treatment: '',
      aiConfidence: 0,
      aiVerified: false,
      status: 'extracting' as const,
    }))
    setClaims(allClaims)

    const finalClaims: ExtractedClaim[] = []

    for (let i = 0; i < uploadedFiles.length; i++) {
      setCurrentExtractIndex(i)
      const file = uploadedFiles[i]
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const isImage = file.type.startsWith('image/')
      const barcode = generateBarcode()

      // ── Stamp barcode ──
      let stampedUrl = URL.createObjectURL(file)
      let stampedSize = file.size
      let stampedBytes: Uint8Array | undefined
      if (isPdf) {
        try {
          const ab = await file.arrayBuffer()
          const stamped = await stampBarcodeOnPdf(ab, barcode)
          stampedUrl = stamped.url; stampedBytes = stamped.bytes
        } catch { /* use original */ }
      } else if (isImage) {
        try { stampedUrl = await stampBarcodeOnImage(URL.createObjectURL(file), barcode) } catch { /* use original */ }
      }

      // ── OCR pre-fill: extract all readable fields from the document ──
      let extracted: {
        patientName: string; patientId: string; memberNumber: string; providerName: string
        invoiceNumber: string; invoiceDate: string; invoiceAmount: number
        serviceDate: string; diagnosis: string; diagnosisCode: string
        procedureCode: string; treatment: string; confidence: number
        validationWarnings?: string[]
      } = {
        patientName: '', patientId: '', memberNumber: '',
        providerName: provider && provider !== 'auto' ? provider : '',
        invoiceNumber: '', invoiceDate: '', invoiceAmount: 0,
        serviceDate: '', diagnosis: '', diagnosisCode: '', procedureCode: '', treatment: '',
        confidence: 0,
      }

      if (isPdf) {
        try {
          setOcrProgress(`Reading document ${i + 1}/${uploadedFiles.length}…`)
          const { invoices } = await extractInvoicesFromPdf(file, setOcrProgress, selectedModel || undefined)
          if (invoices.length > 0) {
            const inv = invoices[0]
            extracted = {
              patientName:   inv.patientName   || '',
              patientId:     inv.patientId     || '',
              memberNumber:  inv.membershipNumber || '',
              providerName:  inv.providerName  || (provider && provider !== 'auto' ? provider : ''),
              invoiceNumber: inv.invoiceNumber || '',
              invoiceDate:   inv.invoiceDate   || '',
              invoiceAmount: inv.invoiceAmount || 0,
              serviceDate:   inv.serviceDate   || '',
              diagnosis:     inv.diagnosis     || '',
              diagnosisCode: inv.diagnosisCode || '',
              procedureCode: inv.procedureCode || '',
              treatment:     inv.treatment     || '',
              confidence:    inv.confidence    || 0,
              validationWarnings: inv.validationWarnings,
            }
          }
        } catch { /* OCR failed — leave blank for user to fill */ }
      }

      const claim: ExtractedClaim = {
        id: Math.random().toString(36).slice(2),
        barcode,
        fileName: file.name,
        fileSize: stampedSize,
        fileUrl: stampedUrl,
        fileBytes: stampedBytes,
        fileType: file.type,
        claimNumber: nextClaimNumber(),
        ...extracted,
        aiConfidence: 1,   // 1 = manual entry is treated as 100% confident
        aiVerified: false,
        status: 'extracted' as const,
      }
      finalClaims.push(claim)

      // Update UI row in real time
      setClaims([...finalClaims, ...allClaims.slice(i + 1)])
    }

    setOcrProgress('')
    setClaims([...finalClaims])
    setStep('review')
  }

  // Auto-reset after publish completes so the page is ready for a new upload
  useEffect(() => {
    if (step !== 'complete') return
    const timer = setTimeout(() => resetAll(), 5000)
    return () => clearTimeout(timer)
  }, [step])

  // Validate all invoice fields before publishing
  const validateAllClaims = (): Record<string, string[]> => {
    const REQUIRED: Array<{ key: keyof ExtractedClaim; label: string }> = [
      { key: 'patientName',   label: 'Patient Name' },
      { key: 'patientId',     label: 'Patient ID' },
      { key: 'memberNumber',  label: 'Member Number' },
      { key: 'providerName',  label: 'Provider' },
      { key: 'invoiceNumber', label: 'Invoice Number' },
      { key: 'invoiceDate',   label: 'Invoice Date' },
      { key: 'invoiceAmount', label: 'Invoice Amount' },
      { key: 'serviceDate',   label: 'Date of Service' },
      { key: 'diagnosis',     label: 'Diagnosis' },
      { key: 'treatment',     label: 'Treatment' },
    ]
    const PLACEHOLDER = new Set([
      '', 'OCR Processing Required', 'Unknown Patient', 'Unknown Provider',
      'Upload to backend for extraction', '0',
    ])
    const errors: Record<string, string[]> = {}
    for (const c of claims) {
      const missing: string[] = []
      for (const { key, label } of REQUIRED) {
        const val = String(c[key] ?? '').trim()
        if (!val || PLACEHOLDER.has(val) || (key === 'invoiceAmount' && Number(c[key]) <= 0)) {
          missing.push(label)
        }
      }
      if (missing.length) errors[c.id] = missing
    }
    return errors
  }

  // Step 4: Publish claims to system (saves to backend DB + local store)
  const publishClaims = async () => {
    const errors = validateAllClaims()
    if (Object.keys(errors).length > 0) {
      setPublishValidationErrors(errors)
      return
    }
    setPublishValidationErrors({})
    setStep('publishing')
    setPublishProgress(0)

    // commitAnnotations() keeps claims state always current — safe to snapshot directly
    const total = claims.length
    const batchId = `BTH-${Date.now()}`

    // Reserve a unique batch number from the server so concurrent sessions
    // in different tabs never share the same batch.
    let batchNumber: string
    try {
      const { data } = await api.post('/batch-submissions/reserve-number')
      batchNumber = data.batchNumber
    } catch {
      batchNumber = _fallbackBatchNumber()
    }

    const uploadedBy = user?.email || user?.name || 'unknown'
    const working = claims.map(c => ({ ...c }))
    let completed = 0

    // Run up to 5 API calls at the same time instead of one-by-one
    const CONCURRENCY = 5
    const queue: number[] = claims.map((_, i) => i)

    const worker = async () => {
      while (queue.length > 0) {
        const i = queue.shift()!
        const c = working[i]

        try {
          const { data: savedClaim } = await api.post('/claims', {
            claimNumber: c.claimNumber,
            barcode: c.barcode,
            patientName: c.patientName,
            patientId: c.patientId,
            memberNumber: c.memberNumber || c.patientId,
            memberName: c.patientName,
            providerName: isProviderUser ? provider : (c.providerName || provider),
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate || undefined,
            dateOfService: c.serviceDate || undefined,
            amount: c.invoiceAmount,
            diagnosis: c.diagnosis,
            diagnosisCode: c.diagnosisCode,
            procedureCode: c.procedureCode,
            treatment: c.treatment,
            ocrConfidence: c.aiConfidence,
            batchNumber,
            uploadedBy,
            branchName: branch || undefined,
          })
          // Store DB id and AWAIT annotation save — must not be fire-and-forget
          working[i] = { ...working[i], dbId: savedClaim?.id }

          // Upload the PDF bytes to the backend and link them to this claim.
          // Without this, the claim row exists but the viewer shows
          // "No documents attached" because the frontend blob URL is local-only
          // and does not survive a page reload or transfer to another user.
          if (c.fileBytes && savedClaim?.id) {
            try {
              const fileBlob = new globalThis.File(
                [c.fileBytes as unknown as BlobPart],
                c.fileName,
                { type: c.fileType || 'application/pdf' },
              )
              const docForm = new FormData()
              docForm.append('file', fileBlob)
              await api.post(
                `/documents/upload?claimId=${savedClaim.id}${branch ? `&branchName=${encodeURIComponent(branch)}` : ''}`,
                docForm,
                { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 },
              )
            } catch (err: any) {
              console.warn(`Document upload failed for ${c.claimNumber}:`, err?.response?.data || err.message)
            }
          }

          if (c.annotations?.length && savedClaim?.id) {
            await api.patch(`/claims/${savedClaim.id}/annotations`, { annotations: c.annotations }).catch(() => {})
          }
        } catch (err: any) {
          console.error(`Failed to save claim ${c.claimNumber}:`, err?.response?.data || err.message)
        }

        // Cache PDF bytes in IndexedDB under both the frontend id AND the DB UUID
        // so restoreAsFiles() works regardless of which id the store holds.
        if (c.fileBytes) {
          const fileObj = new globalThis.File([c.fileBytes as unknown as BlobPart], c.fileName, { type: c.fileType })
          const dbId = working[i].dbId
          cacheFile(c.id, fileObj).catch(() => {})
          if (dbId && dbId !== c.id) cacheFile(dbId, fileObj).catch(() => {})
        }

        working[i] = { ...working[i], status: 'published' }
        completed++
        setClaims([...working])
        setPublishProgress((completed / total) * 100)
      }
    }

    // Drain queue with N parallel workers
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))

    const savedClaims = working
    // Push all published claims into the shared claims store
    const storeClaims = savedClaims.map(c => ({
      id: c.dbId || c.id,   // use DB UUID so Claims page passes the right ID to DocumentViewer
      barcode: c.barcode,
      claimNumber: c.claimNumber,
      memberNumber: c.memberNumber || c.patientId,
      memberName: c.patientName,
      patientName: c.patientName,
      patientId: c.patientId,
      provider: { name: c.providerName || provider },
      invoiceAmount: c.invoiceAmount,
      invoiceNumber: c.invoiceNumber,
      invoiceDate: c.invoiceDate,
      serviceDate: c.serviceDate || '',
      status: 'submitted',
      workflowStage: 'initial_review',
      priority: c.invoiceAmount > 100000 ? 'high' : 'normal',
      ocrStatus: 'completed',
      diagnosis: c.diagnosis,
      diagnosisCode: c.diagnosisCode,
      procedureCode: c.procedureCode,
      treatment: c.treatment,
      submittedAt: new Date().toISOString(),
      documents: [{ name: c.fileName, size: c.fileSize, type: c.fileType, url: c.fileUrl }],
      aiExtracted: true,
      batchId,
      batchNumber,
      uploadedBy,
      batchType: 'batch' as const,
      aiConfidence: c.aiConfidence,
    }))
    addClaims(storeClaims)

    // Send one batch confirmation email covering all published claims
    if (user?.email) {
      api.post('/notifications/batch-confirmation', {
        recipientEmail: user.email,
        submittedBy: uploadedBy,
        batchNumber,
        totalClaims: savedClaims.length,
        totalAmount: savedClaims.reduce((s, c) => s + c.invoiceAmount, 0),
        claims: savedClaims.map(c => ({
          claimNumber: c.claimNumber,
          barcode: c.barcode,
          patientName: c.patientName,
          providerName: c.providerName || provider,
          invoiceNumber: c.invoiceNumber,
          invoiceDate: c.invoiceDate,
          invoiceAmount: c.invoiceAmount,
          diagnosis: c.diagnosis,
        })),
      }).catch(() => {}) // non-blocking
    }

    setStep('complete')
    if (session?.sessionId) clearCachedFiles(session.sessionId).catch(() => {})
    clearSession()
  }

  // Export to Excel
  const exportToExcel = async () => {
    const rows = claims.map(c => ({
      'Barcode': c.barcode,
      'Claim Number': c.claimNumber,
      'Patient Name': c.patientName,
      'Patient ID': c.patientId,
      'Provider': c.providerName,
      'Invoice Number': c.invoiceNumber,
      'Invoice Date': c.invoiceDate,
      'Invoice Amount': c.invoiceAmount,
      'Service Date': c.serviceDate,
      'Diagnosis': c.diagnosis,
      'Diagnosis Code': c.diagnosisCode,
      'Procedure Code': c.procedureCode,
      'Treatment': c.treatment,
      'AI Confidence': `${(c.aiConfidence * 100).toFixed(0)}%`,
      'Document': c.fileName,
      'Status': c.status,
    }))
    await downloadXlsx(
      [{ name: 'Extracted Claims', rows }],
      `CIC_Batch_Claims_${new Date().toISOString().split('T')[0]}.xlsx`,
    )
  }

  const resetAll = () => {
    if (session?.sessionId) clearCachedFiles(session.sessionId).catch(() => {})
    setUploadedFiles([])
    setClaims([])
    setStep('upload')
    if (!isProviderUser) setProvider('')   // keep locked for provider staff
    setBranch(isProviderUser && (user as any)?.branchId ? branch : '')
    setCurrentExtractIndex(0)
    setPublishProgress(0)
    setRestoredSession(false)
    clearSession()
  }

  const totalSize = uploadedFiles.reduce((a, f) => a + f.size, 0)
  const extractedCount = claims.filter(c => c.status !== 'extracting').length
  const verifiedCount = claims.filter(c => c.aiVerified).length
  const publishedCount = claims.filter(c => c.status === 'published').length
  const avgConfidence = claims.length > 0
    ? claims.reduce((a, c) => a + c.aiConfidence, 0) / claims.length
    : 0

  return (
    <div className="space-y-4 sm:space-y-6 max-w-[1600px]">

      {/* ── Fullscreen camera scanner overlay ─────────────────────────────── */}
      {cameraScannerOpen && (
        <CameraScanner
          onCapture={handleCameraCapture}
          onClose={() => setCameraScannerOpen(false)}
          meterEnabled={meter.enabled}
        />
      )}

      {/* ── Scan preview — approve before upload ──────────────────────────── */}
      <Dialog open={!!scanPreviewUrl} onOpenChange={open => { if (!open) closeScanPreview() }}>
        <DialogContent className="max-w-3xl w-full p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-violet-500" />
              Review Scanned Document
            </DialogTitle>
            <DialogDescription>
              Check the scan looks correct before sending it for AI processing. Blank or misaligned? Rescan instead.
            </DialogDescription>
          </DialogHeader>

          {/* PDF canvas */}
          <div className="flex flex-col items-center bg-muted/40 overflow-auto" style={{ maxHeight: '60vh' }}>
            {/* Page / zoom controls */}
            <div className="flex items-center gap-2 px-4 py-2 w-full border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={scanPreviewPage <= 1}
                onClick={() => setScanPreviewPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs tabular-nums">{scanPreviewPage} / {scanPreviewPages}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={scanPreviewPage >= scanPreviewPages}
                onClick={() => setScanPreviewPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setScanPreviewZoom(z => Math.max(0.5, z - 0.25))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs w-10 text-center">{Math.round(scanPreviewZoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setScanPreviewZoom(z => Math.min(3, z + 0.25))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="p-4 flex justify-center w-full">
              <canvas
                ref={scanPreviewCanvasRef}
                className="shadow-lg rounded max-w-full"
              />
            </div>
          </div>

          <DialogFooter className="px-5 py-4 border-t flex-row gap-2 justify-between">
            <Button variant="outline" onClick={closeScanPreview}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { closeScanPreview() }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Rescan
              </Button>
              <Button onClick={handleScanApprove} className="bg-violet-600 hover:bg-violet-700 text-white">
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve &amp; Process
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Restored session banner ────────────────────────────────────────── */}
      {restoredSession && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 text-sm">
          <History className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300 flex-1">
            <strong>Session restored.</strong> You left this page while{' '}
            {session?.step === 'ai_extracting' ? 'AI was extracting data' :
             session?.step === 'review' ? 'claims were awaiting your review' :
             session?.step === 'publishing' ? 'publishing was in progress' : 'working'}.
            {' '}Your data has been recovered — continue from where you left off.
          </span>
          <Button size="sm" variant="ghost" className="text-amber-700 hover:text-amber-900 h-7 px-2"
            onClick={() => setRestoredSession(false)}>
            Dismiss
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 border-amber-400 text-amber-800"
            onClick={resetAll}>
            <RotateCcw className="h-3 w-3 mr-1" /> Start fresh
          </Button>
        </div>
      )}

      {/* ── Premium hero header ───────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-xl sm:rounded-2xl border bg-gradient-to-br from-violet-50 via-background to-blue-50 p-4 shadow-sm dark:from-violet-950/40 dark:via-background dark:to-blue-950/40 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)] [background-size:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-lg shadow-violet-500/30">
              <CloudUpload className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Batch Upload</h1>
              <p className="text-sm text-muted-foreground mt-1">Upload invoices · AI extracts data · Review &amp; publish to claims</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10">
                  <Sparkles className="h-3 w-3" /> AI-powered
                </Badge>
                <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10">
                  <ShieldCheck className="h-3 w-3" /> OCR + verification
                </Badge>
                <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10">
                  <FileSpreadsheet className="h-3 w-3" /> Excel export
                </Badge>
              </div>
            </div>
          </div>
          {step !== 'upload' && (
            <Button variant="outline" onClick={resetAll} className="gap-2 self-start shadow-sm">
              <RotateCcw className="h-4 w-4" /> Start Over
            </Button>
          )}
        </div>
      </div>

      {/* ── Premium stepper ───────────────────────────────────────── */}
      <div className="rounded-xl sm:rounded-2xl border bg-card p-3 shadow-sm sm:p-5">
        <div className="flex items-center justify-between">
          {[
            { key: 'upload',        label: 'Upload',   icon: Upload },
            { key: 'ai_extracting', label: 'Extract',  icon: Brain },
            { key: 'review',        label: 'Review',   icon: ShieldCheck },
            { key: 'publishing',    label: 'Publish',  icon: ClipboardList },
            { key: 'complete',      label: 'Done',     icon: CheckCircle },
          ].map((s, i, arr) => {
            const stepOrder = ['upload', 'ai_extracting', 'review', 'publishing', 'complete']
            const currentIdx = stepOrder.indexOf(step)
            const thisIdx = stepOrder.indexOf(s.key)
            const isActive = s.key === step
            const isDone = thisIdx < currentIdx
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'relative flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 transition-all duration-300',
                    isActive && 'border-violet-500 bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-lg shadow-violet-500/30 scale-110',
                    isDone && 'border-emerald-500 bg-emerald-500 text-white',
                    !isActive && !isDone && 'border-muted bg-background text-muted-foreground'
                  )}>
                    {isActive && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-violet-500 opacity-20" />
                    )}
                    {isDone ? <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5" /> : <s.icon className="h-4 w-4 sm:h-5 sm:w-5" />}
                  </div>
                  <p className={cn(
                    'text-[9px] sm:text-[10px] font-semibold text-center leading-tight',
                    isActive ? 'text-violet-600 dark:text-violet-400' : isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                  )}>{s.label}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="relative mx-1 sm:mx-2 flex-1 mb-4">
                    <div className="h-0.5 w-full rounded-full bg-muted" />
                    <div className={cn(
                      'absolute inset-y-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-violet-500 transition-all duration-500',
                      isDone ? 'w-full' : 'w-0'
                    )} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4 min-w-0">

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <Card className="overflow-hidden border-violet-500/10 shadow-sm">
              <CardHeader className="border-b bg-gradient-to-r from-violet-50/70 via-background to-blue-50/70 dark:from-violet-950/20 dark:to-blue-950/20">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-md shadow-violet-500/30">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Upload Invoices</CardTitle>
                    <CardDescription>Drop PDF invoices or medical documents. AI will extract all claim data automatically.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-6">
                {/* ── Provider field ── */}
                <div className="space-y-1.5">
                  {isProviderUser ? (
                    /* Provider staff: provider is locked to their account */
                    <>
                      <Label>Provider</Label>
                      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium flex-1">{provider || 'Loading…'}</span>
                        <Badge variant="secondary" className="text-[10px]">Auto-filled</Badge>
                      </div>
                    </>
                  ) : (
                    /* CIC staff: free selection from approved providers */
                    <>
                      <Label>Provider <span className="text-muted-foreground font-normal text-xs">(optional – AI detects from invoice)</span></Label>
                      <Select
                        value={provider || '__auto__'}
                        onValueChange={(v) => {
                          const name = v === '__auto__' ? '' : v
                          setProvider(name)
                          setBranch('')
                          // Load branches for the selected provider
                          if (name) {
                            const prov = approvedProviders.find(p => p.name === name)
                            if (prov) {
                              api.get(`/branches?providerId=${prov.id}`)
                                .then(({ data }) => {
                                  const list = Array.isArray(data) ? data : Array.isArray(data?.branches) ? data.branches : []
                                  setProviderBranches(list.filter((b: any) => b.isActive).map((b: any) => ({ id: b.id, name: b.name, code: b.code })))
                                })
                                .catch(() => {})
                            }
                          } else {
                            setProviderBranches([])
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Auto-detect from invoices" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">Auto-detect from invoices</SelectItem>
                          {approvedProviders.length > 0
                            ? approvedProviders.map(p => (
                                <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                              ))
                            : ['Nairobi Hospital', 'Aga Khan University Hospital', 'MP Shah Hospital',
                               'Karen Hospital', 'Kenyatta National Hospital'].map(n => (
                                <SelectItem key={n} value={n}>{n}</SelectItem>
                              ))
                          }
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>

                {/* ── Branch field ── */}
                {(providerBranches.length > 0 || (isProviderUser && providerBranches.length > 0)) && (
                  <div className="space-y-1.5">
                    {isProviderUser && (user as any)?.branchId ? (
                      /* Branch user: branch is locked */
                      <>
                        <Label>Branch</Label>
                        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium flex-1">{branch || 'Loading…'}</span>
                          <Badge variant="secondary" className="text-[10px]">Auto-filled</Badge>
                        </div>
                      </>
                    ) : (
                      /* provider_admin or CIC staff: can select branch */
                      <>
                        <Label>Branch <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                        <Select value={branch || '__all__'} onValueChange={v => setBranch(v === '__all__' ? '' : v)}>
                          <SelectTrigger><SelectValue placeholder="All branches / not specific" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All branches / not specific</SelectItem>
                            {providerBranches.map(b => (
                              <SelectItem key={b.id} value={b.name}>
                                {b.name} <span className="text-muted-foreground text-xs font-mono">({b.code})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}
                  </div>
                )}

                {/* ── Input source tabs: Upload vs. Scanner ── */}
                <div className="flex rounded-xl border-2 border-violet-100/70 dark:border-violet-900/30 bg-gradient-to-r from-violet-50/50 via-background to-blue-50/50 dark:from-violet-950/10 dark:via-background dark:to-blue-950/10 p-1.5 gap-1.5 shadow-inner">
                  {([
                    { key: 'upload', icon: CloudUpload, label: 'Upload Files' },
                    { key: 'scanner', icon: Printer, label: 'Scan Document' },
                  ] as const).map(({ key, icon: Icon, label }) => (
                    <button
                      key={key}
                      onClick={() => setInputTab(key)}
                      className={cn(
                        'flex-1 relative flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                        inputTab === key
                          ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-md shadow-violet-500/30'
                          : 'text-muted-foreground hover:text-violet-700 dark:hover:text-violet-300 hover:bg-white/60 dark:hover:bg-white/5',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 transition-all duration-200', inputTab === key && 'scale-110 drop-shadow-sm')} />
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Scan metering status: disabled banner or price chip ── */}
                {inputTab === 'scanner' && !meter.loading && !meter.enabled && (
                  <div className="rounded-xl border-2 border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 p-4 flex items-start gap-3">
                    <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                        Scanning is disabled for your organization
                      </p>
                      <p className="text-xs text-red-700/80 dark:text-red-300/80">
                        Contact your ClaimsFlow administrator to enable scan capture and billing for your branch.
                      </p>
                    </div>
                  </div>
                )}
                {inputTab === 'scanner' && !meter.loading && meter.enabled && meter.costPerScan > 0 && (
                  <div className="rounded-md border bg-muted/40 px-3 py-1.5 flex items-center gap-2 text-[11px]">
                    <Receipt className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                    <span className="text-muted-foreground">
                      Each scan is billed at <strong className="text-foreground">{meter.currency} {meter.costPerScan.toFixed(2)}</strong> to your organization.
                    </span>
                  </div>
                )}

                {/* ── Scanner panel ── */}
                {inputTab === 'scanner' && (
                  <div className="rounded-xl border bg-muted/20 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">Connected Scanners</p>
                          {scanners.length > 0 && !scannersLoading && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                              {scanners.length}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          TWAIN / SANE / AirScan compatible devices
                          {agentHostname && <span className="ml-1 text-muted-foreground/60">· {agentHostname}</span>}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={fetchScanners} disabled={scannersLoading} className="h-8 gap-1.5">
                        <RefreshCw className={cn('h-3.5 w-3.5', scannersLoading && 'animate-spin')} />
                        Refresh
                      </Button>
                    </div>

                    {scannersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Detecting scanners…</span>
                      </div>
                    ) : cloudHostedScanner ? (
                      <div className="space-y-4">
                        {/* ── Local agent running → full TWAIN/SANE/ISIS scanner UI ── */}
                        {agentAvailable === true && (
                          <>
                            {scannersLoading ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                <span className="ml-2 text-sm text-muted-foreground">Detecting scanners…</span>
                              </div>
                            ) : scanners.length === 0 ? (
                              <div className="rounded-xl border-2 border-dashed p-8 text-center">
                                <WifiOff className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                                <p className="text-sm font-medium text-muted-foreground">No scanners detected</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Connect a scanner via USB or network and click Refresh.<br />
                                  Supports TWAIN, WIA, SANE, and ISIS-compatible devices.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {scanners.map(s => {
                                  const { isNetwork, driverLabel } = getScannerMeta(s)
                                  return (
                                    <label
                                      key={s.id}
                                      className={cn(
                                        'flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all',
                                        selectedScanner === s.id
                                          ? 'border-violet-400 bg-violet-50/60 dark:bg-violet-950/30 ring-1 ring-violet-400/20'
                                          : 'border-border hover:border-violet-300/60 hover:bg-muted/30',
                                      )}
                                    >
                                      <input type="radio" name="scanner-device" value={s.id}
                                        checked={selectedScanner === s.id}
                                        onChange={() => setSelectedScanner(s.id)}
                                        className="sr-only" />
                                      <div className={cn(
                                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                                        isNetwork
                                          ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-400'
                                          : 'bg-violet-50 border-violet-200 text-violet-600 dark:bg-violet-950/40 dark:border-violet-800 dark:text-violet-400',
                                      )}>
                                        {isNetwork ? <Wifi className="h-5 w-5" /> : <Printer className="h-5 w-5" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold leading-tight truncate">{s.model || s.name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                          <Badge variant="outline" className={cn(
                                            'text-[9px] h-4 px-1.5 shrink-0 font-mono',
                                            isNetwork ? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400'
                                                      : 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
                                          )}>
                                            {driverLabel}
                                          </Badge>
                                          <p className="text-[10px] text-muted-foreground font-mono truncate">{s.id}</p>
                                        </div>
                                      </div>
                                      <div className={cn(
                                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                                        selectedScanner === s.id ? 'border-violet-500' : 'border-muted-foreground/30',
                                      )}>
                                        {selectedScanner === s.id && <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />}
                                      </div>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                            {scanners.length > 0 && (
                              <div className="space-y-3 pt-1">
                                {/* Paper Source — auto-detected from scanner capabilities */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                    <Label className="text-xs">Paper Source</Label>
                                    {scannerCapsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                  </div>
                                  <Select value={scanSource} onValueChange={v => setScanSource(v as ScanSource)}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {(!scannerCaps || scannerCaps.sources.includes('flatbed')) && (
                                        <SelectItem value="flatbed">Flatbed (Glass)</SelectItem>
                                      )}
                                      {(!scannerCaps || scannerCaps.sources.includes('feeder')) && (
                                        <SelectItem value="feeder">Document Feeder (ADF)</SelectItem>
                                      )}
                                      {(!scannerCaps || scannerCaps.sources.includes('feeder-duplex')) && (
                                        <SelectItem value="feeder-duplex">Feeder — Both Sides (Duplex)</SelectItem>
                                      )}
                                      <SelectItem value="auto">Auto Detect</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Resolution + Color Mode */}
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1.5">
                                    <Label className="text-xs">Resolution</Label>
                                    <Select value={scanDpi} onValueChange={setScanDpi}>
                                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="75">75 DPI — Draft</SelectItem>
                                        <SelectItem value="150">150 DPI — Fast</SelectItem>
                                        <SelectItem value="200">200 DPI — Balanced</SelectItem>
                                        <SelectItem value="300">300 DPI — Standard</SelectItem>
                                        <SelectItem value="600">600 DPI — High quality</SelectItem>
                                        <SelectItem value="1200">1200 DPI — Archival</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label className="text-xs">Color Mode</Label>
                                    <Select value={scanMode} onValueChange={setScanMode}>
                                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Color">Color</SelectItem>
                                        <SelectItem value="Gray">Grayscale</SelectItem>
                                        <SelectItem value="Lineart">Black &amp; White</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                {/* Paper Size */}
                                <div className="space-y-1.5">
                                  <Label className="text-xs">Paper Size</Label>
                                  <Select value={scanPaperSize} onValueChange={v => setScanPaperSize(v as ScanPaperSize)}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="auto">Auto Detect</SelectItem>
                                      <SelectItem value="a4">A4  (210 × 297 mm)</SelectItem>
                                      <SelectItem value="a5">A5  (148 × 210 mm)</SelectItem>
                                      <SelectItem value="letter">Letter  (8.5 × 11 in)</SelectItem>
                                      <SelectItem value="legal">Legal  (8.5 × 14 in)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Toggles — Skip Blank Pages */}
                                <div className="rounded-lg border bg-muted/30 divide-y">
                                  <div className="flex items-center justify-between px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <FileX className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      <div>
                                        <p className="text-xs font-medium leading-tight">Skip blank pages</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">Automatically remove empty pages from the scan</p>
                                      </div>
                                    </div>
                                    <Switch checked={scanSkipBlank} onCheckedChange={setScanSkipBlank} />
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-3 py-2">
                              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                              <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                                Scan Agent connected{agentHostname ? ` · ${agentHostname}` : ''} — TWAIN / SANE / ISIS ready
                              </span>
                            </div>

                            {/* ── Upgrade banner ── */}
                            {agentNeedsUpgrade && (
                              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 flex gap-3 items-start">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                                    Scan Agent update required (v{agentVersion} → v{AGENT_MIN_VERSION})
                                  </p>
                                  <p className="text-xs text-amber-700 dark:text-amber-400">
                                    Your scan agent is out of date. Scanning may fail until you upgrade. Download the latest installer and run it — your settings are preserved.
                                  </p>
                                  <div className="flex gap-2 flex-wrap pt-0.5">
                                    {agentOs === 'win32' ? (
                                      <a
                                        href="https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/ClaimsFlow-Scan-Agent-Setup.exe"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
                                        rel="noopener noreferrer"
                                        target="_blank"
                                      >
                                        <Download className="h-3 w-3" />
                                        Download Windows Installer
                                      </a>
                                    ) : (
                                      <a
                                        href="https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
                                        rel="noopener noreferrer"
                                        target="_blank"
                                      >
                                        <Download className="h-3 w-3" />
                                        Download Linux/macOS Installer
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* ── Agent not running → instructions + camera fallback ── */}
                        {agentAvailable === false && (
                          <div className="space-y-3">
                            <div className="rounded-lg border border-violet-200 bg-violet-50/60 dark:bg-violet-950/20 dark:border-violet-800 p-4 space-y-3">
                              <p className="text-sm font-semibold flex items-center gap-2">
                                <Printer className="h-4 w-4 text-violet-600 shrink-0" />
                                Connect your physical scanner
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Install the <strong>ClaimsFlow Scan Agent</strong> — a small service that runs on your computer and exposes your TWAIN, WIA, ISIS, and SANE-compatible scanners to the web UI.
                              </p>
                              {/* Windows installer */}
                              <div className="rounded-md border bg-background p-3 space-y-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Windows</p>
                                <a
                                  href="https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/ClaimsFlow-Scan-Agent-Setup.exe"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Download ClaimsFlow-Scan-Agent-Setup.exe
                                </a>
                                <p className="text-[10px] text-muted-foreground">
                                  Installs as a Windows service. Supports TWAIN, WIA, ISIS (Kodak Alaris, Fujitsu, Panasonic), Epson, HP, Canon, and network scanners.
                                </p>
                                <div className="rounded border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                                  <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
                                  <span>
                                    Windows SmartScreen may show <strong>&quot;Windows protected your PC&quot;</strong> because this installer is not code-signed. Click <strong>More info → Run anyway</strong> — the agent is a small open-source Node.js service published from this repository.
                                  </span>
                                </div>
                                <div className="pt-1.5 space-y-1.5">
                                  <p className="text-[10px] text-muted-foreground">Or run from an <strong>Administrator</strong> PowerShell:</p>
                                  <InstallSnippet command={'irm https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.ps1 | iex'} />
                                </div>
                              </div>
                              {/* Linux */}
                              <div className="rounded-md border bg-background p-3 space-y-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Linux</p>
                                <InstallSnippet command={'curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh -o claimsflow-install.sh && bash claimsflow-install.sh'} />
                                <p className="text-[10px] text-muted-foreground">
                                  Installs a prebuilt binary to <code className="font-mono">~/.local/bin</code> and registers a systemd user service. Optionally installs SANE via apt / dnf / pacman.
                                </p>
                              </div>
                              {/* macOS */}
                              <div className="rounded-md border bg-background p-3 space-y-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">macOS</p>
                                <InstallSnippet command={'curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh -o claimsflow-install.sh && bash claimsflow-install.sh'} />
                                <p className="text-[10px] text-muted-foreground">
                                  Installs a prebuilt binary and registers a launchd agent so the service auto-starts on login. Optionally <code className="font-mono">brew install sane-backends</code>.
                                </p>
                              </div>
                              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside pt-1">
                                <li>Install the agent using the option above for your OS</li>
                                <li>Click <strong>Refresh</strong> — your scanner will appear in the list</li>
                              </ol>
                            </div>
                            <div className="relative flex items-center gap-2">
                              <div className="flex-1 border-t" />
                              <span className="text-xs text-muted-foreground shrink-0">or use your camera</span>
                              <div className="flex-1 border-t" />
                            </div>
                            <Button
                              onClick={() => setCameraScannerOpen(true)}
                              variant="outline"
                              className="w-full gap-2 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            >
                              <Camera className="h-4 w-4" />
                              Scan with Camera / Phone
                            </Button>
                          </div>
                        )}

                        {/* ── Checking agent status ── */}
                        {agentAvailable === null && (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-sm text-muted-foreground">Checking for local scan agent…</span>
                          </div>
                        )}

                        {/* ── Scan button when agent is connected ── */}
                        {agentAvailable === true && scanners.length > 0 && (
                          <>
                            {scanError && (
                              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />{scanError}
                              </div>
                            )}
                            <Button
                              className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white gap-2 h-11"
                              disabled={!selectedScanner || scanning}
                              onClick={handleScan}
                            >
                              {scanning ? (
                                <><Loader2 className="h-4 w-4 animate-spin" />Scanning document…</>
                              ) : (
                                <><ScanLine className="h-4 w-4" />Scan Document</>
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    ) : !driverAvailable ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4">
                        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {serverPlatform === 'windows' ? 'Windows Image Acquisition (WIA) unavailable' : 'SANE scanner driver not installed'}
                        </div>
                        <p className="text-amber-600 dark:text-amber-500 text-xs mt-1.5">
                          {serverPlatform === 'windows' ? (
                            <>WIA is built into Windows Vista and later. Ensure the scanner's WIA driver is installed via <strong>Device Manager</strong> or the manufacturer's setup tool, then click Refresh.</>
                          ) : (
                            <>Run <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">sudo apt install sane-utils</code> on the server, then click Refresh.</>
                          )}
                        </p>
                      </div>
                    ) : scanners.length === 0 ? (
                      <div className="space-y-4">
                        <div className="rounded-xl border-2 border-dashed p-6 text-center">
                          <WifiOff className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                          <p className="text-sm font-medium text-muted-foreground">No scanners detected</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Connect a scanner via USB or network and click Refresh.<br />
                            Supports all TWAIN/SANE devices including Kodak Alaris, Epson, HP, Canon, Fujitsu.
                          </p>
                        </div>
                        <div className="relative flex items-center gap-2">
                          <div className="flex-1 border-t" />
                          <span className="text-xs text-muted-foreground shrink-0">or scan with your camera / phone</span>
                          <div className="flex-1 border-t" />
                        </div>
                        <Button
                          onClick={() => setCameraScannerOpen(true)}
                          variant="outline"
                          className="w-full gap-2 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                        >
                          <Camera className="h-4 w-4" />
                          Scan with Camera / Phone
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {scanners.map(s => {
                          const { isNetwork, driverLabel } = getScannerMeta(s)
                          return (
                            <label
                              key={s.id}
                              className={cn(
                                'flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all',
                                selectedScanner === s.id
                                  ? 'border-violet-400 bg-violet-50/60 dark:bg-violet-950/30 ring-1 ring-violet-400/20'
                                  : 'border-border hover:border-violet-300/60 hover:bg-muted/30',
                              )}
                            >
                              <input
                                type="radio"
                                name="scanner-device"
                                value={s.id}
                                checked={selectedScanner === s.id}
                                onChange={() => setSelectedScanner(s.id)}
                                className="sr-only"
                              />
                              <div className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                                isNetwork
                                  ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-400'
                                  : 'bg-violet-50 border-violet-200 text-violet-600 dark:bg-violet-950/40 dark:border-violet-800 dark:text-violet-400',
                              )}>
                                {isNetwork ? <Wifi className="h-5 w-5" /> : <Printer className="h-5 w-5" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold leading-tight truncate">{s.model || s.name}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <Badge variant="outline" className={cn(
                                    'text-[9px] h-4 px-1.5 shrink-0 font-mono',
                                    isNetwork ? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400'
                                              : 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400',
                                  )}>
                                    {driverLabel}
                                  </Badge>
                                  <p className="text-[10px] text-muted-foreground font-mono truncate">{s.id}</p>
                                </div>
                              </div>
                              <div className={cn(
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                                selectedScanner === s.id ? 'border-violet-500' : 'border-muted-foreground/30',
                              )}>
                                {selectedScanner === s.id && <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {scanners.length > 0 && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Resolution</Label>
                          <Select value={scanDpi} onValueChange={setScanDpi}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="75">75 DPI — Draft</SelectItem>
                              <SelectItem value="150">150 DPI — Fast</SelectItem>
                              <SelectItem value="300">300 DPI — Standard</SelectItem>
                              <SelectItem value="600">600 DPI — High quality</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Color Mode</Label>
                          <Select value={scanMode} onValueChange={setScanMode}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Color">Color</SelectItem>
                              <SelectItem value="Gray">Grayscale</SelectItem>
                              <SelectItem value="Lineart">Black &amp; White</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {scanError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {scanError}
                      </div>
                    )}

                    {scanners.length > 0 && (
                      <Button
                        className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white gap-2 h-11"
                        disabled={!selectedScanner || scanning}
                        onClick={handleScan}
                      >
                        {scanning ? (
                          <><Loader2 className="h-4 w-4 animate-spin" />Scanning document…</>
                        ) : (
                          <><ScanLine className="h-4 w-4" />Scan Document</>
                        )}
                      </Button>
                    )}

                    <p className="text-xs text-muted-foreground text-center">
                      Scanned pages are converted to PDF and processed identically to uploaded files
                    </p>
                  </div>
                )}

                {/* ── Dropzone (file upload) ── */}
                {inputTab === 'upload' && <div
                  {...getRootProps()}
                  className={cn(
                    'group relative flex flex-col items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl border-2 border-dashed p-6 sm:p-10 text-center transition-all duration-300 cursor-pointer',
                    isDragActive
                      ? 'border-violet-500 bg-gradient-to-br from-violet-500/10 via-blue-500/5 to-violet-500/10 scale-[1.01] shadow-lg shadow-violet-500/10'
                      : 'border-muted-foreground/20 bg-muted/20 hover:border-violet-400/60 hover:bg-violet-50/40 dark:hover:bg-violet-950/20'
                  )}
                >
                  <input {...getInputProps()} />
                  <div className={cn(
                    'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.08)_0%,transparent_70%)] opacity-0 transition-opacity duration-300',
                    isDragActive && 'opacity-100'
                  )} />

                  <div className="relative mb-5">
                    {isDragActive && (
                      <>
                        <span className="absolute inset-0 animate-ping rounded-3xl bg-violet-500/15" />
                        <span className="absolute inset-0 animate-pulse rounded-3xl bg-blue-500/10" style={{ animationDelay: '0.3s' }} />
                      </>
                    )}
                    <div className={cn(
                      'relative flex h-20 w-20 items-center justify-center rounded-3xl transition-all duration-300',
                      isDragActive
                        ? 'bg-gradient-to-br from-violet-500 to-blue-600 shadow-2xl shadow-violet-500/50 scale-110'
                        : 'bg-gradient-to-br from-violet-50 to-blue-50/50 dark:from-violet-950/30 dark:to-blue-950/20 shadow-md ring-1 ring-violet-200/60 dark:ring-violet-700/30 group-hover:shadow-lg group-hover:ring-violet-400/40 group-hover:from-violet-100 group-hover:to-blue-100/50 dark:group-hover:from-violet-950/50 dark:group-hover:to-blue-950/30'
                    )}>
                      <CloudUpload className={cn(
                        'h-9 w-9 transition-all duration-300',
                        isDragActive ? 'text-white drop-shadow-lg' : 'text-violet-500/70 dark:text-violet-400/70 group-hover:text-violet-600 group-hover:-translate-y-1'
                      )} />
                      {!isDragActive && (
                        <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-600 shadow-sm">
                          <span className="text-[9px] font-bold text-white">+</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {isDragActive ? (
                    <>
                      <p className="text-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">
                        Release to upload
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground">We'll start processing right away</p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-foreground">Drag &amp; drop invoice files here</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        or <span className="text-violet-600 dark:text-violet-400 font-semibold underline underline-offset-2 decoration-dotted">click to browse</span>
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                        {([
                          { ext: 'PDF', color: 'bg-red-500' },
                          { ext: 'TIFF', color: 'bg-blue-500' },
                          { ext: 'JPG', color: 'bg-amber-500' },
                          { ext: 'PNG', color: 'bg-emerald-500' },
                        ]).map(({ ext, color }) => (
                          <span key={ext} className="flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-mono font-bold text-muted-foreground shadow-sm">
                            <span className={cn('h-1.5 w-1.5 rounded-full', color)} />
                            {ext}
                          </span>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-muted-foreground/70">Up to 50 MB per file · Max 100 files per batch</p>
                    </>
                  )}
                </div>}

                {uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Queued files</span>
                        <span className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm shadow-violet-500/30">
                          {uploadedFiles.length}
                        </span>
                      </div>
                      {uploadedFiles.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/20"
                          onClick={() => uploadedFiles.forEach((_, i) => removeFile(0))}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Clear all
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto rounded-xl border bg-gradient-to-b from-muted/30 to-muted/10 p-2">
                      {uploadedFiles.map((f, i) => {
                        const ext = f.name.split('.').pop()?.toUpperCase() || 'FILE'
                        const sizeLabel = f.size < 1024 * 1024
                          ? `${(f.size / 1024).toFixed(1)} KB`
                          : `${(f.size / 1024 / 1024).toFixed(2)} MB`
                        const isPdf = ext === 'PDF'
                        return (
                          <div key={i} className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2.5 transition-all duration-150 hover:border-violet-300/60 hover:shadow-sm hover:bg-card">
                            <div className="w-1 self-stretch rounded-full bg-gradient-to-b from-violet-500 to-blue-500 shrink-0 opacity-70" />
                            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-blue-500/10 ring-1 ring-inset ring-violet-400/20">
                              <FileText className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
                              <span className={cn(
                                'absolute -bottom-1 -right-1 rounded px-1 py-px text-[8px] font-bold leading-none text-white shadow-sm',
                                isPdf ? 'bg-red-500' : 'bg-violet-600'
                              )}>{ext}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate leading-snug">{f.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] text-muted-foreground bg-muted/60 rounded px-1.5 py-px font-mono">{sizeLabel}</span>
                                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                  </span>
                                  Ready
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 rounded-full opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                              onClick={() => removeFile(i)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {uploadedFiles.length > 0 && (
                  <div className="flex flex-col gap-3 pt-1">
                    {/* Extraction mode selector */}
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/50 bg-gradient-to-b from-slate-50/60 to-background dark:from-slate-900/20 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-700/40">
                        <Scan className="h-3.5 w-3.5 text-slate-500" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Extraction mode</span>
                      </div>
                      <div className="grid grid-cols-3 divide-x divide-slate-200/60 dark:divide-slate-700/40">
                        {([
                          { value: 'ocr', icon: ScanLine, label: 'OCR Only', desc: 'Fast · no API key' },
                          { value: 'ai', icon: Brain, label: 'AI Only', desc: 'Best for complex docs' },
                          { value: 'combined', icon: Sparkles, label: 'OCR + AI', desc: 'Merges best fields' },
                        ] as const).map(({ value, icon: Icon, label, desc }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setExtractionMode(value)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 px-2 py-3 text-xs font-medium transition-all duration-150',
                              extractionMode === value
                                ? 'bg-gradient-to-b from-violet-50 to-violet-50/40 dark:from-violet-950/40 dark:to-violet-950/10 text-violet-700 dark:text-violet-300'
                                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                            )}
                          >
                            <div className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-lg transition-all',
                              extractionMode === value
                                ? 'bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-sm shadow-violet-500/30'
                                : 'bg-muted text-muted-foreground',
                            )}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <span className="font-semibold leading-none">{label}</span>
                            <span className={cn('text-[10px] leading-tight text-center', extractionMode === value ? 'opacity-70' : 'opacity-50')}>{desc}</span>
                            {extractionMode === value && (
                              <div className="h-0.5 w-6 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 mt-0.5" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* AI model picker — hidden when OCR-only mode */}
                    {visionModels.length > 0 && extractionMode !== 'ocr' && (
                      <div className="flex flex-col gap-2 rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-b from-violet-50/50 to-background dark:from-violet-950/15 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-200/40 dark:border-violet-800/30">
                          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {extractionMode === 'combined' ? 'AI model — combined pass' : 'AI model'}
                          </span>
                        </div>
                        <div className="px-4 pb-3 space-y-2">
                          <Select value={selectedModel} onValueChange={setSelectedModel}>
                            <SelectTrigger id="vision-model" className="h-9 bg-background border-violet-200/60 dark:border-violet-800/40 text-sm">
                              <SelectValue placeholder="Select model" />
                            </SelectTrigger>
                            <SelectContent>
                              {visionModels.filter(m => m.id !== 'tesseract').map(m => (
                                <SelectItem key={m.id} value={m.id} disabled={!m.available}>
                                  <div className="flex items-center gap-2">
                                    <span>{m.label}</span>
                                    {m.tier === 'best' && <Badge variant="secondary" className="h-4 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">BEST</Badge>}
                                    {m.tier === 'recommended' && <Badge variant="secondary" className="h-4 text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">REC</Badge>}
                                    {m.tier === 'fast' && <Badge variant="secondary" className="h-4 text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">FAST</Badge>}
                                    {m.tier === 'local' && <Badge variant="secondary" className="h-4 text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">LOCAL</Badge>}
                                    {!m.available && <Badge variant="outline" className="h-4 text-[9px]">key missing</Badge>}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedModel && (
                            <p className="text-[11px] text-muted-foreground leading-snug">
                              {visionModels.find(m => m.id === selectedModel)?.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Primary CTA */}
                    <div className="relative group/cta">
                      <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 opacity-30 blur-sm group-hover/cta:opacity-50 transition-opacity" />
                      <Button
                        className="relative w-full bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-500 hover:to-blue-500 hover:shadow-xl hover:shadow-violet-500/35 transition-all duration-200 h-12 text-[15px]"
                        size="lg"
                        onClick={startAiExtraction}
                      >
                        {extractionMode === 'ocr'
                          ? <Scan className="mr-2 h-4.5 w-4.5" />
                          : extractionMode === 'combined'
                          ? <Sparkles className="mr-2 h-4.5 w-4.5" />
                          : <Brain className="mr-2 h-4.5 w-4.5" />}
                        <span className="hidden sm:inline font-semibold">
                          {extractionMode === 'ocr' ? 'Extract with OCR' : extractionMode === 'combined' ? 'Extract with OCR + AI' : 'Extract data with AI'}
                        </span>
                        <span className="sm:hidden font-semibold">
                          {extractionMode === 'ocr' ? 'Run OCR' : extractionMode === 'combined' ? 'OCR + AI' : 'Run AI'}
                        </span>
                        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                          {uploadedFiles.length} {uploadedFiles.length !== 1 ? 'files' : 'file'}
                        </span>
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" />
                      </Button>
                    </div>

                    <Button variant="outline" className="w-full border-dashed text-muted-foreground hover:text-foreground hover:border-solid" size="lg" onClick={startManualEntry}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Manual entry
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* STEP 2: AI EXTRACTING + MANUAL PROCESSING — animated insight panel */}
          {(step === 'ai_extracting' || step === 'manual_processing') && (
            <ProcessingInsightCard
              isAi={step === 'ai_extracting'}
              claims={claims}
              uploadedFiles={uploadedFiles}
              currentExtractIndex={currentExtractIndex}
              aiExtractPct={aiExtractPct}
              ocrProgress={ocrProgress}
            />
          )}

          {/* STEP 3: REVIEW */}
          {(step === 'review' || step === 'publishing' || step === 'complete') && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                      {step === 'review' && claims.every(c => c.aiConfidence === 0) && <><ClipboardList className="h-5 w-5 text-blue-600 shrink-0" /> Enter Claim Data</>}
                      {step === 'review' && claims.some(c => c.aiConfidence > 0) && <><ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" /> Review Extracted Claims</>}
                      {step === 'publishing' && <><Loader2 className="h-5 w-5 animate-spin shrink-0" /> Publishing Claims...</>}
                      {step === 'complete' && <><CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" /> Claims Published</>}
                    </CardTitle>
                    <CardDescription>
                      {step === 'review' && claims.some(c => c.aiConfidence > 0) && `${claims.length} claim${claims.length !== 1 ? 's' : ''} extracted. Review and publish.`}
                      {step === 'review' && claims.every(c => c.aiConfidence === 0) && `Fill in details for ${claims.length} document${claims.length !== 1 ? 's' : ''}, then publish.`}
                      {step === 'publishing' && `Publishing ${publishedCount} of ${claims.length} claims...`}
                      {step === 'complete' && `${claims.length} claims successfully published.`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={exportToExcel}>
                      <Download className="mr-2 h-4 w-4" /> <span className="hidden xs:inline">Export </span>Excel
                    </Button>
                    {step === 'review' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className={draftSaved ? 'border-emerald-400 text-emerald-700 dark:text-emerald-400' : ''}
                        onClick={() => {
                          const sid = session?.sessionId
                          if (sid) saveClaims(sid, claims as any)
                          setDraftSaved(true)
                          setTimeout(() => setDraftSaved(false), 2500)
                        }}
                      >
                        {draftSaved
                          ? <><Check className="mr-2 h-4 w-4 text-emerald-600" /> Draft Saved</>
                          : <><Save className="mr-2 h-4 w-4" /> Save Draft</>}
                      </Button>
                    )}
                    {step === 'review' && (
                      <Button size="sm" onClick={publishClaims}>
                        <ClipboardList className="mr-2 h-4 w-4" /> Publish All
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {step === 'publishing' && <Progress value={publishProgress} className="h-2 mb-4" />}

                {step === 'review' && Object.keys(publishValidationErrors).length > 0 && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-destructive text-sm">
                          {Object.keys(publishValidationErrors).length} claim{Object.keys(publishValidationErrors).length !== 1 ? 's have' : ' has'} incomplete fields. Fill all required fields before publishing.
                        </p>
                        <ul className="mt-2 space-y-1">
                          {claims.filter(c => publishValidationErrors[c.id]).map(c => (
                            <li key={c.id} className="text-xs text-destructive/80">
                              <span className="font-medium">{c.claimNumber || c.fileName}:</span>{' '}
                              {publishValidationErrors[c.id].join(', ')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {step === 'complete' && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 mb-4">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium text-emerald-800 dark:text-emerald-300">All {claims.length} claims published successfully!</p>
                        <p className="text-sm text-emerald-600 dark:text-emerald-400">Claims are now visible in the Claims page for processing. Resetting for new upload in a moment…</p>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0 border-emerald-400 text-emerald-800 dark:text-emerald-300"
                        onClick={resetAll}>
                        <Upload className="mr-1 h-3 w-3" /> Upload New Batch
                      </Button>
                    </div>
                  </div>
                )}

                {(() => {
                  // Always compute live validation so missing-field markers show immediately
                  const liveErrors = validateAllClaims()

                  // Map field keys → column names for per-cell highlighting
                  const PATIENT_KEYS = new Set(['patientName', 'patientId', 'memberNumber'])
                  const INVOICE_KEYS = new Set(['invoiceNumber', 'invoiceDate', 'invoiceAmount'])
                  const DIAG_KEYS    = new Set(['diagnosis', 'treatment'])

                  const PLACEHOLDER = new Set(['', 'OCR Processing Required', 'Unknown Patient', 'Unknown Provider', 'Upload to backend for extraction', '0'])
                  const isMissing = (claim: ExtractedClaim, key: keyof ExtractedClaim) => {
                    const val = String(claim[key] ?? '').trim()
                    return !val || PLACEHOLDER.has(val) || (key === 'invoiceAmount' && Number(claim[key]) <= 0)
                  }

                  const MissingTag = ({ label }: { label: string }) => (
                    <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border border-red-300 dark:border-red-700 shadow-sm">
                      <AlertCircle className="h-2.5 w-2.5 shrink-0" />{label}
                    </span>
                  )

                  // Sort: fully indexed claims (no missing fields) first, incomplete last; within each group sort by descending AI confidence
                  const sortedClaims = [...claims].sort((a, b) => {
                    const aMissing = (liveErrors[a.id] || []).length
                    const bMissing = (liveErrors[b.id] || []).length
                    if (aMissing !== bMissing) return aMissing - bMissing
                    return b.aiConfidence - a.aiConfidence
                  })
                  const completeCount = sortedClaims.filter(c => !(liveErrors[c.id] || []).length).length
                  const incompleteCount = sortedClaims.length - completeCount

                  return (
                    <div className="space-y-2">
                      {sortedClaims.map((claim, idx) => {
                        const rowMissing = liveErrors[claim.id] || []
                        const hasError = rowMissing.length > 0
                        const patientBad = ['patientName','patientId','memberNumber'].some(k => isMissing(claim, k as keyof ExtractedClaim))
                        const invoiceBad = ['invoiceNumber','invoiceDate','invoiceAmount'].some(k => isMissing(claim, k as keyof ExtractedClaim))
                        const diagBad    = ['diagnosis','treatment'].some(k => isMissing(claim, k as keyof ExtractedClaim))
                        const conf = claim.aiConfidence
                        const confColor = conf > 0.9 ? 'bg-emerald-500' : conf > 0.8 ? 'bg-amber-500' : 'bg-red-500'
                        const confText  = conf > 0.9 ? 'text-emerald-700 dark:text-emerald-400' : conf > 0.8 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'
                        const confBg    = conf > 0.9 ? 'bg-emerald-50 dark:bg-emerald-950/30' : conf > 0.8 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-red-50 dark:bg-red-950/30'
                        const filledCount = 10 - rowMissing.length
                        const scoreColor = !hasError
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : rowMissing.length <= 3
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                            : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'

                        const pageLabel = (() => {
                          if (!claim.pageRange) return null
                          const parts = claim.pageRange.split('-').map((p: string) => parseInt(p.trim(), 10))
                          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                            const count = parts[1] - parts[0] + 1
                            return count === 1 ? `Pg ${parts[0]}` : `Pg ${parts[0]}–${parts[1]} (${count})`
                          }
                          if (!isNaN(parts[0])) return `Pg ${parts[0]}`
                          return claim.pageRange
                        })()

                        // Section headers: show before the first claim in each group
                        const prevClaim = idx > 0 ? sortedClaims[idx - 1] : null
                        const prevHadError = prevClaim ? (liveErrors[prevClaim.id] || []).length > 0 : false
                        const showCompleteHeader = !hasError && (idx === 0 || prevHadError) && completeCount > 0
                        const showIncompleteHeader = hasError && (idx === 0 || !prevHadError) && incompleteCount > 0

                        return (
                          <Fragment key={claim.id}>
                            {showCompleteHeader && (
                              <div className="flex items-center gap-3 px-1 pt-1 pb-2">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                                  <CheckCircle className="h-3 w-3" /> Verified & Complete
                                  <span className="rounded-full bg-emerald-200 dark:bg-emerald-800/70 px-1.5 text-[10px] font-bold">{completeCount}</span>
                                </span>
                                <div className="flex-1 h-px bg-emerald-100 dark:bg-emerald-900/30" />
                              </div>
                            )}
                            {showIncompleteHeader && (
                              <div className={`flex items-center gap-3 px-1 pb-2 ${completeCount > 0 ? 'mt-4 pt-4 border-t border-border/30' : 'pt-1'}`}>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-900/40 px-3 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 shrink-0">
                                  <AlertCircle className="h-3 w-3" /> Needs Attention
                                  <span className="rounded-full bg-red-200 dark:bg-red-800/70 px-1.5 text-[10px] font-bold">{incompleteCount}</span>
                                </span>
                                <div className="flex-1 h-px bg-red-100 dark:bg-red-900/30" />
                              </div>
                            )}
                            <div
                              onClick={() => setPreviewDoc(claim)}
                              className={`group relative rounded-xl cursor-pointer transition-all duration-200 overflow-hidden bg-card ${
                                hasError
                                  ? 'shadow-sm ring-1 ring-red-200/80 dark:ring-red-800/50 hover:shadow-md hover:ring-red-300 dark:hover:ring-red-700/60'
                                  : claim.status === 'published'
                                    ? 'shadow-sm ring-1 ring-emerald-200/70 dark:ring-emerald-800/40 hover:shadow-md'
                                    : 'shadow-sm ring-1 ring-border/50 hover:shadow-md hover:ring-violet-200/70 dark:hover:ring-violet-700/50'
                              }`}
                            >
                              {/* Top accent stripe */}
                              <div className={`h-[3px] w-full ${
                                hasError
                                  ? 'bg-gradient-to-r from-red-400 via-rose-500 to-red-400'
                                  : claim.status === 'published'
                                    ? 'bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400'
                                    : 'bg-gradient-to-r from-violet-400 via-indigo-500 to-violet-400'
                              }`} />

                              <div className="px-4 py-3">
                                {/* Row 1: Barcode + Status + Confidence */}
                                <div className="flex items-center justify-between gap-2 mb-2.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono text-xs font-bold text-red-600 dark:text-red-400 truncate">{claim.barcode}</span>
                                    {claim.claimNumber && (
                                      <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">{claim.claimNumber}</span>
                                    )}
                                    {claim.splitFrom && (
                                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                                        {claim.invoiceIndex}/{claim.totalInvoicesInPdf}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {/* Completeness score */}
                                    <span className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${scoreColor}`}>
                                      {filledCount}/10
                                    </span>
                                    {/* Confidence pill */}
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${confBg} ${confText}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${confColor}`} />
                                      {(conf * 100).toFixed(0)}%
                                    </span>
                                    {/* Status */}
                                    {hasError ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                                        <AlertCircle className="h-3 w-3" />{rowMissing.length} missing
                                      </span>
                                    ) : claim.status === 'published' ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                        <CheckCircle className="h-3 w-3" /> Published
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                                        <CheckCircle className="h-3 w-3" /> Ready
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Validation warnings */}
                                {claim.validationWarnings && claim.validationWarnings.length > 0 && (
                                  <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
                                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" />
                                    <p className="text-[11px] leading-snug min-w-0 flex-1">
                                      <span className="font-semibold text-amber-700 dark:text-amber-400">
                                        {claim.validationWarnings.length === 1 ? 'Warning · ' : `${claim.validationWarnings.length} warnings · `}
                                      </span>
                                      {claim.validationWarnings.map((w, wi) => (
                                        <span key={wi} className="text-amber-700 dark:text-amber-300">{w}{wi < claim.validationWarnings.length - 1 ? ' · ' : ''}</span>
                                      ))}
                                    </p>
                                  </div>
                                )}

                                {/* Data grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                  {/* Patient */}
                                  <div className={`min-w-0 rounded-lg p-2.5 ${patientBad ? 'bg-red-50/80 dark:bg-red-950/20 ring-1 ring-red-200/60 dark:ring-red-800/40' : 'bg-muted/30'}`}>
                                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Patient</p>
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <p className={`font-semibold text-xs leading-tight truncate ${isMissing(claim, 'patientName') ? 'text-red-500' : ''}`}>
                                          {claim.patientName || '—'}
                                        </p>
                                        {isMissing(claim, 'patientName') && <MissingTag label="Name" />}
                                      </div>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className={`text-[10px] text-muted-foreground truncate ${isMissing(claim, 'patientId') ? 'text-red-400' : ''}`}>
                                          {claim.patientId || '—'}
                                        </span>
                                        {isMissing(claim, 'patientId') && <MissingTag label="ID" />}
                                      </div>
                                      {isMissing(claim, 'memberNumber') && <MissingTag label="Member #" />}
                                    </div>
                                  </div>

                                  {/* Invoice */}
                                  <div className={`min-w-0 rounded-lg p-2.5 ${invoiceBad ? 'bg-red-50/80 dark:bg-red-950/20 ring-1 ring-red-200/60 dark:ring-red-800/40' : 'bg-muted/30'}`}>
                                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Invoice</p>
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className={`font-mono font-semibold text-xs truncate ${isMissing(claim, 'invoiceNumber') ? 'text-red-500' : ''}`}>
                                          {claim.invoiceNumber || '—'}
                                        </span>
                                        {isMissing(claim, 'invoiceNumber') && <MissingTag label="Invoice #" />}
                                      </div>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className={`font-semibold text-xs ${isMissing(claim, 'invoiceAmount') ? 'text-red-500' : 'text-foreground'}`}>
                                          {formatCurrency(claim.invoiceAmount)}
                                        </span>
                                        {isMissing(claim, 'invoiceAmount') && <MissingTag label="Amount" />}
                                      </div>
                                      {isMissing(claim, 'invoiceDate') && <MissingTag label="Date" />}
                                    </div>
                                  </div>

                                  {/* Diagnosis */}
                                  <div className={`min-w-0 rounded-lg p-2.5 ${diagBad ? 'bg-red-50/80 dark:bg-red-950/20 ring-1 ring-red-200/60 dark:ring-red-800/40' : 'bg-muted/30'}`}>
                                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Diagnosis</p>
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <p className={`text-xs leading-tight line-clamp-2 ${isMissing(claim, 'diagnosis') ? 'text-red-500' : ''}`}>
                                          {claim.diagnosis || '—'}
                                        </p>
                                        {isMissing(claim, 'diagnosis') && <MissingTag label="Diagnosis" />}
                                      </div>
                                      {claim.diagnosisCode && (
                                        <Badge variant="outline" className="font-mono text-[9px] px-1 h-4">{claim.diagnosisCode}</Badge>
                                      )}
                                      {isMissing(claim, 'treatment') && <MissingTag label="Treatment" />}
                                    </div>
                                  </div>

                                  {/* Document */}
                                  <div className="min-w-0 rounded-lg p-2.5 bg-muted/30">
                                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">Document</p>
                                    <div className="space-y-0.5">
                                      {claim.documentPages?.[0]?.categoryLabel && (
                                        <Badge variant="outline" className="font-mono text-[9px] px-1 h-4 max-w-full truncate">{claim.documentPages[0].categoryLabel}</Badge>
                                      )}
                                      {pageLabel && (
                                        <p className="text-[10px] text-muted-foreground">{pageLabel}</p>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Action toolbar */}
                                <div className="flex items-center gap-0.5 mt-3 pt-2.5 border-t border-border/30">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2.5 gap-1 text-muted-foreground hover:text-foreground"
                                    onClick={(e) => { e.stopPropagation(); setPreviewDoc(claim) }}
                                  >
                                    <Eye className="h-3.5 w-3.5" /> View
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2.5 gap-1 text-muted-foreground hover:text-foreground"
                                    disabled={ocrRunning.has(claim.id) || reprocessingOne.has(claim.id)}
                                    onClick={(e) => { e.stopPropagation(); rerunOcr(claim.id) }}
                                  >
                                    {ocrRunning.has(claim.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scan className="h-3.5 w-3.5" />}
                                    OCR
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2.5 gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                    disabled={reprocessingOne.has(claim.id) || ocrRunning.has(claim.id)}
                                    onClick={(e) => { e.stopPropagation(); reprocessClaim(claim.id) }}
                                  >
                                    {reprocessingOne.has(claim.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                    Reprocess
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2.5 gap-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    disabled={claim.status === 'published'}
                                    onClick={(e) => { e.stopPropagation(); setClaims(prev => prev.filter(c => c.id !== claim.id)) }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" /> Delete
                                  </Button>
                                  {step === 'review' && claim.status !== 'published' && (
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs px-3 gap-1.5 ml-auto"
                                      disabled={publishingOne.has(claim.id) || hasError}
                                      onClick={(e) => { e.stopPropagation(); publishSingleClaim(claim.id) }}
                                    >
                                      {publishingOne.has(claim.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                      Publish
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </Fragment>
                        )
                      })}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Premium sidebar ──────────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="overflow-hidden shadow-sm">
            <CardHeader className="border-b bg-gradient-to-r from-violet-50/70 to-transparent dark:from-violet-950/20">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <Receipt className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">Batch Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileText className="h-3 w-3" /> Files
                  </p>
                  <p className="mt-0.5 text-xl font-bold">{uploadedFiles.length}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-3 w-3" /> Size
                  </p>
                  <p className="mt-0.5 text-xl font-bold">{(totalSize / 1024 / 1024).toFixed(2)} <span className="text-xs font-medium text-muted-foreground">MB</span></p>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Building2 className="h-3 w-3" /> Provider
                </p>
                {provider ? (
                  <p className="mt-1 text-sm font-semibold truncate">{provider}</p>
                ) : (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400">
                    <Sparkles className="h-3 w-3" /> AI auto-detect
                  </p>
                )}
                {branch && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span className="truncate">{branch}</span>
                  </div>
                )}
              </div>

              {claims.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2.5">
                    {[
                      { icon: Brain,       label: 'AI Extracted',   value: `${extractedCount}/${claims.length}`, color: 'text-violet-600 dark:text-violet-400',    progress: (extractedCount / claims.length) * 100 },
                      { icon: ShieldCheck, label: 'AI Verified',    value: `${verifiedCount}/${claims.length}`,  color: 'text-emerald-600 dark:text-emerald-400',  progress: (verifiedCount / claims.length) * 100 },
                    ].map(row => (
                      <div key={row.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <row.icon className={cn('h-3 w-3', row.color)} /> {row.label}
                          </span>
                          <span className={cn('font-semibold', row.color)}>{row.value}</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div className={cn('h-full rounded-full transition-all', row.color.includes('violet') ? 'bg-violet-500' : 'bg-emerald-500')} style={{ width: `${row.progress}%` }} />
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-muted-foreground">Avg confidence</span>
                      <Badge variant="secondary" className={cn(
                        avgConfidence >= 0.8 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : avgConfidence >= 0.6 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'bg-red-500/15 text-red-700 dark:text-red-300',
                        'font-mono'
                      )}>
                        {(avgConfidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    {publishedCount > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
                        <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle className="h-3.5 w-3.5" /> Published
                        </span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">{publishedCount}/{claims.length}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-sm">
            <CardHeader className="border-b bg-gradient-to-r from-blue-50/70 to-transparent dark:from-blue-950/20">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <ArrowRight className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">Process Flow</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <ol className="relative space-y-4">
                {[
                  { n: 1, label: 'Upload PDF invoices',                      tone: 'violet',  done: step !== 'upload' },
                  { n: 2, label: 'AI scans & extracts data from each file',  tone: 'violet',  done: step === 'review' || step === 'publishing' || step === 'complete' },
                  { n: 3, label: 'AI generates Excel summary & verifies',    tone: 'violet',  done: step === 'review' || step === 'publishing' || step === 'complete' },
                  { n: 4, label: 'Review extracted claims, export Excel',    tone: 'amber',   done: step === 'publishing' || step === 'complete' },
                  { n: 5, label: 'Publish to Claims for processing',         tone: 'emerald', done: step === 'complete' },
                ].map((s, i, arr) => {
                  const toneClasses = {
                    violet:  'from-violet-500 to-blue-500 text-white',
                    amber:   'from-amber-500 to-orange-500 text-white',
                    emerald: 'from-emerald-500 to-teal-500 text-white',
                  }[s.tone] || 'from-muted to-muted text-muted-foreground'
                  return (
                    <li key={s.n} className="relative flex gap-3 pl-1">
                      {i < arr.length - 1 && (
                        <span className={cn(
                          'absolute left-[14px] top-8 h-full w-0.5 rounded-full',
                          s.done ? 'bg-emerald-500/60' : 'bg-border'
                        )} />
                      )}
                      <span className={cn(
                        'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold shadow-sm transition-all',
                        s.done
                          ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-emerald-500/30'
                          : `bg-gradient-to-br ${toneClasses}`
                      )}>
                        {s.done ? <CheckCircle className="h-3.5 w-3.5" /> : s.n}
                      </span>
                      <span className={cn(
                        'pt-1 text-sm leading-tight',
                        s.done ? 'text-muted-foreground line-through' : 'text-foreground'
                      )}>{s.label}</span>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Full-screen Document Preview Modal */}
      {previewDoc && (
        <DocPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onSave={(updated) => {
            setClaims(prev => prev.map(c => c.id === updated.id ? updated : c))
            setPreviewDoc(updated)
            setPublishValidationErrors(prev => {
              const next = { ...prev }
              delete next[updated.id]
              return next
            })
          }}
        />
      )}
    </div>
  )
}
