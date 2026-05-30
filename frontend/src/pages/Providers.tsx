import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'
import { OnboardingPacketReview } from '@/components/OnboardingPacketReview'
import ScanMeteringEditor from '@/components/ScanMeteringEditor'
import {
  Search, Plus, Building2, MapPin,
  MoreHorizontal, CheckCircle, Eye, Ban, RefreshCw,
  Upload, FileText, X, ChevronRight, ChevronLeft,
  Briefcase, Users, Building, Trash2, ShieldCheck, ShieldOff,
  Download, Pencil, ScanText, Save, RotateCcw, XCircle, AlertCircle,
  DollarSign, Loader2, Lock, History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Pagination } from '@/components/Pagination'
import { formatDate, getStatusColor, formatStatusLabel } from '@/lib/utils'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────

interface Provider {
  id: string
  name: string
  type: string
  licenseNumber: string
  contactPerson: string
  email: string
  phone: string
  alternatePhone?: string
  physicalAddress: string
  city?: string
  region?: string
  status: string
  isActive: boolean
  canSubmitClaims: boolean
  createdAt: string
  // company profile
  companyStructure?: string
  registrationNumber?: string
  kraPin?: string
  incorporationDate?: string
  numberOfPartners?: number
  ownerName?: string
  ownerIdNumber?: string
  proofDocumentPath?: string
  proofDocumentName?: string
  approvalStatus?: string
  approvalComment?: string | null
  rejectionReason?: string | null
}

type CompanyStructure = 'sole_proprietorship' | 'partnership' | 'registered_company' | ''

interface ProviderForm {
  // step 1 – facility
  name: string
  type: string
  licenseNumber: string
  // step 2 – company profile
  companyStructure: CompanyStructure
  registrationNumber: string
  kraPin: string
  incorporationDate: string
  numberOfPartners: string
  ownerName: string
  ownerIdNumber: string
  // step 3 – contact & location
  contactPerson: string
  email: string
  phone: string
  alternatePhone: string
  physicalAddress: string
  city: string
  region: string
}

const EMPTY_FORM: ProviderForm = {
  name: '', type: 'hospital', licenseNumber: '',
  companyStructure: '', registrationNumber: '', kraPin: '',
  incorporationDate: '', numberOfPartners: '', ownerName: '', ownerIdNumber: '',
  contactPerson: '', email: '', phone: '', alternatePhone: '',
  physicalAddress: '', city: '', region: '',
}

const DEMO_PROVIDERS: Provider[] = [
  { id: '1', name: 'Nairobi Hospital', type: 'hospital', licenseNumber: 'LIC-001', contactPerson: 'Dr. James Maina', email: 'admin@nairobihospital.co.ke', phone: '+254 20 2845000', physicalAddress: 'Argwings Kodhek Rd, Nairobi', city: 'Nairobi', region: 'Nairobi', status: 'approved', isActive: true, canSubmitClaims: true, createdAt: '2025-01-15', companyStructure: 'registered_company', registrationNumber: 'CPR/2005/0123', kraPin: 'P051234567X' },
  { id: '2', name: 'Aga Khan University Hospital', type: 'hospital', licenseNumber: 'LIC-002', contactPerson: 'Dr. Fatima Omar', email: 'admin@agakhan.org', phone: '+254 20 3662000', physicalAddress: '3rd Parklands Ave, Nairobi', city: 'Nairobi', region: 'Nairobi', status: 'approved', isActive: true, canSubmitClaims: true, createdAt: '2025-01-20', companyStructure: 'registered_company' },
  { id: '3', name: 'Mombasa Medical Centre', type: 'clinic', licenseNumber: 'LIC-003', contactPerson: 'Dr. Hassan Ali', email: 'info@mombasamedical.co.ke', phone: '+254 41 2312000', physicalAddress: 'Moi Ave, Mombasa', city: 'Mombasa', region: 'Coast', status: 'pending', isActive: false, canSubmitClaims: false, createdAt: '2026-03-10', companyStructure: 'partnership', numberOfPartners: 3 },
  { id: '4', name: 'Eldoret Pharmacy Ltd', type: 'pharmacy', licenseNumber: 'LIC-004', contactPerson: 'Mary Chebet', email: 'info@eldoretpharmacy.co.ke', phone: '+254 53 2062000', physicalAddress: 'Uganda Rd, Eldoret', city: 'Eldoret', region: 'Rift Valley', status: 'approved', isActive: true, canSubmitClaims: true, createdAt: '2025-06-01', companyStructure: 'sole_proprietorship', ownerName: 'Mary Chebet', ownerIdNumber: '12345678' },
  { id: '5', name: 'Pathcare Kenya', type: 'lab', licenseNumber: 'LIC-005', contactPerson: 'Dr. Sarah Wambui', email: 'info@pathcare.co.ke', phone: '+254 20 4441000', physicalAddress: 'Hurlingham, Nairobi', city: 'Nairobi', region: 'Nairobi', status: 'suspended', isActive: false, canSubmitClaims: false, createdAt: '2025-03-15', companyStructure: 'registered_company' },
  { id: '6', name: 'Kisumu Specialists Clinic', type: 'clinic', licenseNumber: 'LIC-006', contactPerson: 'Dr. Otieno Odhiambo', email: 'info@kisumuspecialists.co.ke', phone: '+254 57 2024000', physicalAddress: 'Oginga Odinga Rd, Kisumu', city: 'Kisumu', region: 'Nyanza', status: 'approved', isActive: true, canSubmitClaims: true, createdAt: '2025-08-20', companyStructure: 'partnership', numberOfPartners: 2 },
]

const typeColors: Record<string, string> = {
  hospital: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  clinic: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  pharmacy: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  lab: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
}

const structureLabels: Record<string, string> = {
  sole_proprietorship: 'Sole Proprietorship',
  partnership: 'Partnership',
  registered_company: 'Registered Company',
}

// ── Step indicator ─────────────────────────────────────────────────────────

const STEPS = ['Facility Info', 'Company Profile', 'Contact & Location', 'Upload Proof']

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-between mb-6">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-1 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors
              ${i < current ? 'bg-primary text-primary-foreground' : i === current ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2' : 'bg-muted text-muted-foreground'}`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-[10px] font-medium hidden sm:block ${i === current ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px flex-1 mx-2 mb-4 transition-colors ${i < current ? 'bg-primary' : 'bg-muted'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Company structure card ─────────────────────────────────────────────────

interface StructureCardProps {
  value: CompanyStructure
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
}

function StructureCard({ value: _value, selected, onSelect, icon, title, description }: StructureCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all w-full
        ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30'}`}
    >
      <div className={`rounded-md p-2 ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
        {icon}
      </div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>(DEMO_PROVIDERS)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ProviderForm>({ ...EMPTY_FORM })
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [proofDocTab, setProofDocTab] = useState<'info' | 'document' | 'packet' | 'audit' | 'edit' | 'billing'>('info')
  const [reviewReady, setReviewReady] = useState<{ ready: boolean; completed: number; total: number }>({ ready: false, completed: 0, total: 0 })
  const [actionProvider, setActionProvider] = useState<{ provider: Provider; type: 'approve' | 'decline' | 'suspend' | 'reactivate' } | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [actionSaving, setActionSaving] = useState(false)

  // Document tab: upload/replace, OCR, authenticated blob URL
  const viewDocUploadRef = useRef<HTMLInputElement>(null)
  const extraDocUploadRef = useRef<HTMLInputElement>(null)
  const [docUploading, setDocUploading] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [docBlobUrl, setDocBlobUrl] = useState<string | null>(null)
  const [docBlobLoading, setDocBlobLoading] = useState(false)
  const docBlobUrlRef = useRef<string | null>(null)
  // Extra provider documents
  const [extraDocs, setExtraDocs] = useState<{ id: string; originalName: string; mimetype: string; size: bigint; createdAt: string }[]>([])
  const [extraDocsLoading, setExtraDocsLoading] = useState(false)
  const [extraDocUploading, setExtraDocUploading] = useState(false)
  const [viewingExtraDoc, setViewingExtraDoc] = useState<{ id: string; name: string; blobUrl: string } | null>(null)
  const viewingExtraDocRef = useRef<string | null>(null)
  // Add document form
  const [showAddDocForm, setShowAddDocForm] = useState(false)
  const [addDocFile, setAddDocFile] = useState<File | null>(null)
  const [addDocName, setAddDocName] = useState('')
  const [addDocDragOver, setAddDocDragOver] = useState(false)
  const addDocInputRef = useRef<HTMLInputElement>(null)
  const [pendingProofFile, setPendingProofFile] = useState<File | null>(null)
  const [pendingProofDocName, setPendingProofDocName] = useState('')

  // Edit tab
  const [editForm, setEditForm] = useState<ProviderForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState<'approve' | 'suspend' | 'reactivate' | 'delete' | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)

  const navigate = useNavigate()
  const { logout, user } = useAuthStore()

  // Only admin and claims_officer can approve / reject / suspend / reactivate providers
  const canManageProviders = user?.role === 'admin' || user?.role === 'claims_officer'

  const handle401 = useCallback(async () => {
    await logout()
    navigate('/login')
  }, [logout, navigate])

  // Revoke previous blob URL and fetch a fresh authenticated one
  const loadDocBlob = useCallback(async (providerId: string) => {
    if (docBlobUrlRef.current) {
      URL.revokeObjectURL(docBlobUrlRef.current)
      docBlobUrlRef.current = null
      setDocBlobUrl(null)
    }
    setDocBlobLoading(true)
    try {
      const { data: rawBlob } = await api.get(`/providers/${providerId}/proof-document`, { responseType: 'blob' })
      // Sniff MIME from magic bytes so Firefox opens instead of downloads
      const header = await rawBlob.slice(0, 4).arrayBuffer()
      const bytes = new Uint8Array(header)
      let mime = rawBlob.type && rawBlob.type !== 'application/octet-stream' ? rawBlob.type
        : bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? 'application/pdf'
        : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
        : rawBlob.type || 'application/octet-stream'
      const blob = new Blob([rawBlob], { type: mime })
      const url = URL.createObjectURL(blob)
      docBlobUrlRef.current = url
      setDocBlobUrl(url)
      window.open(url, '_blank')
    } catch { toast.error('Failed to load document') }
    setDocBlobLoading(false)
  }, [handle401])

  const fetchProviders = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    try {
      const { data } = await api.get(`/providers?${params}`)
      const list = Array.isArray(data) ? data : Array.isArray(data.providers) ? data.providers : null
      if (list) setProviders(list)
    } catch { /* keep demo */ }
  }, [typeFilter, statusFilter, handle401])

  useEffect(() => {
    fetchProviders().finally(() => setLoading(false))
  }, [fetchProviders])

  const loadExtraDocs = useCallback(async (providerId: string) => {
    setExtraDocsLoading(true)
    try {
      const { data } = await api.get(`/providers/${providerId}/documents`)
      setExtraDocs(data)
    } catch { /* ignore */ }
    setExtraDocsLoading(false)
  }, [handle401])

  // Load extra docs when document tab opens
  useEffect(() => {
    if (proofDocTab === 'document' && selectedProvider?.id) {
      loadExtraDocs(selectedProvider.id)
    }
  }, [proofDocTab, selectedProvider?.id, loadExtraDocs])

  const refresh = async () => { setRefreshing(true); await fetchProviders(); setRefreshing(false) }

  const openAdd = () => { setForm({ ...EMPTY_FORM }); setProofFile(null); setStep(0); setShowAddDialog(true) }
  const closeAdd = () => { setShowAddDialog(false) }

  const setF = (patch: Partial<ProviderForm>) => setForm(f => ({ ...f, ...patch }))

  // Validate each step before advancing
  const canProceed = () => {
    if (step === 0) return form.name.trim() && form.licenseNumber.trim()
    if (step === 1) {
      if (!form.companyStructure) return false
      if (form.companyStructure === 'sole_proprietorship') return !!(form.ownerName.trim() && form.ownerIdNumber.trim())
      if (form.companyStructure === 'partnership') return !!(form.registrationNumber.trim() && Number(form.numberOfPartners) >= 2)
      if (form.companyStructure === 'registered_company') return !!(form.registrationNumber.trim() && form.kraPin.trim())
    }
    if (step === 2) return form.contactPerson.trim() && form.email.trim() && form.phone.trim() && form.physicalAddress.trim()
    return true
  }

  const handleAdd = async () => {
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, String(v)) })
      if (proofFile) fd.append('proofDocument', proofFile)

      const { data: created } = await api.post('/providers', fd)
      setProviders(prev => [created, ...prev])
      closeAdd()
      return
    } catch { /* ignore network errors */ }

    // optimistic fallback for demo/offline
    const fake: Provider = {
      id: 'demo-' + Date.now(),
      ...form,
      numberOfPartners: form.numberOfPartners ? Number(form.numberOfPartners) : undefined,
      status: 'pending',
      isActive: false,
      canSubmitClaims: false,
      createdAt: new Date().toISOString(),
      proofDocumentName: proofFile?.name,
    }
    setProviders(prev => [fake, ...prev])
    closeAdd()
    setSaving(false)
  }

  const handleAction = async () => {
    if (!actionProvider) return
    setActionSaving(true)
    const { provider, type } = actionProvider
    const endpoint = type === 'approve' ? 'approve' : type === 'decline' ? 'reject' : type === 'suspend' ? 'suspend' : 'reactivate'
    try {
      const { data: updated } = await api.post(`/providers/${provider.id}/${endpoint}`, { reason: actionNote, notes: actionNote })
      const newStatus = type === 'approve' ? 'approved' : type === 'decline' ? 'rejected' : type === 'suspend' ? 'suspended' : 'approved'
      setProviders(prev => prev.map(p => p.id === provider.id
        ? { ...p, ...(updated ?? {}), status: newStatus, isActive: newStatus === 'approved' } : p))
    } catch (err: any) {
      const errData = err?.response?.data
      const msg = typeof errData?.message === 'string' ? errData.message : (errData?.message?.message ?? `Failed to ${type} provider`)
      const missing: string[] = Array.isArray(errData?.message?.missing) ? errData.message.missing : []
      if (missing.length > 0) {
        toast.error(`${msg}. Missing: ${missing.map((m: string) => m.replace(/^[a-f]_/, '')).join(', ')}`, { duration: 7000 })
      } else {
        toast.error(msg)
      }
      setActionSaving(false)
      return  // keep the dialog open so the admin can see the packet
    }
    setActionSaving(false); setActionProvider(null); setActionNote('')
  }

  const openViewDialog = (provider: Provider) => {
    setSelectedProvider(provider)
    setProofDocTab('info')
    setOcrText(null)
    setDocBlobUrl(null)
    setReviewReady({ ready: false, completed: 0, total: 0 })
  }

  const closeViewDialog = () => {
    if (docBlobUrlRef.current) {
      URL.revokeObjectURL(docBlobUrlRef.current)
      docBlobUrlRef.current = null
    }
    if (viewingExtraDocRef.current) {
      URL.revokeObjectURL(viewingExtraDocRef.current)
      viewingExtraDocRef.current = null
    }
    setDocBlobUrl(null)
    setSelectedProvider(null)
    setProofDocTab('info')
    setOcrText(null)
    setEditForm(null)
    setExtraDocs([])
    setViewingExtraDoc(null)
    setShowAddDocForm(false)
    setAddDocFile(null)
    setAddDocName('')
  }

  const handleExtraDocUpload = async (file: File, customName?: string) => {
    if (!selectedProvider) return
    setExtraDocUploading(true)
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : ''
    const uploadFile = customName?.trim()
      ? new File([file], customName.trim() + ext, { type: file.type })
      : file
    const fd = new FormData()
    fd.append('file', uploadFile)
    try {
      await api.post(`/providers/${selectedProvider.id}/documents`, fd)
      await loadExtraDocs(selectedProvider.id)
    } catch { /* ignore */ }
    setExtraDocUploading(false)
    setShowAddDocForm(false)
    setAddDocFile(null)
    setAddDocName('')
  }

  const handleExtraDocDelete = async (docId: string) => {
    if (!selectedProvider) return
    try {
      await api.delete(`/providers/${selectedProvider.id}/documents/${docId}`)
      setExtraDocs(d => d.filter(x => x.id !== docId))
      if (viewingExtraDoc?.id === docId) {
        if (viewingExtraDocRef.current) { URL.revokeObjectURL(viewingExtraDocRef.current); viewingExtraDocRef.current = null }
        setViewingExtraDoc(null)
      }
    } catch { /* ignore */ }
  }

  const handleViewExtraDoc = async (doc: { id: string; originalName: string }) => {
    if (viewingExtraDocRef.current) { URL.revokeObjectURL(viewingExtraDocRef.current); viewingExtraDocRef.current = null }
    setViewingExtraDoc(null)
    if (!selectedProvider) return
    try {
      const { data: blob } = await api.get(`/providers/${selectedProvider.id}/documents/${doc.id}/file`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      viewingExtraDocRef.current = url
      setViewingExtraDoc({ id: doc.id, name: doc.originalName, blobUrl: url })
      window.open(url, '_blank')
    } catch { toast.error('Failed to load document') }
  }

  const openEditTab = (provider: Provider) => {
    setEditForm({
      name: provider.name,
      type: provider.type,
      licenseNumber: provider.licenseNumber,
      companyStructure: (provider.companyStructure as CompanyStructure) || '',
      registrationNumber: provider.registrationNumber || '',
      kraPin: provider.kraPin || '',
      incorporationDate: provider.incorporationDate ? provider.incorporationDate.slice(0, 10) : '',
      numberOfPartners: provider.numberOfPartners ? String(provider.numberOfPartners) : '',
      ownerName: provider.ownerName || '',
      ownerIdNumber: provider.ownerIdNumber || '',
      contactPerson: provider.contactPerson,
      email: provider.email,
      phone: provider.phone,
      alternatePhone: provider.alternatePhone || '',
      physicalAddress: provider.physicalAddress,
      city: provider.city || '',
      region: provider.region || '',
    })
    setProofDocTab('edit')
  }

  const setEF = (patch: Partial<ProviderForm>) => setEditForm(f => f ? { ...f, ...patch } : f)

  const handleEditSave = async () => {
    if (!selectedProvider || !editForm) return
    setEditSaving(true)
    const patched: Provider = {
      ...selectedProvider,
      ...editForm,
      numberOfPartners: editForm.numberOfPartners ? Number(editForm.numberOfPartners) : undefined,
    }
    try {
      const fd = new FormData()
      Object.entries(editForm).forEach(([k, v]) => { if (v) fd.append(k, String(v)) })
      const { data: updated } = await api.patch(`/providers/${selectedProvider.id}`, fd)
      Object.assign(patched, updated)
    } catch { /* optimistic */ }
    setProviders(prev => prev.map(p => p.id === patched.id ? patched : p))
    setSelectedProvider(patched)
    setEditSaving(false)
    setProofDocTab('info')
  }

  const handleDocReplace = async (file: File, customName?: string) => {
    if (!selectedProvider) return
    setDocUploading(true)
    setOcrText(null)
    const uploadFile = customName && customName.trim()
      ? new File([file], customName.trim(), { type: file.type })
      : file
    const optimistic = { ...selectedProvider, proofDocumentName: uploadFile.name }
    try {
      const fd = new FormData()
      fd.append('proofDocument', uploadFile)
      const { data: updated } = await api.patch(`/providers/${selectedProvider.id}`, fd)
      const next = { ...selectedProvider, proofDocumentName: updated.proofDocumentName || uploadFile.name }
      setProviders(prev => prev.map(p => p.id === next.id ? next : p))
      setSelectedProvider(next)
      setDocUploading(false)
      setOcrText(null)
      await loadDocBlob(next.id)
      return
    } catch (e: any) {
      // Upload failed — surface the error so the admin sees what's wrong
      // instead of silently leaving a broken optimistic state.
      toast.error(e?.response?.data?.message || 'Document upload failed')
      setDocUploading(false)
    }
    await loadDocBlob(optimistic.id)
  }

  const handleDeleteProofDoc = async () => {
    if (!selectedProvider) return
    try {
      await api.delete(`/providers/${selectedProvider.id}/proof-document`)
      if (docBlobUrlRef.current) { URL.revokeObjectURL(docBlobUrlRef.current); docBlobUrlRef.current = null }
      setDocBlobUrl(null)
      setOcrText(null)
      const updated = { ...selectedProvider, proofDocumentName: null as any }
      setProviders(prev => prev.map(p => p.id === updated.id ? updated : p))
      setSelectedProvider(updated)
    } catch { /* ignore */ }
  }

  const runOcr = async () => {
    if (!selectedProvider?.proofDocumentName) return
    setOcrLoading(true)
    setOcrText(null)
    try {
      // Reuse the already-loaded authenticated blob if available
      let blob: Blob | null = null
      if (docBlobUrl) {
        const res = await fetch(docBlobUrl)
        blob = await res.blob()
      } else {
        try {
          const { data } = await api.get(`/providers/${selectedProvider.id}/proof-document`, { responseType: 'blob' })
          blob = data
        } catch { setOcrText('Could not load document for OCR.'); setOcrLoading(false); return }
      }
      if (!blob) { setOcrText('Could not load document for OCR.'); setOcrLoading(false); return }
      const isPdf = selectedProvider.proofDocumentName.toLowerCase().endsWith('.pdf')
      if (isPdf) {
        const arrayBuffer = await blob.arrayBuffer()
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        let full = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const tc = await page.getTextContent()
          const text = tc.items.map((it: any) => it.str).join(' ').replace(/\s+/g, ' ').trim()
          full += `── Page ${i} ──\n${text}\n\n`
        }
        setOcrText(full.trim() || 'No readable text found in this PDF.')
      } else {
        setOcrText('Image OCR requires server-side processing. Switch to PDF format for instant text extraction.')
      }
    } catch {
      setOcrText('Text extraction failed. Please try again.')
    }
    setOcrLoading(false)
  }

  const pageProviders = () => filtered.slice((page - 1) * pageSize, page * pageSize)

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const ids = pageProviders().map(p => p.id)
    const allSelected = ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkAction = async () => {
    if (!bulkConfirm) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)

    if (bulkConfirm === 'delete') {
      await Promise.allSettled(ids.map(id => api.delete(`/providers/${id}`)))
      setProviders(prev => prev.filter(p => !selectedIds.has(p.id)))
    } else {
      const endpoint = bulkConfirm === 'approve' ? 'approve' : bulkConfirm === 'suspend' ? 'suspend' : 'reactivate'
      await Promise.allSettled(ids.map(id =>
        api.post(`/providers/${id}/${endpoint}`, { reason: `Bulk ${bulkConfirm}` })
      ))
      const newStatus = bulkConfirm === 'approve' ? 'approved' : bulkConfirm === 'suspend' ? 'suspended' : 'approved'
      setProviders(prev => prev.map(p =>
        selectedIds.has(p.id) ? { ...p, status: newStatus, isActive: newStatus === 'approved' } : p
      ))
    }

    setBulkSaving(false)
    setBulkConfirm(null)
    clearSelection()
  }

  const filtered = providers.filter(p => {
    const q = search.toLowerCase()
    return (
      (!q || p.name.toLowerCase().includes(q) || p.contactPerson.toLowerCase().includes(q) || p.licenseNumber.toLowerCase().includes(q))
      && (typeFilter === 'all' || p.type === typeFilter)
      && (statusFilter === 'all' || p.status === statusFilter)
    )
  })

  const stats = {
    total: providers.length,
    active: providers.filter(p => p.status === 'approved').length,
    pending: providers.filter(p => p.status === 'pending').length,
    suspended: providers.filter(p => p.status === 'suspended').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
          <p className="text-muted-foreground">Manage healthcare provider registrations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add Provider
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'Active', value: stats.active, color: 'text-emerald-600' },
          { label: 'Pending', value: stats.pending, color: 'text-amber-600' },
          { label: 'Suspended', value: stats.suspended, color: 'text-red-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{loading ? '…' : s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search providers..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1) }}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="hospital">Hospital</SelectItem>
                  <SelectItem value="clinic">Clinic</SelectItem>
                  <SelectItem value="pharmacy">Pharmacy</SelectItem>
                  <SelectItem value="lab">Lab</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-2.5">
              <span className="text-sm font-medium mr-2">{selectedIds.size} selected</span>
              {canManageProviders && (<>
                <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-600/40 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                  onClick={() => setBulkConfirm('approve')}>
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="text-amber-600 border-amber-600/40 hover:bg-amber-50 dark:hover:bg-amber-950"
                  onClick={() => setBulkConfirm('suspend')}>
                  <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Suspend
                </Button>
                <Button size="sm" variant="outline" className="text-blue-600 border-blue-600/40 hover:bg-blue-50 dark:hover:bg-blue-950"
                  onClick={() => setBulkConfirm('reactivate')}>
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> Reactivate
                </Button>
                <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/5"
                  onClick={() => setBulkConfirm('delete')}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                </Button>
              </>)}
              <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={clearSelection}>
                <X className="mr-1 h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={pageProviders().length > 0 && pageProviders().every(p => selectedIds.has(p.id))}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Structure</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageProviders().map((provider) => (
                <TableRow key={provider.id} data-selected={selectedIds.has(provider.id) ? 'true' : undefined}
                  className={selectedIds.has(provider.id) ? 'bg-muted/40' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(provider.id)}
                      onCheckedChange={() => toggleSelect(provider.id)}
                      aria-label={`Select ${provider.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${typeColors[provider.type] || 'bg-gray-100 text-gray-700'}`}>
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium">{provider.name}</p>
                        <p className="text-xs text-muted-foreground">{provider.licenseNumber}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">{provider.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p>{provider.contactPerson}</p>
                      <p className="text-xs text-muted-foreground">{provider.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      {[provider.city, provider.region].filter(Boolean).join(', ') || provider.physicalAddress}
                    </div>
                  </TableCell>
                  <TableCell>
                    {provider.companyStructure ? (
                      <span className="text-xs text-muted-foreground">{structureLabels[provider.companyStructure] ?? provider.companyStructure}</span>
                    ) : <span className="text-xs text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(provider.status)} variant="secondary">
                      {formatStatusLabel(provider.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(provider.createdAt)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openViewDialog(provider)}>
                          <Eye className="mr-2 h-4 w-4" /> View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { openViewDialog(provider); openEditTab(provider) }}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        {canManageProviders && (<>
                          <DropdownMenuSeparator />
                          {provider.status === 'pending' && (<>
                            <DropdownMenuItem className="text-emerald-600"
                              onClick={() => { setActionProvider({ provider, type: 'approve' }); setActionNote('') }}>
                              <CheckCircle className="mr-2 h-4 w-4" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive"
                              onClick={() => { setActionProvider({ provider, type: 'decline' }); setActionNote('') }}>
                              <XCircle className="mr-2 h-4 w-4" /> Decline
                            </DropdownMenuItem>
                          </>)}
                          {provider.status === 'approved' && (
                            <DropdownMenuItem className="text-destructive"
                              onClick={() => { setActionProvider({ provider, type: 'suspend' }); setActionNote('') }}>
                              <Ban className="mr-2 h-4 w-4" /> Suspend
                            </DropdownMenuItem>
                          )}
                          {provider.status === 'suspended' && (
                            <DropdownMenuItem className="text-emerald-600"
                              onClick={() => { setActionProvider({ provider, type: 'reactivate' }); setActionNote('') }}>
                              <CheckCircle className="mr-2 h-4 w-4" /> Reactivate
                            </DropdownMenuItem>
                          )}
                        </>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No providers found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </CardContent>
      </Card>

      {/* ── View / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!selectedProvider} onOpenChange={closeViewDialog}>
        <DialogContent className="max-w-[1140px] p-0 gap-0 overflow-hidden h-[90vh] flex flex-col">
          <DialogTitle className="sr-only">{selectedProvider?.name}</DialogTitle>

          {selectedProvider && (
            <>
              {/* Header */}
              <div className="flex items-start gap-4 px-6 py-4 border-b bg-gradient-to-r from-muted/60 to-background shrink-0">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 text-xl font-black ${
                  selectedProvider.type === 'hospital' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                  selectedProvider.type === 'clinic' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                  'bg-violet-500/10 text-violet-500 border border-violet-500/20'
                }`}>
                  {selectedProvider.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold leading-tight">{selectedProvider.name}</h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedProvider.licenseNumber}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      selectedProvider.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                      selectedProvider.status === 'suspended' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                      selectedProvider.status === 'returned_for_correction' ? 'bg-orange-500/10 text-orange-600 border-orange-500/30' :
                      'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    }`}>{formatStatusLabel(selectedProvider.status)}</span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted border text-muted-foreground capitalize">{selectedProvider.type}</span>
                    {selectedProvider.canSubmitClaims && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        <CheckCircle className="h-2.5 w-2.5" />Claims enabled
                      </span>
                    )}
                    {selectedProvider.companyStructure && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted border text-muted-foreground">
                        {structureLabels[selectedProvider.companyStructure]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <p className="text-[10px] text-muted-foreground">Registered {formatDate(selectedProvider.createdAt)}</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => openEditTab(selectedProvider)}>
                    <Pencil className="h-3 w-3" />Edit
                  </Button>
                </div>
              </div>

              {/* PR4 — overall provider decision bar (Approve / Decline /
                  Return for correction). Visible only for non-terminal
                  providers so a finalised record doesn't grow new buttons. */}
              {(user?.role === 'admin' || user?.role === 'claims_officer') && selectedProvider.status !== 'approved' && (
                <ProviderDecisionBar
                  provider={selectedProvider}
                  reviewReady={reviewReady.ready}
                  reviewCompleted={reviewReady.completed}
                  reviewTotal={reviewReady.total}
                  onDone={(next) => {
                    setSelectedProvider(next)
                    fetchProviders().catch(() => undefined)
                  }}
                />
              )}

              {/* Tab bar */}
              <div className="flex border-b shrink-0 bg-background px-6 gap-1">
                {([
                  { key: 'info', label: 'Provider Details', icon: null },
                  { key: 'document', label: 'Registration Document', icon: <FileText className="h-3 w-3" /> },
                  { key: 'packet', label: 'Onboarding Packet', icon: <FileText className="h-3 w-3" /> },
                  { key: 'audit', label: 'Audit Trail', icon: <History className="h-3 w-3" /> },
                  { key: 'edit', label: 'Edit', icon: <Pencil className="h-3 w-3" /> },
                  { key: 'billing', label: 'Scan Billing', icon: <DollarSign className="h-3 w-3" /> },
                ] as { key: 'info' | 'document' | 'packet' | 'audit' | 'edit' | 'billing'; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
                  <button key={key} onClick={() => { setProofDocTab(key); if (key === 'edit') openEditTab(selectedProvider) }}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                      proofDocTab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}>
                    {icon}{label}
                    {key === 'document' && !selectedProvider.proofDocumentName && (
                      <span className="text-[9px] text-muted-foreground/50 ml-0.5">(none)</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className={proofDocTab === 'packet' ? 'flex-1 flex flex-col min-h-0' : 'flex-1 overflow-y-auto'}>

                {/* ─ Info tab ─ */}
                {proofDocTab === 'info' && (
                  <div className="p-6 space-y-6 text-sm">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-1 rounded-xl border bg-card overflow-hidden">
                        <div className="px-4 py-2.5 border-b bg-blue-500/5 flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-blue-500 opacity-70" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Facility</span>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          {[
                            ['Type', selectedProvider.type],
                            ['License No.', selectedProvider.licenseNumber],
                            ['Structure', selectedProvider.companyStructure ? structureLabels[selectedProvider.companyStructure] : null],
                          ].filter(([, v]) => v).map(([k, v]) => (
                            <div key={k as string}>
                              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">{k}</p>
                              <p className="text-xs font-semibold capitalize">{v}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-2 rounded-xl border bg-card overflow-hidden">
                        <div className="px-4 py-2.5 border-b bg-emerald-500/5 flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-emerald-500 opacity-70" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contact & Location</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                          {[
                            ['Contact Person', selectedProvider.contactPerson],
                            ['Email', selectedProvider.email],
                            ['Phone', selectedProvider.phone],
                            selectedProvider.alternatePhone ? ['Alt. Phone', selectedProvider.alternatePhone] : null,
                            ['Address', selectedProvider.physicalAddress],
                            selectedProvider.city ? ['City', selectedProvider.city] : null,
                            selectedProvider.region ? ['Region', selectedProvider.region] : null,
                          ].filter((x): x is [string, string] => Array.isArray(x)).map(([k, v]) => (
                            <div key={k}>
                              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">{k}</p>
                              <p className="text-xs font-semibold break-all">{v}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {selectedProvider.companyStructure && (
                      <div className="rounded-xl border bg-card overflow-hidden">
                        <div className="px-4 py-2.5 border-b bg-violet-500/5 flex items-center gap-2">
                          <Briefcase className="h-3.5 w-3.5 text-violet-500 opacity-70" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Company Profile</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                          {selectedProvider.companyStructure === 'sole_proprietorship' && (<>
                            {selectedProvider.ownerName && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">Owner Name</p><p className="text-xs font-semibold">{selectedProvider.ownerName}</p></div>}
                            {selectedProvider.ownerIdNumber && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">National ID / Passport</p><p className="text-xs font-semibold font-mono">{selectedProvider.ownerIdNumber}</p></div>}
                          </>)}
                          {selectedProvider.companyStructure === 'partnership' && (<>
                            {selectedProvider.registrationNumber && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">Partnership Reg. No.</p><p className="text-xs font-semibold font-mono">{selectedProvider.registrationNumber}</p></div>}
                            {selectedProvider.numberOfPartners && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">No. of Partners</p><p className="text-xs font-semibold">{selectedProvider.numberOfPartners}</p></div>}
                            {selectedProvider.kraPin && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">KRA PIN</p><p className="text-xs font-semibold font-mono">{selectedProvider.kraPin}</p></div>}
                          </>)}
                          {selectedProvider.companyStructure === 'registered_company' && (<>
                            {selectedProvider.registrationNumber && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">Company Reg. No.</p><p className="text-xs font-semibold font-mono">{selectedProvider.registrationNumber}</p></div>}
                            {selectedProvider.kraPin && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">KRA PIN</p><p className="text-xs font-semibold font-mono">{selectedProvider.kraPin}</p></div>}
                            {selectedProvider.incorporationDate && <div><p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-0.5">Incorporation Date</p><p className="text-xs font-semibold">{formatDate(selectedProvider.incorporationDate)}</p></div>}
                          </>)}
                          {selectedProvider.proofDocumentName && (
                            <div className="col-span-full">
                              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">Proof Document</p>
                              <button onClick={() => setProofDocTab('document')}
                                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                                <FileText className="h-3.5 w-3.5" />{selectedProvider.proofDocumentName}
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ─ Document tab ─ */}
                {proofDocTab === 'document' && (
                  <div className="flex flex-col h-full overflow-y-auto">
                    {/* Hidden file inputs */}
                    <input ref={viewDocUploadRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingProofFile(f); setPendingProofDocName(f.name.replace(/\.[^.]+$/, '')) } e.target.value = '' }} />
                    <input ref={addDocInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setAddDocFile(f); setAddDocName(f.name.replace(/\.[^.]+$/, '')) } e.target.value = '' }} />

                    <div className="p-5 space-y-4">

                      {/* ── Registration Document card ── */}
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Registration Document</h3>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={docUploading}
                            onClick={() => viewDocUploadRef.current?.click()}>
                            {docUploading ? <><RotateCcw className="h-3 w-3 animate-spin" />Uploading…</>
                              : <><Upload className="h-3 w-3" />{selectedProvider.proofDocumentName ? 'Replace' : 'Upload'}</>}
                          </Button>
                        </div>

                        {/* Pending rename bar */}
                        {pendingProofFile && (
                          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                            <FileText className="h-4 w-4 text-amber-500 shrink-0" />
                            <input
                              className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/50"
                              placeholder="Document name…"
                              value={pendingProofDocName}
                              onChange={e => setPendingProofDocName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && pendingProofDocName.trim()) { handleDocReplace(pendingProofFile, pendingProofDocName); setPendingProofFile(null) } if (e.key === 'Escape') setPendingProofFile(null) }}
                              autoFocus
                            />
                            <Button size="sm" className="h-6 text-[11px] px-2.5" disabled={docUploading || !pendingProofDocName.trim()}
                              onClick={() => { handleDocReplace(pendingProofFile, pendingProofDocName); setPendingProofFile(null) }}>Upload</Button>
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setPendingProofFile(null)}><X className="h-3.5 w-3.5" /></button>
                          </div>
                        )}

                        {selectedProvider.proofDocumentName ? (
                          <div className="rounded-xl border bg-card overflow-hidden">
                            {/* File info row */}
                            <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/10">
                              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <FileText className="h-4.5 w-4.5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate">{selectedProvider.proofDocumentName}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Registration / Proof of incorporation</p>
                              </div>
                            </div>
                            {/* Action row */}
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/5 flex-wrap">
                              <button disabled={docBlobLoading} onClick={() => loadDocBlob(selectedProvider.id)}
                                className="inline-flex items-center gap-1.5 h-7 rounded-lg px-3 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                                {docBlobLoading ? <><RotateCcw className="h-3 w-3 animate-spin" />Loading…</> : <><Eye className="h-3 w-3" />View</>}
                              </button>
                              <button disabled={docBlobLoading}
                                onClick={async () => {
                                  setDocBlobLoading(true)
                                  try {
                                    const { data: blob } = await api.get(`/providers/${selectedProvider.id}/proof-document`, { responseType: 'blob' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = selectedProvider.proofDocumentName!
                                    a.click()
                                    setTimeout(() => URL.revokeObjectURL(url), 5000)
                                  } catch { toast.error('Failed to download document') }
                                  setDocBlobLoading(false)
                                }}
                                className="inline-flex items-center gap-1.5 h-7 rounded-lg px-3 text-xs font-medium border bg-background hover:bg-muted transition-colors disabled:opacity-50">
                                <Download className="h-3 w-3" />Download
                              </button>
                              <button disabled={ocrLoading || docBlobLoading || !docBlobUrl} onClick={runOcr}
                                className="inline-flex items-center gap-1.5 h-7 rounded-lg px-3 text-xs font-medium border border-violet-500/40 text-violet-600 bg-background hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors disabled:opacity-50">
                                {ocrLoading ? <><RotateCcw className="h-3 w-3 animate-spin" />Extracting…</> : <><ScanText className="h-3 w-3" />Extract Text</>}
                              </button>
                              <button onClick={handleDeleteProofDoc}
                                className="inline-flex items-center gap-1.5 h-7 rounded-lg px-3 text-xs font-medium border border-destructive/30 text-destructive bg-background hover:bg-destructive/10 transition-colors ml-auto">
                                <Trash2 className="h-3 w-3" />Delete
                              </button>
                            </div>
                            {/* Inline preview */}
                            {(docBlobLoading || docBlobUrl) && (
                              <div className="border-t" style={{ height: 320 }}>
                                {docBlobLoading ? (
                                  <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
                                    <RotateCcw className="h-4 w-4 animate-spin" />Loading…
                                  </div>
                                ) : docBlobUrl && selectedProvider.proofDocumentName.toLowerCase().match(/\.(jpg|jpeg|png|tif|tiff)$/) ? (
                                  <img src={docBlobUrl} alt="document" className="w-full h-full object-contain p-3" />
                                ) : docBlobUrl ? (
                                  <embed src={docBlobUrl} className="w-full h-full border-0" />
                                ) : null}
                              </div>
                            )}
                            {/* OCR panel */}
                            {ocrText && (
                              <div className="border-t">
                                <div className="flex items-center justify-between px-4 py-2 bg-violet-500/5 border-b">
                                  <div className="flex items-center gap-2">
                                    <ScanText className="h-3.5 w-3.5 text-violet-600" />
                                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">Extracted Text</span>
                                  </div>
                                  <button onClick={() => setOcrText(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                                </div>
                                <pre className="max-h-40 overflow-y-auto p-4 text-[11px] font-mono whitespace-pre-wrap text-foreground/80 bg-muted/20">{ocrText}</pre>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 py-8 text-center bg-muted/5">
                            <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                              <FileText className="h-6 w-6 text-muted-foreground/40" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-muted-foreground">No document uploaded</p>
                              <p className="text-xs text-muted-foreground/60 mt-1">Upload a PDF or image of the registration certificate</p>
                            </div>
                            <Button size="sm" onClick={() => viewDocUploadRef.current?.click()} disabled={docUploading}>
                              <Upload className="mr-1.5 h-3.5 w-3.5" />{docUploading ? 'Uploading…' : 'Upload Document'}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* ── Additional Documents ── */}
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Additional Documents</h3>
                          {!showAddDocForm && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setShowAddDocForm(true)}>
                              <Upload className="h-3 w-3" />Add Document
                            </Button>
                          )}
                        </div>

                        {/* Upload form */}
                        {showAddDocForm && (
                          <div className="mb-3 rounded-xl border bg-card p-4 space-y-3">
                            {/* Drop zone */}
                            <div
                              className={`flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed transition-all cursor-pointer py-6 px-4
                                ${addDocDragOver ? 'border-primary bg-primary/5 scale-[1.01]'
                                  : addDocFile ? 'border-primary/50 bg-primary/5'
                                  : 'border-border hover:border-primary/40 hover:bg-muted/20'}`}
                              onClick={() => addDocInputRef.current?.click()}
                              onDragOver={e => { e.preventDefault(); setAddDocDragOver(true) }}
                              onDragLeave={() => setAddDocDragOver(false)}
                              onDrop={e => { e.preventDefault(); setAddDocDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) { setAddDocFile(f); setAddDocName(f.name.replace(/\.[^.]+$/, '')) } }}
                            >
                              {addDocFile ? (
                                <>
                                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                    <FileText className="h-5 w-5 text-primary" />
                                  </div>
                                  <div className="text-center">
                                    <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">{addDocFile.name}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{(addDocFile.size / 1024).toFixed(0)} KB · click to change</p>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                                    <Upload className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                  <div className="text-center">
                                    <p className="text-xs font-semibold">Drop file here or <span className="text-primary">browse</span></p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">PDF, JPG, PNG, TIFF · max 10 MB</p>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Document Name</label>
                              <Input value={addDocName} onChange={e => setAddDocName(e.target.value)}
                                placeholder="e.g. KRA Certificate, Business Permit…" className="h-8 text-xs" />
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1 h-8 text-xs gap-1.5"
                                disabled={!addDocFile || extraDocUploading}
                                onClick={() => addDocFile && handleExtraDocUpload(addDocFile, addDocName)}>
                                {extraDocUploading ? <><RotateCcw className="h-3 w-3 animate-spin" />Uploading…</> : <><Upload className="h-3 w-3" />Upload</>}
                              </Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={extraDocUploading}
                                onClick={() => { setShowAddDocForm(false); setAddDocFile(null); setAddDocName('') }}>Cancel</Button>
                            </div>
                          </div>
                        )}

                        {/* Document grid */}
                        {extraDocsLoading ? (
                          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                            <RotateCcw className="h-3.5 w-3.5 animate-spin" />Loading documents…
                          </div>
                        ) : extraDocs.length === 0 && !showAddDocForm ? (
                          <div className="rounded-xl border-2 border-dashed border-border py-6 text-center">
                            <p className="text-xs text-muted-foreground/60">No additional documents yet</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {extraDocs.map(doc => (
                              <div key={doc.id} className="rounded-xl border bg-card overflow-hidden">
                                <div className="flex items-center gap-3 px-4 py-3">
                                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold truncate">{doc.originalName}</p>
                                    <p className="text-[10px] text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => handleViewExtraDoc(doc)}
                                      className="inline-flex items-center gap-1 h-6 rounded-md px-2 text-[11px] font-medium border bg-background hover:bg-muted transition-colors">
                                      <Eye className="h-3 w-3" />View
                                    </button>
                                    <button onClick={() => handleExtraDocDelete(doc.id)}
                                      className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-destructive/30 text-destructive bg-background hover:bg-destructive/10 transition-colors">
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                                {/* Inline viewer */}
                                {viewingExtraDoc?.id === doc.id && (
                                  <div className="border-t">
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b">
                                      <span className="text-[11px] text-muted-foreground">Preview</span>
                                      <button onClick={() => { if (viewingExtraDocRef.current) { URL.revokeObjectURL(viewingExtraDocRef.current); viewingExtraDocRef.current = null } setViewingExtraDoc(null) }}>
                                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                      </button>
                                    </div>
                                    {viewingExtraDoc.name.toLowerCase().match(/\.(jpg|jpeg|png|tif|tiff)$/) ? (
                                      <img src={viewingExtraDoc.blobUrl} alt={viewingExtraDoc.name} className="w-full max-h-72 object-contain p-3" />
                                    ) : (
                                      <iframe src={viewingExtraDoc.blobUrl} className="w-full h-72 border-0" title={viewingExtraDoc.name} />
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ─ Edit tab ─ */}
                {proofDocTab === 'edit' && editForm && (
                  <div className="p-6 space-y-6 text-sm">
                    {/* Facility */}
                    <div className="rounded-xl border bg-card overflow-hidden">
                      <div className="px-4 py-2.5 border-b bg-blue-500/5 flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-blue-500 opacity-70" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Facility Info</span>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-1.5">
                          <Label className="text-xs">Provider / Facility Name <span className="text-destructive">*</span></Label>
                          <Input value={editForm.name} onChange={e => setEF({ name: e.target.value })} placeholder="Facility name" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Facility Type</Label>
                          <Select value={editForm.type} onValueChange={v => setEF({ type: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hospital">Hospital</SelectItem>
                              <SelectItem value="clinic">Clinic</SelectItem>
                              <SelectItem value="pharmacy">Pharmacy</SelectItem>
                              <SelectItem value="lab">Laboratory</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">License / Facility Number <span className="text-destructive">*</span></Label>
                          <Input value={editForm.licenseNumber} onChange={e => setEF({ licenseNumber: e.target.value })} placeholder="LIC-001" />
                        </div>
                      </div>
                    </div>

                    {/* Contact & Location */}
                    <div className="rounded-xl border bg-card overflow-hidden">
                      <div className="px-4 py-2.5 border-b bg-emerald-500/5 flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-emerald-500 opacity-70" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Contact & Location</span>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Contact Person <span className="text-destructive">*</span></Label>
                          <Input value={editForm.contactPerson} onChange={e => setEF({ contactPerson: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
                          <Input type="email" value={editForm.email} onChange={e => setEF({ email: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Phone <span className="text-destructive">*</span></Label>
                          <Input value={editForm.phone} onChange={e => setEF({ phone: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Alternate Phone</Label>
                          <Input value={editForm.alternatePhone} onChange={e => setEF({ alternatePhone: e.target.value })} />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <Label className="text-xs">Physical Address <span className="text-destructive">*</span></Label>
                          <Textarea value={editForm.physicalAddress} onChange={e => setEF({ physicalAddress: e.target.value })} rows={2} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">City / Town</Label>
                          <Input value={editForm.city} onChange={e => setEF({ city: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Region / County</Label>
                          <Input value={editForm.region} onChange={e => setEF({ region: e.target.value })} />
                        </div>
                      </div>
                    </div>

                    {/* Company profile */}
                    <div className="rounded-xl border bg-card overflow-hidden">
                      <div className="px-4 py-2.5 border-b bg-violet-500/5 flex items-center gap-2">
                        <Briefcase className="h-3.5 w-3.5 text-violet-500 opacity-70" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Company Profile</span>
                      </div>
                      <div className="p-4 grid gap-4">
                        <div className="grid grid-cols-3 gap-3">
                          {(['sole_proprietorship', 'partnership', 'registered_company'] as CompanyStructure[]).map(cs => (
                            <button key={cs} type="button"
                              onClick={() => setEF({ companyStructure: cs })}
                              className={`rounded-lg border p-3 text-left text-xs transition-all ${
                                editForm.companyStructure === cs ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/30'
                              }`}>
                              <p className="font-semibold">{structureLabels[cs]}</p>
                            </button>
                          ))}
                        </div>
                        {editForm.companyStructure === 'sole_proprietorship' && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-xs">Owner Full Name</Label><Input value={editForm.ownerName} onChange={e => setEF({ ownerName: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">National ID / Passport</Label><Input value={editForm.ownerIdNumber} onChange={e => setEF({ ownerIdNumber: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">KRA PIN</Label><Input value={editForm.kraPin} onChange={e => setEF({ kraPin: e.target.value })} /></div>
                          </div>
                        )}
                        {editForm.companyStructure === 'partnership' && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-xs">Partnership Reg. No.</Label><Input value={editForm.registrationNumber} onChange={e => setEF({ registrationNumber: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">No. of Partners</Label><Input type="number" min={2} value={editForm.numberOfPartners} onChange={e => setEF({ numberOfPartners: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">KRA PIN</Label><Input value={editForm.kraPin} onChange={e => setEF({ kraPin: e.target.value })} /></div>
                          </div>
                        )}
                        {editForm.companyStructure === 'registered_company' && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-xs">Company Reg. No.</Label><Input value={editForm.registrationNumber} onChange={e => setEF({ registrationNumber: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">KRA PIN</Label><Input value={editForm.kraPin} onChange={e => setEF({ kraPin: e.target.value })} /></div>
                            <div className="col-span-2 space-y-1.5"><Label className="text-xs">Date of Incorporation</Label><Input type="date" value={editForm.incorporationDate} onChange={e => setEF({ incorporationDate: e.target.value })} /></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ─ Onboarding Packet tab ─ */}
                {proofDocTab === 'packet' && (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <OnboardingPacketReview
                      providerId={selectedProvider.id}
                      onReadinessChange={(ready, completed, total) =>
                        setReviewReady({ ready, completed, total })
                      }
                    />
                  </div>
                )}

                {/* ─ Audit Trail tab ─ */}
                {proofDocTab === 'audit' && (
                  <div className="p-6">
                    <ProviderAuditTrail providerId={selectedProvider.id} />
                  </div>
                )}

                {/* ─ Billing tab ─ */}
                {proofDocTab === 'billing' && (
                  <div className="p-6">
                    <ScanMeteringEditor
                      providerId={selectedProvider.id}
                      variant="card"
                    />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-3 border-t bg-muted/20 shrink-0">
                <p className="text-xs text-muted-foreground font-mono">{selectedProvider.id}</p>
                <div className="flex gap-2">
                  {proofDocTab === 'edit' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setProofDocTab('info')}>Cancel</Button>
                      <Button size="sm" onClick={handleEditSave} disabled={editSaving}>
                        {editSaving ? <><RotateCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</> : <><Save className="mr-1.5 h-3.5 w-3.5" />Save Changes</>}
                      </Button>
                    </>
                  )}
                  {proofDocTab !== 'edit' && (
                    <Button variant="outline" size="sm" onClick={closeViewDialog}>Close</Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Action Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!actionProvider} onOpenChange={() => setActionProvider(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {actionProvider?.type === 'approve' && <CheckCircle className="h-5 w-5 text-emerald-500" />}
              {actionProvider?.type === 'decline' && <XCircle className="h-5 w-5 text-destructive" />}
              {actionProvider?.type === 'suspend' && <Ban className="h-5 w-5 text-destructive" />}
              {actionProvider?.type === 'reactivate' && <CheckCircle className="h-5 w-5 text-emerald-500" />}
              {actionProvider?.type} provider
            </DialogTitle>
            <DialogDescription>
              {actionProvider?.provider.name}
              {actionProvider?.provider.licenseNumber && (
                <span className="ml-2 text-xs font-mono">({actionProvider.provider.licenseNumber})</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Full onboarding packet review (approve/decline only) */}
          {(actionProvider?.type === 'approve' || actionProvider?.type === 'decline') && actionProvider && (
            <div className="space-y-3 py-2 max-h-[50vh] overflow-y-auto">
              <OnboardingPacketReview providerId={actionProvider.provider.id} />
            </div>
          )}

          <div className="space-y-2 py-2">
            <Label>
              {actionProvider?.type === 'decline' ? 'Reason' : 'Notes'}
              {actionProvider?.type === 'decline' && (
                <span className="text-destructive"> *</span>
              )}
            </Label>
            <Textarea
              placeholder={
                actionProvider?.type === 'decline'
                  ? 'e.g. KRA PIN document is unclear — please resubmit a clearer copy.'
                  : actionProvider?.type === 'suspend'
                  ? 'Reason for suspension...'
                  : 'Add a note…'
              }
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionProvider(null)}>Cancel</Button>
            <Button
              variant={actionProvider?.type === 'suspend' || actionProvider?.type === 'decline' ? 'destructive' : 'default'}
              onClick={handleAction}
              disabled={
                actionSaving ||
                (actionProvider?.type === 'decline' && !actionNote.trim())
              }
            >
              {actionSaving ? 'Saving…' : `Confirm ${actionProvider?.type}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Action Confirm Dialog ─────────────────────────────────────── */}
      <Dialog open={!!bulkConfirm} onOpenChange={() => setBulkConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">
              Bulk {bulkConfirm} — {selectedIds.size} provider{selectedIds.size !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription>
              {bulkConfirm === 'delete'
                ? `This will permanently delete ${selectedIds.size} provider record${selectedIds.size !== 1 ? 's' : ''}. This cannot be undone.`
                : `This will ${bulkConfirm} all ${selectedIds.size} selected provider${selectedIds.size !== 1 ? 's' : ''}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirm(null)}>Cancel</Button>
            <Button
              variant={bulkConfirm === 'delete' ? 'destructive' : 'default'}
              onClick={handleBulkAction}
              disabled={bulkSaving}>
              {bulkSaving ? 'Processing…' : `Confirm ${bulkConfirm}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Provider Dialog (multi-step) ──────────────────────────────── */}
      <Dialog open={showAddDialog} onOpenChange={closeAdd}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Register New Provider</DialogTitle>
            <DialogDescription>Complete all sections to register a healthcare provider</DialogDescription>
          </DialogHeader>

          <StepIndicator current={step} />

          {/* ─ Step 0: Facility Info ─ */}
          {step === 0 && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>Provider / Facility Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="e.g. Nairobi Women's Hospital" value={form.name} onChange={e => setF({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Facility Type <span className="text-destructive">*</span></Label>
                  <Select value={form.type} onValueChange={v => setF({ type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hospital">Hospital</SelectItem>
                      <SelectItem value="clinic">Clinic</SelectItem>
                      <SelectItem value="pharmacy">Pharmacy</SelectItem>
                      <SelectItem value="lab">Laboratory</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>License / Facility Number <span className="text-destructive">*</span></Label>
                  <Input placeholder="e.g. LIC-001" value={form.licenseNumber} onChange={e => setF({ licenseNumber: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {/* ─ Step 1: Company Profile ─ */}
          {step === 1 && (
            <div className="grid gap-5">
              <div>
                <Label className="text-sm font-semibold">Business / Company Structure <span className="text-destructive">*</span></Label>
                <p className="text-xs text-muted-foreground mb-3">Select the legal structure under which this provider operates</p>
                <div className="grid grid-cols-3 gap-3">
                  <StructureCard
                    value="sole_proprietorship"
                    selected={form.companyStructure === 'sole_proprietorship'}
                    onSelect={() => setF({ companyStructure: 'sole_proprietorship' })}
                    icon={<Briefcase className="h-4 w-4" />}
                    title="Sole Proprietorship"
                    description="Owned and run by one individual"
                  />
                  <StructureCard
                    value="partnership"
                    selected={form.companyStructure === 'partnership'}
                    onSelect={() => setF({ companyStructure: 'partnership' })}
                    icon={<Users className="h-4 w-4" />}
                    title="Partnership"
                    description="Owned by two or more partners"
                  />
                  <StructureCard
                    value="registered_company"
                    selected={form.companyStructure === 'registered_company'}
                    onSelect={() => setF({ companyStructure: 'registered_company' })}
                    icon={<Building className="h-4 w-4" />}
                    title="Registered Company"
                    description="Incorporated under Companies Act"
                  />
                </div>
              </div>

              {/* Sole Proprietorship fields */}
              {form.companyStructure === 'sole_proprietorship' && (
                <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-4">
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proprietor Details</p>
                  <div className="space-y-1.5">
                    <Label>Owner Full Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="As per National ID" value={form.ownerName} onChange={e => setF({ ownerName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>National ID / Passport No. <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. 12345678" value={form.ownerIdNumber} onChange={e => setF({ ownerIdNumber: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>KRA PIN (optional)</Label>
                    <Input placeholder="e.g. A001234567X" value={form.kraPin} onChange={e => setF({ kraPin: e.target.value })} />
                  </div>
                </div>
              )}

              {/* Partnership fields */}
              {form.companyStructure === 'partnership' && (
                <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-4">
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Partnership Details</p>
                  <div className="space-y-1.5">
                    <Label>Partnership Registration No. <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. BPN/2020/0123" value={form.registrationNumber} onChange={e => setF({ registrationNumber: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Number of Partners <span className="text-destructive">*</span></Label>
                    <Input type="number" min={2} placeholder="Min. 2" value={form.numberOfPartners} onChange={e => setF({ numberOfPartners: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>KRA PIN (optional)</Label>
                    <Input placeholder="e.g. P051234567X" value={form.kraPin} onChange={e => setF({ kraPin: e.target.value })} />
                  </div>
                </div>
              )}

              {/* Registered Company fields */}
              {form.companyStructure === 'registered_company' && (
                <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-4">
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company Registration Details</p>
                  <div className="space-y-1.5">
                    <Label>Company Reg. No. <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. CPR/2010/0456" value={form.registrationNumber} onChange={e => setF({ registrationNumber: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>KRA PIN <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. P051234567X" value={form.kraPin} onChange={e => setF({ kraPin: e.target.value })} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Date of Incorporation</Label>
                    <Input type="date" value={form.incorporationDate} onChange={e => setF({ incorporationDate: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─ Step 2: Contact & Location ─ */}
          {step === 2 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Person <span className="text-destructive">*</span></Label>
                <Input placeholder="Full name" value={form.contactPerson} onChange={e => setF({ contactPerson: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input type="email" placeholder="admin@provider.co.ke" value={form.email} onChange={e => setF({ email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone <span className="text-destructive">*</span></Label>
                <Input placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => setF({ phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Alternate Phone</Label>
                <Input placeholder="+254 7XX XXX XXX" value={form.alternatePhone} onChange={e => setF({ alternatePhone: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Physical Address <span className="text-destructive">*</span></Label>
                <Textarea placeholder="Street, building, landmark…" rows={2} value={form.physicalAddress} onChange={e => setF({ physicalAddress: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>City / Town</Label>
                <Input placeholder="e.g. Nairobi" value={form.city} onChange={e => setF({ city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Region / County</Label>
                <Input placeholder="e.g. Nairobi" value={form.region} onChange={e => setF({ region: e.target.value })} />
              </div>
            </div>
          )}

          {/* ─ Step 3: Upload Proof ─ */}
          {step === 3 && (
            <div className="grid gap-5">
              <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 text-sm text-amber-700 dark:text-amber-400">
                <p className="font-semibold mb-1">Required document</p>
                {form.companyStructure === 'sole_proprietorship' && <p>Upload a copy of your <strong>National ID / Passport</strong> and a <strong>Business Permit / Single Business Permit</strong>.</p>}
                {form.companyStructure === 'partnership' && <p>Upload a copy of the <strong>Partnership Deed / Certificate of Registration</strong> issued by the Registrar of Business Names.</p>}
                {form.companyStructure === 'registered_company' && <p>Upload a copy of the <strong>Certificate of Incorporation</strong> issued by the Registrar of Companies (CAK / BRS).</p>}
                {!form.companyStructure && <p>Upload a copy of your <strong>registration / incorporation certificate</strong> or equivalent proof of business entity.</p>}
              </div>

              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                  onChange={e => setProofFile(e.target.files?.[0] ?? null)}
                />
                {!proofFile ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-10 transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div className="text-center">
                      <p className="font-medium text-sm">Click to upload proof document</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG or TIFF · Max 10 MB</p>
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{proofFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(proofFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setProofFile(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                This document will be reviewed by CIC staff before the provider is approved.
                You may skip this step and upload later, but approval will be on hold until received.
              </p>
            </div>
          )}

          {/* Footer navigation */}
          <DialogFooter className="flex-row justify-between sm:justify-between gap-2 pt-2">
            <div>
              {step > 0 && (
                <Button type="button" variant="outline" onClick={() => setStep(s => s - 1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={closeAdd}>Cancel</Button>
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" onClick={handleAdd} disabled={saving}>
                  {saving ? 'Registering…' : 'Register Provider'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PR4: Overall provider decision bar — Approve / Decline / Return-for-correction
// ─────────────────────────────────────────────────────────────────────────────
function ProviderDecisionBar({
  provider, onDone, reviewReady, reviewCompleted, reviewTotal,
}: {
  provider: Provider
  onDone: (next: Provider) => void
  reviewReady: boolean
  reviewCompleted: number
  reviewTotal: number
}) {
  const [open, setOpen] = useState<null | 'approve' | 'decline' | 'return'>(null)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReturned = provider.status === 'returned_for_correction' || provider.approvalStatus === 'returned_for_correction'

  const closeForm = () => { setOpen(null); setComment(''); setReason(''); setError(null) }

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      let res: any
      if (open === 'approve') {
        if (!comment.trim()) { setError('Approval comment is required'); setBusy(false); return }
        res = await api.post(`/providers/${provider.id}/approve`, { comment })
        toast.success(`${provider.name} approved`)
      } else if (open === 'decline') {
        if (!reason.trim()) { setError('Rejection reason is required'); setBusy(false); return }
        res = await api.post(`/providers/${provider.id}/reject`, { reason, comment: comment.trim() || undefined })
        toast.success(`${provider.name} declined`)
      } else if (open === 'return') {
        if (!comment.trim()) { setError('Tell the provider what needs fixing'); setBusy(false); return }
        res = await api.post(`/providers/${provider.id}/return-for-correction`, { comment })
        toast.success(`${provider.name} returned for correction`)
      }
      if (res?.data) onDone(res.data as Provider)
      closeForm()
    } catch (e: any) {
      const data = e?.response?.data
      if (data?.code === 'review_incomplete') {
        setError(`You must open and read every page of every document before approving. (${reviewCompleted}/${reviewTotal} documents fully read — switch to the Onboarding Packet tab to continue.)`)
      } else {
        setError(data?.message || 'Action failed')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className={`border-b px-6 py-3 ${isReturned ? 'bg-amber-500/5' : 'bg-muted/30'}`}>
      {isReturned && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">Returned for correction — waiting on the provider.</p>
            {provider.approvalComment && (
              <p className="mt-0.5 opacity-90">Your note: <em>"{provider.approvalComment}"</em></p>
            )}
            <p className="mt-0.5 opacity-70">When they resubmit, this banner clears and you can review again.</p>
          </div>
        </div>
      )}
      {!isReturned && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-2">Decision</span>

            {/* Approve — locked until all docs are fully read */}
            <div className="relative group">
              <Button
                size="sm"
                className={`h-7 text-xs gap-1.5 ${
                  reviewReady
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                }`}
                onClick={() => { if (reviewReady) { setOpen('approve'); setError(null) } }}
                disabled={busy || !reviewReady}
                title={reviewReady ? 'Approve this provider' : `Read all documents first — ${reviewCompleted}/${reviewTotal} done`}
              >
                {reviewReady
                  ? <CheckCircle className="h-3 w-3" />
                  : <Lock className="h-3 w-3" />}
                Approve
                {!reviewReady && reviewTotal > 0 && (
                  <span className="ml-0.5 text-[9px] opacity-70">({reviewCompleted}/{reviewTotal})</span>
                )}
              </Button>
            </div>

            <Button size="sm" variant="outline" className="h-7 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 text-xs gap-1.5"
              onClick={() => { setOpen('return'); setError(null) }} disabled={busy}>
              <RotateCcw className="h-3 w-3" /> Return for correction
            </Button>
            <Button size="sm" variant="outline" className="h-7 border-red-500/40 text-red-600 hover:bg-red-500/10 text-xs gap-1.5"
              onClick={() => { setOpen('decline'); setError(null) }} disabled={busy}>
              <XCircle className="h-3 w-3" /> Decline
            </Button>
          </div>

          {/* Reading progress hint when not all docs reviewed */}
          {!reviewReady && reviewTotal > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Approve unlocks after you read all pages in the <strong>Onboarding Packet</strong> tab — {reviewCompleted}/{reviewTotal} documents fully read.
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 rounded-md border bg-card p-3 space-y-2">
          <p className="text-xs font-medium">
            {open === 'approve' && 'Approve this provider'}
            {open === 'decline' && 'Decline this provider (terminal)'}
            {open === 'return' && 'Return packet to the provider for correction'}
          </p>
          {open === 'decline' && (
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Reason — emailed to the provider" />
          )}
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={
              open === 'approve' ? 'Approval comment (required) — internal note'
              : open === 'decline' ? 'Internal comment (optional)'
              : 'What needs to be corrected? — emailed to the provider'
            } />
          {error && (
            <div className="flex items-start gap-1.5 rounded-md bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-[11px] text-red-600">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={closeForm}>Cancel</Button>
            <Button size="sm" className={`h-7 text-xs ${
              open === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : open === 'decline' ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`} onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Audit Trail timeline for a single provider — shows every approval decision,
// per-doc review action, return-for-correction, and page view for compliance.
// ─────────────────────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string
  action: string
  entity: string | null
  entityId: string | null
  actor: string
  actorRole?: string | null
  ipAddress?: string | null
  at: string
  metadata?: any
}

const ACTION_META: Record<string, { label: string; tone: string; Icon: any }> = {
  approve_provider:                { label: 'Provider approved',                   tone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',   Icon: CheckCircle },
  reject_provider:                 { label: 'Provider declined',                   tone: 'bg-red-500/15 text-red-600 border-red-500/30',               Icon: XCircle },
  return_provider_for_correction:  { label: 'Returned for correction',             tone: 'bg-amber-500/15 text-amber-600 border-amber-500/30',         Icon: RotateCcw },
  approve_onboarding_document:     { label: 'Document approved',                   tone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',   Icon: CheckCircle },
  reject_onboarding_document:      { label: 'Document rejected',                   tone: 'bg-red-500/15 text-red-600 border-red-500/30',               Icon: XCircle },
  resubmit_onboarding_document:    { label: 'Document re-submitted',               tone: 'bg-purple-500/15 text-purple-600 border-purple-500/30',      Icon: Upload },
  provider_user_approved:          { label: 'Provider user approved',              tone: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',   Icon: CheckCircle },
  provider_user_rejected:          { label: 'Provider user rejected',              tone: 'bg-red-500/15 text-red-600 border-red-500/30',               Icon: XCircle },
  view_page:                       { label: 'Document page viewed',                tone: 'bg-blue-500/15 text-blue-600 border-blue-500/30',            Icon: Eye },
}

function ProviderAuditTrail({ providerId }: { providerId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showPageViews, setShowPageViews] = useState(false)
  const [docSummaryOpen, setDocSummaryOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get(`/providers/${providerId}/audit-trail`)
      .then(({ data }) => { if (!cancelled) setEntries(data) })
      .catch(() => { if (!cancelled) setEntries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [providerId])

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading audit trail…
    </div>
  )

  const filtered = showPageViews ? entries : entries.filter(e => e.action !== 'view_page')
  const decisionCount = entries.filter(e => e.action !== 'view_page').length
  const pageViews = entries.filter(e => e.action === 'view_page')
  const pageViewCount = pageViews.length

  // Group page views by document for the "Documents viewed" summary so the
  // reviewer can see at a glance which docs were opened, by whom, when, and
  // which pages — without having to scroll through 33+ timeline entries.
  const docSummary = new Map<string, { fileName: string; category: string; views: AuditEntry[]; reviewers: Set<string> }>()
  for (const v of pageViews) {
    const fileName = v.metadata?.fileName || v.entityId || 'Unknown document'
    const category = v.metadata?.category || ''
    const key = `${v.entityId}|${fileName}`
    if (!docSummary.has(key)) docSummary.set(key, { fileName, category, views: [], reviewers: new Set() })
    const e = docSummary.get(key)!
    e.views.push(v)
    e.reviewers.add(v.actor)
  }

  if (entries.length === 0) return (
    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
      <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
      <p>No audit events recorded for this provider yet.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Audit Trail</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {decisionCount} decision{decisionCount !== 1 ? 's' : ''}, {pageViewCount} page view{pageViewCount !== 1 ? 's' : ''}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={showPageViews}
            onChange={e => setShowPageViews(e.target.checked)}
            className="rounded border-border"
          />
          Show page views in timeline
        </label>
      </div>

      {/* Documents viewed — collapsible summary keyed by doc */}
      {docSummary.size > 0 && (
        <div className="rounded-lg border bg-card">
          <button
            type="button"
            onClick={() => setDocSummaryOpen(v => !v)}
            className="flex w-full items-center justify-between px-3 py-2.5 border-b hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-sm font-semibold">Documents viewed</span>
              <Badge variant="outline" className="text-[10px]">{docSummary.size} doc{docSummary.size !== 1 ? 's' : ''}</Badge>
            </div>
            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${docSummaryOpen ? 'rotate-90' : ''}`} />
          </button>
          {docSummaryOpen && (
            <div className="divide-y">
              {Array.from(docSummary.entries()).map(([key, d]) => {
                const sorted = [...d.views].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                const firstAt = sorted[0]?.at
                const lastAt = sorted[sorted.length - 1]?.at
                const pages = new Set(sorted.map(v => v.metadata?.pageNumber).filter(p => p != null))
                return (
                  <div key={key} className="px-3 py-2.5 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate flex-1">{d.fileName}</span>
                      {d.category && <Badge variant="outline" className="text-[9px] uppercase">{d.category.replace(/_/g, ' ')}</Badge>}
                      <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-[9px]">
                        {pages.size} page{pages.size !== 1 ? 's' : ''} read
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-5 flex-wrap">
                      <span>By {Array.from(d.reviewers).join(', ')}</span>
                      <span>· First: {new Date(firstAt).toLocaleString()}</span>
                      <span>· Last: {new Date(lastAt).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-5">
                      {sorted.map(v => (
                        <span
                          key={v.id}
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[9px] tabular-nums"
                          title={`${v.actor} viewed page ${v.metadata?.pageNumber} at ${new Date(v.at).toLocaleString()}`}
                        >
                          <span className="font-mono opacity-60">p{v.metadata?.pageNumber}</span>
                          <span className="opacity-50">·</span>
                          <span className="opacity-70">{new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(e => {
          const meta = ACTION_META[e.action] || { label: e.action, tone: 'bg-muted text-muted-foreground border-border', Icon: History }
          const Icon = meta.Icon
          return (
            <div key={e.id} className="flex items-start gap-3 rounded-md border bg-card p-3">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 border ${meta.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-semibold">{meta.label}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground text-xs">{e.actor}</span>
                  {e.actorRole && (
                    <Badge variant="outline" className="text-[9px] uppercase tracking-wider">{e.actorRole}</Badge>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </div>
                {/* Context-specific details */}
                {e.metadata && (
                  <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                    {e.metadata.fileName && (
                      <p>📄 <strong>{e.metadata.fileName}</strong>{e.metadata.category && <span className="opacity-70"> ({String(e.metadata.category).replace(/_/g, ' ')})</span>}</p>
                    )}
                    {e.metadata.pageNumber != null && (
                      <p className="opacity-70">Page {e.metadata.pageNumber}</p>
                    )}
                    {e.metadata.comment && (
                      <p className="italic">"{e.metadata.comment}"</p>
                    )}
                    {e.metadata.reason && (
                      <p className="italic text-destructive">Reason: "{e.metadata.reason}"</p>
                    )}
                    {e.metadata.version && e.metadata.version > 1 && (
                      <p className="opacity-70">Version {e.metadata.version}</p>
                    )}
                    {e.ipAddress && (
                      <p className="text-[10px] opacity-50">IP {e.ipAddress}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
