import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Building2, Plus, Search, Edit2, Trash2, MapPin, Phone,
  Mail, CheckCircle, XCircle, AlertTriangle, ChevronDown,
  ChevronRight, Users, FileText, RefreshCw, MoreHorizontal,
  Network, Globe, Hash, Eye, ArrowLeft, TrendingDown,
  Paperclip, DollarSign, Clock, ShieldAlert, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Pagination } from '@/components/Pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Switch } from '@/components/ui/switch'
import { formatDate, formatCurrency, getStatusColor } from '@/lib/utils'
import { useClaimsStore, type ClaimRecord } from '@/store/claimsStore'
import { useAuthStore } from '@/store/authStore'
import api from '@/services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: string
  code: string
  name: string
  providerId: string
  providerName: string
  region: string
  county: string
  address: string
  phone: string
  email: string
  contactPerson: string
  isActive: boolean
  isApproved: boolean
  claimsCount: number
  pendingClaims: number
  rejectedClaims?: number
  approvalRate: number
  lastActivity: string
  createdAt: string
  notes?: string
  invoiceUploaderId?: string
  branchManagerId?: string
  invoiceUploaderName?: string
  branchManagerName?: string
}

interface StaffUser {
  id: string
  name: string
  email: string
  role: string
}

interface Provider {
  id: string
  name: string
  code: string
  branches: number
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_PROVIDERS: Provider[] = [
  { id: 'p1', name: 'Nairobi Hospital', code: 'NBI-HOSP', branches: 3 },
  { id: 'p2', name: 'Aga Khan University Hospital', code: 'AKUH', branches: 5 },
  { id: 'p3', name: 'MP Shah Hospital', code: 'MPSH', branches: 2 },
  { id: 'p4', name: 'Karen Hospital', code: 'KAREN', branches: 1 },
  { id: 'p5', name: 'Kenyatta National Hospital', code: 'KNH', branches: 2 },
]

const DEMO_BRANCHES: Branch[] = [
  {
    id: 'b1', code: 'NBI-WEST', name: 'Nairobi West Branch',
    providerId: 'p1', providerName: 'Nairobi Hospital',
    region: 'Nairobi', county: 'Nairobi', address: 'Argwings Kodhek Rd, Nairobi',
    phone: '+254 20 284 5000', email: 'claims@nairobihosp.org',
    contactPerson: 'Jane Wanjiku', isActive: true, isApproved: true,
    claimsCount: 245, pendingClaims: 12, rejectedClaims: 8, approvalRate: 87,
    lastActivity: '2026-04-16T10:30:00Z', createdAt: '2023-01-15T08:00:00Z',
  },
  {
    id: 'b2', code: 'NBI-HQ', name: 'Nairobi Headquarters',
    providerId: 'p1', providerName: 'Nairobi Hospital',
    region: 'Nairobi', county: 'Nairobi', address: 'Hospital Rd, Nairobi',
    phone: '+254 20 388 4444', email: 'hq@nairobihosp.org',
    contactPerson: 'Peter Mwangi', isActive: true, isApproved: true,
    claimsCount: 188, pendingClaims: 5, rejectedClaims: 3, approvalRate: 91,
    lastActivity: '2026-04-16T14:00:00Z', createdAt: '2023-06-01T08:00:00Z',
  },
  {
    id: 'b3', code: 'AKUH-MAIN', name: 'Aga Khan University Hospital Main',
    providerId: 'p2', providerName: 'Aga Khan University Hospital',
    region: 'Nairobi', county: 'Nairobi', address: '3rd Parklands Ave, Nairobi',
    phone: '+254 20 366 2000', email: 'claims@akhk.or.ke',
    contactPerson: 'Dr. Hassan Kamau', isActive: true, isApproved: true,
    claimsCount: 512, pendingClaims: 23, rejectedClaims: 15, approvalRate: 93,
    lastActivity: '2026-04-13T08:15:00Z', createdAt: '2022-08-01T08:00:00Z',
  },
  {
    id: 'b4', code: 'AKUH-KISUMU', name: 'Aga Khan Hospital Kisumu',
    providerId: 'p2', providerName: 'Aga Khan University Hospital',
    region: 'Nyanza', county: 'Kisumu', address: 'Kisumu, Kenya',
    phone: '+254 57 202 2285', email: 'kisumu@akhk.or.ke',
    contactPerson: 'Dr. Sarah Oduya', isActive: true, isApproved: true,
    claimsCount: 178, pendingClaims: 8, rejectedClaims: 5, approvalRate: 89,
    lastActivity: '2026-04-12T16:30:00Z', createdAt: '2022-09-15T08:00:00Z',
  },
  {
    id: 'b5', code: 'KNH-MAIN', name: 'Kenyatta National Hospital',
    providerId: 'p5', providerName: 'Kenyatta National Hospital',
    region: 'Nairobi', county: 'Nairobi', address: 'Hospital Rd, Nairobi',
    phone: '+254 20 272 6300', email: 'claims@knh.or.ke',
    contactPerson: 'Dr. John Odhiambo', isActive: true, isApproved: true,
    claimsCount: 334, pendingClaims: 41, rejectedClaims: 22, approvalRate: 82,
    lastActivity: '2026-04-13T07:45:00Z', createdAt: '2021-05-01T08:00:00Z',
  },
]

const REGIONS = ['Nairobi', 'Central', 'Coast', 'Eastern', 'North Eastern', 'Nyanza', 'Rift Valley', 'Western']
const COUNTIES = ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Malindi', 'Kisii', 'Nyeri', 'Machakos']

const EMPTY_BRANCH_FORM = {
  code: '', name: '', providerId: '', region: '', county: '',
  address: '', phone: '', email: '', contactPerson: '', notes: '',
  isActive: true, isApproved: false,
  invoiceUploaderId: '', branchManagerId: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Branches() {
  const { claims } = useClaimsStore()
  const { user } = useAuthStore()

  const [branches, setBranches] = useState<Branch[]>(DEMO_BRANCHES)
  const [providers, setProviders] = useState<Provider[]>(DEMO_PROVIDERS)
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [showDialog, setShowDialog] = useState(false)
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null)
  const [form, setForm] = useState({ ...EMPTY_BRANCH_FORM })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Branch | null>(null)

  // Drill-down state
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [resubmitClaim, setResubmitClaim] = useState<ClaimRecord | null>(null)
  const [allClaimsPage, setAllClaimsPage] = useState(1)
  const [allClaimsPageSize, setAllClaimsPageSize] = useState(20)
  const [resubmitNotes, setResubmitNotes] = useState('')
  const [resubmitting, setResubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [bRes, pRes, uRes] = await Promise.allSettled([
        api.get('/branches'),
        api.get('/branches/providers'),
        api.get('/users'),
      ])
      if (bRes.status === 'fulfilled') {
        const d = bRes.value.data
        setBranches(Array.isArray(d.branches) ? d.branches : Array.isArray(d) ? d : DEMO_BRANCHES)
      }
      if (pRes.status === 'fulfilled') {
        const p = pRes.value.data
        if (Array.isArray(p) && p.length > 0) setProviders(p)
      }
      if (uRes.status === 'fulfilled') {
        const u = uRes.value.data
        const list = Array.isArray(u) ? u : Array.isArray(u?.users) ? u.users : []
        setStaffUsers(list.filter((u: StaffUser) =>
          ['provider_user', 'provider_admin', 'claims_officer', 'maker_checker'].includes(u.role)
        ))
      }
    } catch { /* keep demo */ }
  }, [])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  const setField = (k: keyof typeof EMPTY_BRANCH_FORM, v: string | boolean) =>
    setForm(prev => ({ ...prev, [k]: v }))

  // Claims grouped by branch (use uploadedBy or match provider)
  const branchClaims = useMemo(() => {
    const map = new Map<string, ClaimRecord[]>()
    for (const branch of branches) {
      map.set(branch.id, [])
    }
    // Associate claims to branches
    for (const c of claims) {
      // Try to match by provider name to branch
      for (const b of branches) {
        if (c.provider?.name === b.providerName || c.uploadedBy === b.email) {
          map.get(b.id)?.push(c)
          break
        }
      }
    }
    return map
  }, [claims, branches])

  // Claims needing action (rejected + incomplete with fraud flags)
  const needsActionClaims = useMemo(() => {
    return claims.filter(c =>
      c.status === 'rejected' || c.status === 'incomplete'
    )
  }, [claims])

  // Stats
  const stats = useMemo(() => ({
    total: branches.length,
    active: branches.filter(b => b.isActive).length,
    approved: branches.filter(b => b.isApproved).length,
    pending: branches.filter(b => !b.isApproved).length,
    totalClaims: branches.reduce((s, b) => s + b.claimsCount, 0),
    totalRejected: branches.reduce((s, b) => s + (b.rejectedClaims || 0), 0),
    regions: new Set(branches.map(b => b.region)).size,
    needsAction: needsActionClaims.length,
  }), [branches, needsActionClaims])

  // Filtered branches
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return branches.filter(b => {
      if (q && !b.name.toLowerCase().includes(q) && !b.code.toLowerCase().includes(q)
        && !b.providerName.toLowerCase().includes(q) && !b.county?.toLowerCase().includes(q)
        && !b.contactPerson?.toLowerCase().includes(q)) return false
      if (regionFilter !== 'all' && b.region !== regionFilter) return false
      if (providerFilter !== 'all' && b.providerId !== providerFilter) return false
      if (statusFilter === 'active' && !b.isActive) return false
      if (statusFilter === 'inactive' && b.isActive) return false
      if (statusFilter === 'pending' && b.isApproved) return false
      return true
    })
  }, [branches, search, regionFilter, providerFilter, statusFilter])

  const openAdd = () => {
    setEditingBranch(null)
    setForm({ ...EMPTY_BRANCH_FORM })
    setShowDialog(true)
  }

  const openEdit = (branch: Branch) => {
    setEditingBranch(branch)
    setForm({
      code: branch.code, name: branch.name, providerId: branch.providerId,
      region: branch.region, county: branch.county, address: branch.address,
      phone: branch.phone, email: branch.email, contactPerson: branch.contactPerson,
      notes: branch.notes || '', isActive: branch.isActive, isApproved: branch.isApproved,
      invoiceUploaderId: branch.invoiceUploaderId || '',
      branchManagerId: branch.branchManagerId || '',
    })
    setShowDialog(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.code || !form.providerId) return
    setSaving(true)
    try {
      if (editingBranch) {
        const { data: updated } = await api.patch(`/branches/${editingBranch.id}`, form)
        setBranches(prev => prev.map(b => b.id === editingBranch.id ? { ...b, ...updated } : b))
      } else {
        try {
          const { data: created } = await api.post('/branches', form)
          setBranches(prev => [created, ...prev])
        } catch {
          const providerName = providers.find(p => p.id === form.providerId)?.name || ''
          setBranches(prev => [{
            id: `b${Date.now()}`, code: form.code, name: form.name,
            providerId: form.providerId, providerName,
            region: form.region, county: form.county, address: form.address,
            phone: form.phone, email: form.email, contactPerson: form.contactPerson,
            isActive: form.isActive as boolean, isApproved: form.isApproved as boolean,
            claimsCount: 0, pendingClaims: 0, rejectedClaims: 0, approvalRate: 0,
            lastActivity: new Date().toISOString(), createdAt: new Date().toISOString(),
            notes: form.notes,
          }, ...prev])
        }
      }
    } catch { /* ignore */ }
    setSaving(false)
    setShowDialog(false)
  }

  const handleDelete = async (branch: Branch) => {
    try {
      await api.delete(`/branches/${branch.id}`)
    } catch { /* ignore */ }
    setBranches(prev => prev.filter(b => b.id !== branch.id))
    setDeleteConfirm(null)
  }

  const handleResubmit = async (claim: ClaimRecord) => {
    setResubmitting(true)
    try {
      await api.post('/workflow/provider/resubmit', { claimId: claim.id, notes: resubmitNotes })
    } catch { /* best effort */ }
    setResubmitting(false)
    setResubmitNotes('')
    setResubmitClaim(null)
  }

  // ─── Branch drill-down view ─────────────────────────────────────────────────
  if (selectedBranch) {
    const bClaims = branchClaims.get(selectedBranch.id) || []
    const rejected = bClaims.filter(c => c.status === 'rejected')
    const incomplete = bClaims.filter(c => c.status === 'incomplete')
    const approved = bClaims.filter(c => c.status === 'approved' || c.status === 'paid')
    const pending = bClaims.filter(c => ['submitted', 'under_review'].includes(c.status))
    const rejectionRate = bClaims.length > 0 ? Math.round((rejected.length / bClaims.length) * 100) : 0
    const approvalRate = bClaims.length > 0 ? Math.round((approved.length / bClaims.length) * 100) : 0
    const fraudClaims = bClaims.filter(c => c.fraudSignals && c.fraudSignals.length > 0)

    return (
      <div className="space-y-6">
        {/* Back button & header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedBranch(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-blue-500" />
              <div>
                <h1 className="text-2xl font-bold">{selectedBranch.name}</h1>
                <p className="text-sm text-muted-foreground font-mono">{selectedBranch.code} &middot; {selectedBranch.providerName}</p>
              </div>
              <Badge className={selectedBranch.isActive
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-600'
              }>
                {selectedBranch.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Claims</p>
              <p className="text-2xl font-bold">{bClaims.length || selectedBranch.claimsCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-amber-600">{pending.length || selectedBranch.pendingClaims}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Rejected</p>
              <p className="text-2xl font-bold text-red-600">{rejected.length || selectedBranch.rejectedClaims || 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Approval Rate</p>
              <p className={`text-2xl font-bold ${approvalRate >= 85 ? 'text-emerald-600' : approvalRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                {approvalRate || selectedBranch.approvalRate}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Rejection Rate</p>
              <p className={`text-2xl font-bold ${rejectionRate <= 10 ? 'text-emerald-600' : rejectionRate <= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                {rejectionRate}%
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="all-claims">
          <TabsList>
            <TabsTrigger value="all-claims" className="gap-2">
              <FileText className="h-4 w-4" /> All Claims
              <Badge variant="secondary" className="ml-1 text-[10px] h-5 px-1.5">{bClaims.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="needs-action" className="gap-2">
              <AlertTriangle className="h-4 w-4" /> Needs Action
              {(rejected.length + incomplete.length) > 0 && (
                <Badge className="ml-1 text-[10px] h-5 px-1.5 bg-red-500 text-white">{rejected.length + incomplete.length}</Badge>
              )}
            </TabsTrigger>
            {fraudClaims.length > 0 && (
              <TabsTrigger value="fraud" className="gap-2">
                <ShieldAlert className="h-4 w-4" /> Fraud Alerts
                <Badge className="ml-1 text-[10px] h-5 px-1.5 bg-red-600 text-white">{fraudClaims.length}</Badge>
              </TabsTrigger>
            )}
          </TabsList>

          {/* All claims for this branch */}
          <TabsContent value="all-claims" className="mt-4">
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Fraud Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bClaims.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No claims found for this branch</TableCell></TableRow>
                    ) : bClaims.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <p>{c.claimNumber}</p>
                          {c.barcode && <p className="font-mono text-[9px] text-red-500">{c.barcode}</p>}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{c.memberName}</p>
                          <p className="text-xs text-muted-foreground">{c.memberNumber}</p>
                        </TableCell>
                        <TableCell>{formatCurrency(c.invoiceAmount)}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            <Building2 className="h-2.5 w-2.5 mr-1" />{selectedBranch.code}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                        <TableCell>
                          {c.fraudSignals && c.fraudSignals.length > 0 ? (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-[10px]">
                              <ShieldAlert className="h-2.5 w-2.5 mr-1" />{c.fraudSignals.length} flag{c.fraudSignals.length > 1 ? 's' : ''}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Needs Action - rejected/incomplete with resubmit */}
          <TabsContent value="needs-action" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Claims Requiring Action
                </CardTitle>
                <CardDescription>
                  Rejected or incomplete claims &mdash; review and resubmit to continue processing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[...rejected, ...incomplete].length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>No claims requiring action for this branch</p>
                  </div>
                ) : [...rejected, ...incomplete].map(c => (
                  <div key={c.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{c.claimNumber}</span>
                          <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge>
                          {c.priority !== 'normal' && (
                            <Badge variant="outline" className="text-[10px]">{c.priority}</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {c.memberName} &middot; {c.memberNumber}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(c.invoiceAmount)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</p>
                      </div>
                    </div>

                    {/* Rejection reason */}
                    {c.notes && (
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
                        <p className="text-xs">
                          <span className="font-semibold text-red-700 dark:text-red-400">Reason: </span>
                          <span className="text-red-600 dark:text-red-300">{c.notes}</span>
                        </p>
                      </div>
                    )}

                    {/* Fraud signals */}
                    {c.fraudSignals && c.fraudSignals.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 space-y-1">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3" /> Fraud Allegations
                        </p>
                        {c.fraudSignals.map((f, i) => (
                          <p key={i} className="text-xs text-amber-600 dark:text-amber-300">
                            &bull; <span className="font-medium">{f.title}:</span> {f.detail}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Resubmit button */}
                    <div className="flex justify-end pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResubmitClaim(c); setResubmitNotes('') }}
                        className="gap-2"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Resubmit
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fraud alerts */}
          {fraudClaims.length > 0 && (
            <TabsContent value="fraud" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-600" /> Fraud Allegations
                  </CardTitle>
                  <CardDescription>
                    Claims flagged for potential fraud by claims officers &mdash; review and respond
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fraudClaims.map(c => (
                    <div key={c.id} className="border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2 bg-red-50/50 dark:bg-red-950/10">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{c.claimNumber}</span>
                            <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge>
                            <Badge variant="outline" className="text-[10px]">
                              <Building2 className="h-2.5 w-2.5 mr-1" />{selectedBranch.code}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">{c.memberName} &middot; {c.memberNumber}</p>
                        </div>
                        <p className="font-bold">{formatCurrency(c.invoiceAmount)}</p>
                      </div>
                      {c.fraudSignals?.map((f, i) => (
                        <div key={i} className={`rounded px-3 py-2 text-xs ${f.level === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>
                          <span className="font-semibold">{f.level === 'critical' ? 'CRITICAL' : 'WARNING'}: {f.title}</span> &mdash; {f.detail}
                        </div>
                      ))}
                      {(c.status === 'rejected' || c.status === 'incomplete') && (
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" onClick={() => { setResubmitClaim(c); setResubmitNotes('') }}>
                            <RefreshCw className="h-3.5 w-3.5 mr-2" /> Respond & Resubmit
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    )
  }

  // ─── Main branch management view ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Branch Management</h1>
          <p className="text-muted-foreground">Manage provider branch networks across regions</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Branch
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="branches" className="gap-2">
            Branches ({filtered.length})
          </TabsTrigger>
          <TabsTrigger value="needs-action" className="gap-2">
            Needs Action
            {stats.needsAction > 0 && (
              <Badge className="ml-1 text-[10px] h-5 px-1.5 bg-red-500 text-white">{stats.needsAction}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all-claims">All Claims</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {[
              { label: 'Total Branches', value: stats.total, icon: Network, color: 'text-blue-500' },
              { label: 'Active', value: stats.active, icon: CheckCircle, color: 'text-emerald-500' },
              { label: 'Pending Approval', value: stats.pending, icon: AlertTriangle, color: 'text-amber-500' },
              { label: 'Total Claims', value: stats.totalClaims.toLocaleString(), icon: FileText, color: 'text-violet-500' },
              { label: 'Rejected', value: stats.totalRejected, icon: XCircle, color: 'text-red-500' },
              { label: 'Needs Action', value: stats.needsAction, icon: AlertTriangle, color: 'text-red-600' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                    </div>
                    <s.icon className={`h-6 w-6 ${s.color} opacity-75`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── BRANCHES (clickable cards) ── */}
        <TabsContent value="branches" className="mt-4 space-y-4">
          {/* Filter bar */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search branches..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
                <Select value={regionFilter} onValueChange={setRegionFilter}>
                  <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Region" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Regions</SelectItem>
                    {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={providerFilter} onValueChange={setProviderFilter}>
                  <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Provider" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Providers</SelectItem>
                    {providers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Branch cards grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="flex items-center justify-center h-32 text-muted-foreground">
                  No branches match current filters
                </CardContent>
              </Card>
            ) : filtered.map(branch => {
              const rejRate = branch.claimsCount > 0 ? Math.round(((branch.rejectedClaims || 0) / branch.claimsCount) * 100) : 0
              return (
                <Card
                  key={branch.id}
                  className="cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/20 transition-all"
                  onClick={() => setSelectedBranch(branch)}
                >
                  <CardContent className="pt-4 pb-3 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-500" />
                        <div>
                          <p className="font-semibold text-sm">{branch.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{branch.code}</p>
                        </div>
                      </div>
                      <Badge className={branch.isActive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px]'
                        : 'text-[10px]'
                      } variant={branch.isActive ? 'default' : 'secondary'}>
                        {branch.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>

                    {/* Location */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {branch.county || branch.region || 'Unknown'}
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">Claims</p>
                        <p className="text-lg font-bold">{branch.claimsCount}</p>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">Pending</p>
                        <p className="text-lg font-bold text-amber-600">{branch.pendingClaims}</p>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">Rejected</p>
                        <p className="text-lg font-bold text-red-600">{branch.rejectedClaims || 0}</p>
                      </div>
                    </div>

                    {/* Approval rate bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Approval rate</span>
                        <span className={`font-medium ${branch.approvalRate >= 85 ? 'text-emerald-600' : branch.approvalRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                          {branch.approvalRate}%
                        </span>
                      </div>
                      <Progress
                        value={branch.approvalRate}
                        className="h-1.5"
                      />
                    </div>

                    {/* Last activity */}
                    <p className="text-[10px] text-muted-foreground">
                      Last activity: {formatDate(branch.lastActivity)}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        {/* ── NEEDS ACTION ── */}
        <TabsContent value="needs-action" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" /> Claims Requiring Action
              </CardTitle>
              <CardDescription>
                Rejected or incomplete claims &mdash; review and resubmit to continue processing
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {needsActionClaims.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>No claims requiring action</p>
                </div>
              ) : needsActionClaims.map(c => {
                // Find which branch this claim belongs to
                const claimBranch = branches.find(b => b.providerName === c.provider?.name)
                return (
                  <div key={c.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold">{c.claimNumber}</span>
                          <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge>
                          {c.priority !== 'normal' && (
                            <Badge variant="outline" className="text-[10px]">{c.priority}</Badge>
                          )}
                          {claimBranch && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Building2 className="h-2.5 w-2.5" /> {claimBranch.code}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {c.memberName} &middot; {c.memberNumber}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(c.invoiceAmount)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</p>
                      </div>
                    </div>

                    {/* Rejection reason */}
                    {c.notes && (
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
                        <p className="text-xs">
                          <span className="font-semibold text-red-700 dark:text-red-400">Reason: </span>
                          <span className="text-red-600 dark:text-red-300">{c.notes}</span>
                        </p>
                      </div>
                    )}

                    {/* Fraud signals */}
                    {c.fraudSignals && c.fraudSignals.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 space-y-1">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3" /> Fraud Allegations
                        </p>
                        {c.fraudSignals.map((f, i) => (
                          <p key={i} className="text-xs text-amber-600 dark:text-amber-300">
                            &bull; <span className="font-medium">{f.title}:</span> {f.detail}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResubmitClaim(c); setResubmitNotes('') }}
                        className="gap-2"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Resubmit
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ALL CLAIMS (with branch column) ── */}
        <TabsContent value="all-claims" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Claims</CardTitle>
              <CardDescription>Claims across all branches with branch identification</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim #</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fraud Flags</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No claims</TableCell></TableRow>
                  ) : claims.slice((allClaimsPage - 1) * allClaimsPageSize, allClaimsPage * allClaimsPageSize).map(c => {
                    const claimBranch = branches.find(b => b.providerName === c.provider?.name)
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <p>{c.claimNumber}</p>
                          {c.barcode && <p className="font-mono text-[9px] text-red-500">{c.barcode}</p>}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{c.memberName}</p>
                          <p className="text-[10px] text-muted-foreground">{c.memberNumber}</p>
                        </TableCell>
                        <TableCell className="text-sm">{c.provider?.name}</TableCell>
                        <TableCell>
                          {claimBranch ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] cursor-pointer hover:bg-muted"
                              onClick={() => setSelectedBranch(claimBranch)}
                            >
                              <Building2 className="h-2.5 w-2.5 mr-1" />{claimBranch.code}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{formatCurrency(c.invoiceAmount)}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell>
                          {c.fraudSignals && c.fraudSignals.length > 0 ? (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-[10px]">
                              <ShieldAlert className="h-2.5 w-2.5 mr-1" />{c.fraudSignals.length}
                            </Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Pagination
                page={allClaimsPage}
                pageSize={allClaimsPageSize}
                total={claims.length}
                onPageChange={setAllClaimsPage}
                onPageSizeChange={(size) => { setAllClaimsPageSize(size); setAllClaimsPage(1) }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Resubmit Dialog ── */}
      <Dialog open={!!resubmitClaim} onOpenChange={() => setResubmitClaim(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resubmit Claim</DialogTitle>
            <DialogDescription>
              Resubmit <strong>{resubmitClaim?.claimNumber}</strong> with updated information or additional documents.
            </DialogDescription>
          </DialogHeader>
          {resubmitClaim?.notes && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
              <p className="text-xs">
                <span className="font-semibold text-red-700 dark:text-red-400">Original rejection reason: </span>
                <span className="text-red-600 dark:text-red-300">{resubmitClaim.notes}</span>
              </p>
            </div>
          )}
          {resubmitClaim?.fraudSignals && resubmitClaim.fraudSignals.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Fraud flags to address:</p>
              {resubmitClaim.fraudSignals.map((f, i) => (
                <p key={i} className="text-xs text-amber-600 dark:text-amber-300">&bull; {f.title}: {f.detail}</p>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label>Notes / Response</Label>
            <Textarea
              placeholder="Explain corrections made, attach additional documents via the claims page..."
              value={resubmitNotes}
              onChange={e => setResubmitNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResubmitClaim(null)}>Cancel</Button>
            <Button
              onClick={() => resubmitClaim && handleResubmit(resubmitClaim)}
              disabled={resubmitting}
            >
              {resubmitting ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Submitting...</> : <><Send className="mr-2 h-3.5 w-3.5" /> Resubmit Claim</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={showDialog} onOpenChange={open => { if (!open) setShowDialog(false) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingBranch ? 'Edit Branch' : 'Add New Branch'}</DialogTitle>
            <DialogDescription>
              {editingBranch ? `Editing ${editingBranch.name}` : 'Register a new provider branch in the network'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Provider <span className="text-destructive">*</span></Label>
                <Select value={form.providerId} onValueChange={v => setField('providerId', v)}>
                  <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    {providers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Branch Code <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. NBI-WEST" value={form.code} onChange={e => setField('code', e.target.value.toUpperCase())} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Branch Name <span className="text-destructive">*</span></Label>
              <Input placeholder="Full branch name" value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Select value={form.region} onValueChange={v => setField('region', v)}>
                  <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>County</Label>
                <Select value={form.county} onValueChange={v => setField('county', v)}>
                  <SelectTrigger><SelectValue placeholder="Select county" /></SelectTrigger>
                  <SelectContent>{COUNTIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Physical Address</Label>
              <Input placeholder="Street / Building / Area" value={form.address} onChange={e => setField('address', e.target.value)} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Person</Label>
                <Input value={form.contactPerson} onChange={e => setField('contactPerson', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setField('phone', e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setField('email', e.target.value)} />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Invoice Uploader</Label>
                <Select value={form.invoiceUploaderId || '__none__'} onValueChange={v => setField('invoiceUploaderId', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-- Not assigned --</SelectItem>
                    {staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Branch Manager</Label>
                <Select value={form.branchManagerId || '__none__'} onValueChange={v => setField('branchManagerId', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-- Not assigned --</SelectItem>
                    {staffUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-8">
              <div className="flex items-center gap-3">
                <Switch id="active" checked={form.isActive as boolean} onCheckedChange={v => setField('isActive', v)} />
                <Label htmlFor="active">Active</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="approved" checked={form.isApproved as boolean} onCheckedChange={v => setField('isApproved', v)} />
                <Label htmlFor="approved">Approved</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.code || !form.providerId}>
              {saving ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving...</> : editingBranch ? 'Update Branch' : 'Add Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Branch</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{deleteConfirm?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
