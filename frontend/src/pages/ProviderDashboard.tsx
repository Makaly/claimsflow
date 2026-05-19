import { useState, useEffect, useCallback } from 'react'
import {
  FileText, CheckCircle, XCircle, Clock, Building2,
  AlertTriangle, RefreshCw, RotateCcw, MapPin, Upload,
  TrendingUp, ChevronRight, ShieldCheck, FileUp, Loader2,
  Search, Download, FileSpreadsheet,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────

interface BranchSummary {
  id: string
  code: string
  name: string
  region: string
  isActive: boolean
  isApproved: boolean
  claimsCount: number
  pendingClaims: number
  rejectedClaims: number
  approvalRate: number
  lastActivity?: string
}

interface ClaimRow {
  id: string
  claimNumber: string
  patientName?: string
  memberNumber?: string
  invoiceNumber?: string
  invoiceAmount?: number
  status: string
  workflowStage: string
  priority: string
  rejectionReason?: string
  missingDocuments?: string[]
  resubmissionCount?: number
  submittedAt: string
  branchName?: string
  providerName?: string
}

interface ProviderInfo {
  id: string
  name: string
  type: string
  licenseNumber: string
  status: string
  canSubmitClaims: boolean
  approvalStatus?: string
  rejectionReason?: string | null
  proofDocumentName?: string | null
}

// ── Demo data ──────────────────────────────────────────────────────────────

const DEMO_BRANCHES: BranchSummary[] = [
  { id: 'b1', code: 'NBI-HQ', name: 'Nairobi Headquarters', region: 'Nairobi', isActive: true, isApproved: true, claimsCount: 148, pendingClaims: 12, rejectedClaims: 3, approvalRate: 88, lastActivity: new Date(Date.now() - 3600000).toISOString() },
  { id: 'b2', code: 'NBI-WEST', name: 'Nairobi West Branch', region: 'Nairobi', isActive: true, isApproved: true, claimsCount: 72, pendingClaims: 5, rejectedClaims: 1, approvalRate: 92, lastActivity: new Date(Date.now() - 7200000).toISOString() },
  { id: 'b3', code: 'KSM-MAIN', name: 'Kisumu Branch', region: 'Nyanza', isActive: true, isApproved: true, claimsCount: 45, pendingClaims: 8, rejectedClaims: 2, approvalRate: 84, lastActivity: new Date(Date.now() - 86400000).toISOString() },
]

const DEMO_CLAIMS: ClaimRow[] = [
  { id: 'c1', claimNumber: 'CLM-2026-0041', patientName: 'Alice Kamau', memberNumber: 'MEM-1234', invoiceNumber: 'INV-001', invoiceAmount: 12500, status: 'rejected', workflowStage: 'completed', priority: 'normal', rejectionReason: 'Invoice amount exceeds benefit limit', submittedAt: new Date(Date.now() - 86400000).toISOString(), branchName: 'Nairobi Headquarters' },
  { id: 'c2', claimNumber: 'CLM-2026-0039', patientName: 'Brian Otieno', memberNumber: 'MEM-5678', invoiceNumber: 'INV-002', invoiceAmount: 8200, status: 'incomplete', workflowStage: 'initial_review', priority: 'high', rejectionReason: 'Missing lab results', submittedAt: new Date(Date.now() - 172800000).toISOString(), branchName: 'Nairobi Headquarters' },
  { id: 'c3', claimNumber: 'CLM-2026-0035', patientName: 'Carol Wanjiku', memberNumber: 'MEM-9012', invoiceNumber: 'INV-003', invoiceAmount: 31000, status: 'under_review', workflowStage: 'claims_officer_review', priority: 'urgent', submittedAt: new Date(Date.now() - 259200000).toISOString(), branchName: 'Nairobi West Branch' },
  { id: 'c4', claimNumber: 'CLM-2026-0033', patientName: 'David Mwenda', memberNumber: 'MEM-3456', invoiceNumber: 'INV-004', invoiceAmount: 5600, status: 'approved', workflowStage: 'completed', priority: 'normal', submittedAt: new Date(Date.now() - 345600000).toISOString(), branchName: 'Kisumu Branch' },
  { id: 'c5', claimNumber: 'CLM-2026-0029', patientName: 'Eve Achieng', memberNumber: 'MEM-7890', invoiceNumber: 'INV-005', invoiceAmount: 18900, status: 'submitted', workflowStage: 'initial_review', priority: 'normal', submittedAt: new Date(Date.now() - 432000000).toISOString(), branchName: 'Kisumu Branch' },
]

// ── Helper ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400',
  high:   'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
  normal: 'text-muted-foreground',
  low:    'text-muted-foreground/60',
}

const ACTION_STATUSES = ['rejected', 'incomplete']

// ── Component ──────────────────────────────────────────────────────────────

export default function ProviderDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const isProviderAdmin = user?.role === 'provider_admin'
  const isBranchUser = user?.role === 'provider_user'
  const hasBranchAssignment = !!(user as any)?.branchId

  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null)
  const [branches, setBranches] = useState<BranchSummary[]>(isProviderAdmin ? DEMO_BRANCHES : [])
  const [claims, setClaims] = useState<ClaimRow[]>(DEMO_CLAIMS)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [resubmitClaim, setResubmitClaim] = useState<ClaimRow | null>(null)
  const [resubmitNotes, setResubmitNotes] = useState('')
  const [resubmitFiles, setResubmitFiles] = useState<File[]>([])
  const [resubmitting, setResubmitting] = useState(false)
  const [resubmitError, setResubmitError] = useState<string | null>(null)

  const [uploadDocDialog, setUploadDocDialog] = useState(false)
  const [uploadDocFile, setUploadDocFile] = useState<File | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadDocError, setUploadDocError] = useState<string | null>(null)

  // A3: claim search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('all')
  const [searchDateFrom, setSearchDateFrom] = useState('')
  const [searchDateTo, setSearchDateTo] = useState('')

  // A3: statement download
  const [statementMonth, setStatementMonth] = useState(new Date().toISOString().slice(0, 7))
  const [statementLoading, setStatementLoading] = useState(false)

  const isApproved = providerInfo?.approvalStatus === 'approved' && providerInfo?.canSubmitClaims
  const isRejected = providerInfo?.approvalStatus === 'rejected'
  const isPendingApproval = providerInfo && !isApproved && !isRejected

  const handleUploadProofDoc = async () => {
    if (!uploadDocFile) return
    setUploadingDoc(true)
    setUploadDocError(null)
    try {
      const fd = new FormData()
      fd.append('proofDocument', uploadDocFile)
      const { data: updated } = await api.post('/providers/self-service/proof-document', fd)
      setProviderInfo((prev) => prev ? { ...prev, ...updated } : prev)
      setUploadDocDialog(false)
      setUploadDocFile(null)
    } catch (e: any) {
      setUploadDocError(e?.response?.data?.message ?? e?.message ?? 'Upload failed')
    } finally {
      setUploadingDoc(false)
    }
  }

  const fetchData = useCallback(async () => {
    setRefreshing(true)
    try {
      // Fetch provider info if linked
      if (user?.providerId) {
        const { data: pData } = await api.get(`/providers/${user.providerId}`)
        setProviderInfo(pData)
      }

      // Fetch claims (filtered server-side for this provider/user)
      const { data: cData } = await api.get('/claims?limit=50')
      const list = Array.isArray(cData) ? cData : Array.isArray(cData?.claims) ? cData.claims : null
      if (list) setClaims(list)

      // Provider admin also fetches branches
      if (isProviderAdmin && user?.providerId) {
        const { data: bData } = await api.get(`/branches?providerId=${user.providerId}`)
        const bList = Array.isArray(bData) ? bData : Array.isArray(bData?.branches) ? bData.branches : null
        if (bList) setBranches(bList)
      }
    } catch { /* keep demo */ }
    setRefreshing(false)
  }, [user, isProviderAdmin])

  useEffect(() => { fetchData() }, [fetchData])

  const openResubmit = (claim: ClaimRow) => {
    setResubmitClaim(claim)
    setResubmitNotes('')
    setResubmitFiles([])
    setResubmitError(null)
  }

  const closeResubmit = () => {
    setResubmitClaim(null)
    setResubmitNotes('')
    setResubmitFiles([])
    setResubmitError(null)
    setResubmitting(false)
  }

  const submitResubmission = async () => {
    if (!resubmitClaim) return
    if (!resubmitNotes.trim()) {
      setResubmitError('Please describe what was corrected or supplied before resubmitting.')
      return
    }
    setResubmitting(true)
    setResubmitError(null)
    try {
      // 1. Upload any attached files to this claim first so reviewers see the
      //    supplied documents alongside the original submission.
      for (const file of resubmitFiles) {
        const fd = new FormData()
        fd.append('file', file)
        try {
          await api.post(`/documents/upload?claimId=${resubmitClaim.id}`, fd)
        } catch (e: any) {
          throw new Error(e?.response?.data?.message || `Failed to upload ${file.name}`)
        }
      }
      // 2. Flip the claim back to resubmitted so it re-enters the maker queue.
      await api.post('/workflow/provider/resubmit', { claimId: resubmitClaim.id, notes: resubmitNotes.trim() })
      closeResubmit()
      fetchData()
    } catch (e: any) {
      setResubmitError(e?.message || 'Unable to resubmit claim')
      setResubmitting(false)
    }
  }

  const downloadStatement = async (format: 'json' | 'csv') => {
    if (!user?.providerId) return
    setStatementLoading(true)
    try {
      const url = `/providers/${user.providerId}/statement?month=${statementMonth}&format=${format}`
      if (format === 'csv') {
        const { data } = await api.get(url, { responseType: 'blob' })
        const blob = new Blob([data], { type: 'text/csv' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `statement-${statementMonth}.csv`
        a.click()
      } else {
        const { data } = await api.get(url)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `statement-${statementMonth}.json`
        a.click()
      }
    } finally {
      setStatementLoading(false)
    }
  }

  const filteredClaims = claims.filter(c => {
    if (searchStatus !== 'all' && c.status !== searchStatus) return false
    if (searchDateFrom && new Date(c.submittedAt) < new Date(searchDateFrom)) return false
    if (searchDateTo && new Date(c.submittedAt) > new Date(searchDateTo)) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        c.claimNumber.toLowerCase().includes(q) ||
        (c.memberNumber ?? '').toLowerCase().includes(q) ||
        (c.patientName ?? '').toLowerCase().includes(q) ||
        (c.invoiceNumber ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalClaims     = claims.length
  const pendingClaims   = claims.filter(c => ['submitted', 'under_review'].includes(c.status)).length
  const approvedClaims  = claims.filter(c => ['approved', 'paid'].includes(c.status)).length
  const rejectedClaims  = claims.filter(c => c.status === 'rejected').length
  const incompleteClaims = claims.filter(c => c.status === 'incomplete').length
  const needsAction     = claims.filter(c => ACTION_STATUSES.includes(c.status))
  const totalAmount     = claims.reduce((s, c) => s + (c.invoiceAmount ?? 0), 0)
  const approvalRate    = totalClaims > 0 ? Math.round((approvedClaims / totalClaims) * 100) : 0
  const recentClaims    = [...claims].sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  ).slice(0, 10)

  // Determine dashboard label based on role + branch assignment
  const dashboardTitle = isProviderAdmin
    ? 'Provider Dashboard'
    : hasBranchAssignment
      ? 'My Branch Dashboard'
      : 'My Claims Dashboard'

  const dashboardDesc = providerInfo?.name
    ? `${providerInfo.name}${hasBranchAssignment && branches[0] ? ` · ${branches[0].name}` : ''}`
    : dashboardTitle === 'My Claims Dashboard'
      ? 'Invoice submissions for your provider'
      : 'Branch claims & activity'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{dashboardTitle}</h1>
          <p className="text-muted-foreground">{dashboardDesc}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => navigate('/batch-upload')}
            disabled={providerInfo != null && !isApproved}
            title={
              providerInfo && !isApproved
                ? 'Invoice upload is disabled until your provider account is approved'
                : undefined
            }
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload Invoices
          </Button>
        </div>
      </div>

      {/* Provider approval banner */}
      {providerInfo && !isApproved && (
        <div
          className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center ${
            isRejected
              ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
              : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 shrink-0 ${
              isRejected
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          />
          <div className="flex-1">
            <p
              className={`font-semibold ${
                isRejected
                  ? 'text-red-800 dark:text-red-300'
                  : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              {isRejected
                ? 'Registration declined — documents need attention'
                : 'Account pending approval'}
            </p>
            <p
              className={`text-sm mt-0.5 ${
                isRejected
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {isRejected && providerInfo.rejectionReason
                ? providerInfo.rejectionReason
                : isRejected
                ? 'Please upload updated documents for CIC staff to review.'
                : 'You can explore your dashboard, but invoice uploads are disabled until CIC staff approve your account.'}
              {providerInfo.proofDocumentName ? (
                <span className="block mt-1 text-xs opacity-80">
                  Current document on file: <strong>{providerInfo.proofDocumentName}</strong>
                </span>
              ) : (
                <span className="block mt-1 text-xs opacity-80">
                  No proof document uploaded yet.
                </span>
              )}
            </p>
          </div>
          {isProviderAdmin && (
            <Button
              size="sm"
              variant={isRejected ? 'default' : 'outline'}
              onClick={() => setUploadDocDialog(true)}
              className="shrink-0"
            >
              <Upload className="mr-1.5 h-3 w-3" />
              {providerInfo.proofDocumentName ? 'Replace document' : 'Upload document'}
            </Button>
          )}
        </div>
      )}

      {/* Action required banner */}
      {needsAction.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-800 dark:text-red-300">
              {needsAction.length} claim{needsAction.length !== 1 ? 's' : ''} require{needsAction.length === 1 ? 's' : ''} your attention
            </p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
              {claims.filter(c => c.status === 'rejected').length} rejected · {incompleteClaims} incomplete — review and resubmit
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300"
            onClick={() => setActiveTab('action')}>
            View all <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { title: 'Total Claims',  value: totalClaims,    icon: FileText,    color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-950/30' },
          { title: 'Approved',      value: approvedClaims, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
          { title: 'Pending Review',value: pendingClaims,  icon: Clock,       color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-950/30' },
          { title: 'Needs Action',  value: needsAction.length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' },
          { title: 'Total Invoiced',value: formatCurrency(totalAmount), icon: TrendingUp, color: 'text-primary', bg: 'bg-primary/5' },
        ].map(s => (
          <Card key={s.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
              <div className={`p-2 rounded-md ${s.bg}`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Approval rate bar */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Approval Rate</span>
            <span className={`text-sm font-bold ${approvalRate >= 80 ? 'text-emerald-600' : approvalRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
              {approvalRate}%
            </span>
          </div>
          <Progress value={approvalRate} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            {approvedClaims} approved out of {totalClaims} total submitted claims
          </p>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isProviderAdmin && branches.length > 0 && <TabsTrigger value="branches">Branches ({branches.length})</TabsTrigger>}
          <TabsTrigger value="action" className="relative">
            Needs Action
            {needsAction.length > 0 && (
              <Badge className="ml-1.5 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-red-500 text-white">
                {needsAction.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Claims</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Claims</CardTitle>
              <CardDescription>Latest 10 claims across your branches</CardDescription>
            </CardHeader>
            <CardContent>
              <ClaimsTable claims={recentClaims} showBranch={isProviderAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Branches tab (provider_admin with branches only) */}
        {isProviderAdmin && branches.length > 0 && (
          <TabsContent value="branches" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map(branch => (
                <Card key={branch.id} className={!branch.isActive ? 'opacity-60' : ''}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-600">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <CardTitle className="text-sm">{branch.name}</CardTitle>
                          <p className="text-[10px] font-mono text-muted-foreground">{branch.code}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        {branch.isActive
                          ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>
                          : <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                        }
                        {!branch.isApproved && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-700">Pending</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />{branch.region}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">Claims</p>
                        <p className="font-bold text-sm">{branch.claimsCount}</p>
                      </div>
                      <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-2">
                        <p className="text-xs text-muted-foreground">Pending</p>
                        <p className="font-bold text-sm text-amber-600">{branch.pendingClaims}</p>
                      </div>
                      <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-2">
                        <p className="text-xs text-muted-foreground">Rejected</p>
                        <p className="font-bold text-sm text-red-600">{branch.rejectedClaims}</p>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Approval rate</span>
                        <span className={`font-semibold ${branch.approvalRate >= 80 ? 'text-emerald-600' : branch.approvalRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                          {branch.approvalRate}%
                        </span>
                      </div>
                      <Progress value={branch.approvalRate} className="h-1.5" />
                    </div>
                    {branch.lastActivity && (
                      <p className="text-[10px] text-muted-foreground">
                        Last activity: {formatDate(branch.lastActivity)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
              {branches.length === 0 && (
                <div className="col-span-3 text-center text-muted-foreground py-12">
                  No branches registered yet
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* Needs Action tab */}
        <TabsContent value="action" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Claims Requiring Action</CardTitle>
              <CardDescription>
                Rejected or incomplete claims — review and resubmit to continue processing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {needsAction.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <CheckCircle className="h-8 w-8 text-emerald-500" />
                  <p className="font-medium">No claims need action right now</p>
                  <p className="text-sm">All submitted claims are being processed</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {needsAction.map(claim => (
                    <div key={claim.id}
                      className={`rounded-lg border p-4 ${claim.status === 'rejected' ? 'border-red-200 bg-red-50 dark:bg-red-950/10' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/10'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{claim.claimNumber}</span>
                            <Badge className={getStatusColor(claim.status)} variant="secondary">
                              {claim.status === 'rejected' ? 'Rejected' : 'Incomplete'}
                            </Badge>
                            {claim.priority !== 'normal' && (
                              <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[claim.priority]}`}>
                                {claim.priority}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm">{claim.patientName} · {claim.memberNumber}</p>
                          {isProviderAdmin && claim.branchName && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building2 className="h-3 w-3" /> {claim.branchName}
                            </p>
                          )}
                          {claim.rejectionReason && (
                            <div className={`mt-2 rounded-md px-3 py-2 text-xs ${claim.status === 'rejected' ? 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300' : 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'}`}>
                              <span className="font-semibold">
                                {claim.status === 'rejected' ? 'Reason: ' : 'Message: '}
                              </span>
                              {claim.rejectionReason}
                            </div>
                          )}
                          {claim.status === 'incomplete' && claim.missingDocuments && claim.missingDocuments.length > 0 && (
                            <div className="mt-2 rounded-md px-3 py-2 text-xs bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300">
                              <p className="font-semibold mb-1">Required documents ({claim.missingDocuments.length}):</p>
                              <ul className="list-disc list-inside space-y-0.5">
                                {claim.missingDocuments.map(d => <li key={d}>{d}</li>)}
                              </ul>
                            </div>
                          )}
                          {(claim.resubmissionCount ?? 0) > 0 && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Previously resubmitted {claim.resubmissionCount} time{claim.resubmissionCount !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {claim.invoiceAmount && (
                            <p className="font-semibold text-sm">{formatCurrency(claim.invoiceAmount)}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{formatDate(claim.submittedAt)}</p>
                          {claim.status === 'incomplete' ? (
                            <Button size="sm" variant="outline" className="mt-2 gap-1.5"
                              onClick={() => openResubmit(claim)}>
                              <RotateCcw className="h-3 w-3" /> Action & Resubmit
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="mt-2 gap-1.5"
                              onClick={() => navigate('/batch-upload')}>
                              <Upload className="h-3 w-3" /> New Submission
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* A3: Claim search tab */}
        <TabsContent value="search" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Search Claims</CardTitle>
              <CardDescription>Filter by status, date range, member, or invoice</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-8 text-xs"
                    placeholder="Claim #, member, patient, invoice…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <Select value={searchStatus} onValueChange={setSearchStatus}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="under_review">Under review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="incomplete">Incomplete</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={searchDateFrom} onChange={e => setSearchDateFrom(e.target.value)} className="w-36 h-8 text-xs" />
                <Input type="date" value={searchDateTo} onChange={e => setSearchDateTo(e.target.value)} className="w-36 h-8 text-xs" />
              </div>
              <ClaimsTable claims={filteredClaims} showBranch={isProviderAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* A3: Statement download tab */}
        <TabsContent value="statement" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Monthly Statement</CardTitle>
              <CardDescription>Download approved/paid claims for a given month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  type="month"
                  value={statementMonth}
                  onChange={e => setStatementMonth(e.target.value)}
                  className="w-40 h-8 text-xs"
                />
                <Button size="sm" variant="outline" disabled={statementLoading} onClick={() => downloadStatement('csv')}>
                  {statementLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />}
                  Download CSV
                </Button>
                <Button size="sm" variant="outline" disabled={statementLoading} onClick={() => downloadStatement('json')}>
                  {statementLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  Download JSON
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Includes all claims with status "approved" or "paid" in the selected month, based on approval date.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Resubmit Dialog */}
        <Dialog open={!!resubmitClaim} onOpenChange={(o) => !o && closeResubmit()}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Action & Resubmit Claim</DialogTitle>
              <DialogDescription>
                {resubmitClaim?.claimNumber} — {resubmitClaim?.patientName || resubmitClaim?.memberNumber}
              </DialogDescription>
            </DialogHeader>
            {resubmitClaim && (
              <div className="space-y-3 text-sm">
                {resubmitClaim.branchName && (
                  <div className="rounded-md bg-muted/50 p-2 flex items-center gap-2 text-xs">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Submitting from branch: <span className="font-medium">{resubmitClaim.branchName}</span>
                  </div>
                )}
                {resubmitClaim.rejectionReason && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-2.5">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Reviewer message</p>
                    <p className="text-xs mt-0.5">{resubmitClaim.rejectionReason}</p>
                  </div>
                )}
                {resubmitClaim.missingDocuments && resubmitClaim.missingDocuments.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Required documents</p>
                    <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                      {resubmitClaim.missingDocuments.map(d => <li key={d}>{d}</li>)}
                    </ul>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold" htmlFor="resubmit-notes">
                    What was corrected or supplied? <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="resubmit-notes"
                    className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                    rows={3}
                    placeholder="e.g. Attached lab results, corrected member number…"
                    value={resubmitNotes}
                    onChange={(e) => setResubmitNotes(e.target.value)}
                    disabled={resubmitting}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" htmlFor="resubmit-files">
                    Attach additional documents (optional)
                  </label>
                  <input
                    id="resubmit-files"
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                    className="mt-1 block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
                    onChange={(e) => setResubmitFiles(Array.from(e.target.files || []))}
                    disabled={resubmitting}
                  />
                  {resubmitFiles.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {resubmitFiles.map((f, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" />{f.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {resubmitError && (
                  <p className="text-xs text-red-600">{resubmitError}</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={closeResubmit} disabled={resubmitting}>Cancel</Button>
              <Button onClick={submitResubmission} disabled={resubmitting} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                {resubmitting ? 'Resubmitting…' : `Resubmit Claim${resubmitFiles.length > 0 ? ` + ${resubmitFiles.length} file${resubmitFiles.length !== 1 ? 's' : ''}` : ''}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* All Claims tab */}
        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Claims</CardTitle>
              <CardDescription>{claims.length} total claims</CardDescription>
            </CardHeader>
            <CardContent>
              <ClaimsTable claims={claims} showBranch={isProviderAdmin} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Self-service proof-document upload */}
      <Dialog
        open={uploadDocDialog}
        onOpenChange={(v) => {
          if (!v) {
            setUploadDocDialog(false)
            setUploadDocFile(null)
            setUploadDocError(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {providerInfo?.proofDocumentName ? 'Replace proof document' : 'Upload proof document'}
            </DialogTitle>
            <DialogDescription>
              Upload your company registration / KRA PIN / business licence. CIC staff
              will review the document and approve your account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {providerInfo?.proofDocumentName && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p className="text-muted-foreground">Currently on file:</p>
                <p className="font-medium truncate">{providerInfo.proofDocumentName}</p>
              </div>
            )}

            <label
              htmlFor="self-proof-doc"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary hover:bg-muted/20 transition-colors"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {uploadDocFile ? uploadDocFile.name : 'Click to choose a file'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                PDF, PNG, JPG — max 10 MB
              </p>
              <input
                id="self-proof-doc"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => setUploadDocFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {uploadDocError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {uploadDocError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDocDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadProofDoc} disabled={!uploadDocFile || uploadingDoc}>
              {uploadingDoc ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Shared claims table ────────────────────────────────────────────────────

function ClaimsTable({ claims, showBranch }: { claims: ClaimRow[]; showBranch: boolean }) {
  if (claims.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-10">No claims to display</div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Claim #</TableHead>
          <TableHead>Patient</TableHead>
          {showBranch && <TableHead>Branch</TableHead>}
          <TableHead>Invoice</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {claims.map(claim => (
          <TableRow key={claim.id}>
            <TableCell className="font-mono text-xs">{claim.claimNumber}</TableCell>
            <TableCell>
              <p className="text-sm font-medium">{claim.patientName || '—'}</p>
              <p className="text-xs text-muted-foreground">{claim.memberNumber}</p>
            </TableCell>
            {showBranch && (
              <TableCell>
                <p className="text-xs">{claim.branchName || '—'}</p>
              </TableCell>
            )}
            <TableCell className="text-xs text-muted-foreground">{claim.invoiceNumber || '—'}</TableCell>
            <TableCell className="text-sm font-medium">
              {claim.invoiceAmount ? formatCurrency(claim.invoiceAmount) : '—'}
            </TableCell>
            <TableCell>
              <Badge className={getStatusColor(claim.status)} variant="secondary">
                {claim.status.replace(/_/g, ' ')}
              </Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(claim.submittedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
