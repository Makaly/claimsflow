import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuthStore } from '@/store/authStore'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PreAuth {
  id: string
  referenceNumber: string
  providerId: string
  memberNumber: string
  memberName?: string
  treatmentType: string
  diagnosisCode?: string
  estimatedAmount: number
  requestedBy: string
  status: string
  reviewedBy?: string
  reviewedAt?: string
  approvedAmount?: number
  validFrom?: string
  validTo?: string
  conditions?: string
  rejectionReason?: string
  linkedClaimId?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:      'bg-yellow-100 text-yellow-800',
  approved:     'bg-green-100 text-green-800',
  rejected:     'bg-red-100 text-red-800',
  under_review: 'bg-blue-100 text-blue-800',
}

const STATUS_ICONS: Record<string, JSX.Element> = {
  pending:      <Clock className="h-3.5 w-3.5" />,
  approved:     <CheckCircle className="h-3.5 w-3.5" />,
  rejected:     <XCircle className="h-3.5 w-3.5" />,
  under_review: <AlertCircle className="h-3.5 w-3.5" />,
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'
  const icon  = STATUS_ICONS[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {icon}
      {status.replace('_', ' ')}
    </span>
  )
}

function fmtKES(n: number) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PreAuth() {
  const { user } = useAuthStore()

  // List state
  const [items, setItems]           = useState<PreAuth[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [memberSearch, setMemberSearch] = useState('')
  const [activeTab, setActiveTab]   = useState('requests')

  // Review dialog state
  const [reviewing, setReviewing]         = useState<PreAuth | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved')
  const [approvedAmount, setApprovedAmount] = useState('')
  const [conditions, setConditions]         = useState('')
  const [validDays, setValidDays]           = useState('30')
  const [rejectionReason, setRejectionReason] = useState('')
  const [reviewSaving, setReviewSaving]     = useState(false)

  // New request form state
  const [form, setForm] = useState({
    memberNumber:    '',
    memberName:      '',
    treatmentType:   '',
    diagnosisCode:   '',
    estimatedAmount: '',
    notes:           '',
  })
  const [submitting, setSubmitting] = useState(false)

  const isStaff    = ['admin', 'supervisor'].includes(user?.role ?? '')
  const isProvider = ['provider_admin', 'provider_user'].includes(user?.role ?? '')

  // ── Fetch list ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (memberSearch.trim())    params.set('memberNumber', memberSearch.trim())
      const { data } = await api.get(`/pre-auth?${params}`)
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch {
      toast.error('Failed to load pre-authorisations')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, memberSearch])

  useEffect(() => { load() }, [load])

  // ── Review dialog ───────────────────────────────────────────────────────────

  function openReview(pa: PreAuth, decision: 'approved' | 'rejected') {
    setReviewing(pa)
    setReviewDecision(decision)
    setApprovedAmount(pa.estimatedAmount.toString())
    setConditions('')
    setValidDays('30')
    setRejectionReason('')
  }

  async function submitReview() {
    if (!reviewing) return
    if (reviewDecision === 'approved' && !approvedAmount) {
      toast.error('Approved amount is required')
      return
    }
    if (reviewDecision === 'rejected' && !rejectionReason.trim()) {
      toast.error('Rejection reason is required')
      return
    }
    setReviewSaving(true)
    try {
      await api.patch(`/pre-auth/${reviewing.id}/review`, {
        decision: reviewDecision,
        approvedAmount: reviewDecision === 'approved' ? parseFloat(approvedAmount) : undefined,
        conditions:     reviewDecision === 'approved' ? conditions || undefined : undefined,
        validDays:      reviewDecision === 'approved' ? parseInt(validDays) || 30 : undefined,
        rejectionReason: reviewDecision === 'rejected' ? rejectionReason : undefined,
      })
      toast.success(`Pre-authorisation ${reviewDecision}`)
      setReviewing(null)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to submit review')
    } finally {
      setReviewSaving(false)
    }
  }

  // ── New request form ────────────────────────────────────────────────────────

  function handleFormChange(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function submitRequest() {
    if (!form.memberNumber.trim()) { toast.error('Member number is required'); return }
    if (!form.treatmentType.trim()) { toast.error('Treatment type is required'); return }
    if (!form.estimatedAmount || isNaN(parseFloat(form.estimatedAmount))) {
      toast.error('Valid estimated amount is required'); return
    }
    // Providers supply their own providerId via the backend (from JWT); staff need one too.
    // For staff, we require a non-empty providerId field or just pass a placeholder:
    setSubmitting(true)
    try {
      await api.post('/pre-auth', {
        providerId:      user?.providerId ?? user?.id ?? 'N/A',
        memberNumber:    form.memberNumber.trim(),
        memberName:      form.memberName.trim() || undefined,
        treatmentType:   form.treatmentType.trim(),
        diagnosisCode:   form.diagnosisCode.trim() || undefined,
        estimatedAmount: parseFloat(form.estimatedAmount),
        notes:           form.notes.trim() || undefined,
      })
      toast.success('Pre-authorisation request submitted')
      setForm({ memberNumber: '', memberName: '', treatmentType: '', diagnosisCode: '', estimatedAmount: '', notes: '' })
      setActiveTab('requests')
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Summary counts ──────────────────────────────────────────────────────────

  const pendingCount  = items.filter(i => i.status === 'pending').length
  const approvedCount = items.filter(i => i.status === 'approved').length
  const rejectedCount = items.filter(i => i.status === 'rejected').length

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-600" /> Pre-Authorisations
          </h1>
          <p className="text-gray-500 text-sm mt-1">{total} total records</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">{pendingCount}</div>
              <div className="text-xs text-gray-500">Pending</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{approvedCount}</div>
              <div className="text-xs text-gray-500">Approved</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="h-8 w-8 text-red-400" />
            <div>
              <div className="text-2xl font-bold">{rejectedCount}</div>
              <div className="text-xs text-gray-500">Rejected</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="new">New Request</TabsTrigger>
        </TabsList>

        {/* ── Requests tab ── */}
        <TabsContent value="requests" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base flex-1">All Pre-Authorisations</CardTitle>
                {/* Status filter */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40 h-8 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                {/* Member search */}
                <Input
                  className="h-8 w-44 text-xs"
                  placeholder="Search member no."
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                />
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference #</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Treatment</TableHead>
                    <TableHead>Est. Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Valid Until</TableHead>
                    {isStaff && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isStaff ? 8 : 7} className="text-center text-gray-400 py-8">
                        No pre-authorisations found
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map(pa => (
                    <TableRow key={pa.id}>
                      <TableCell className="font-mono text-xs font-medium">{pa.referenceNumber}</TableCell>
                      <TableCell className="text-xs text-gray-600 max-w-[120px] truncate">{pa.providerId}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{pa.memberNumber}</div>
                        {pa.memberName && <div className="text-xs text-gray-500">{pa.memberName}</div>}
                      </TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate" title={pa.treatmentType}>
                        {pa.treatmentType}
                      </TableCell>
                      <TableCell className="text-sm">{fmtKES(pa.estimatedAmount)}</TableCell>
                      <TableCell><StatusBadge status={pa.status} /></TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {pa.validTo ? formatDate(pa.validTo) : '—'}
                      </TableCell>
                      {isStaff && (
                        <TableCell>
                          {(pa.status === 'pending' || pa.status === 'under_review') ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                                onClick={() => openReview(pa, 'approved')}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                                onClick={() => openReview(pa, 'rejected')}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── New Request tab ── */}
        <TabsContent value="new" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Submit New Pre-Authorisation Request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pa-member-number">Member Number <span className="text-red-500">*</span></Label>
                  <Input
                    id="pa-member-number"
                    placeholder="e.g. CIC/2024/001234"
                    value={form.memberNumber}
                    onChange={e => handleFormChange('memberNumber', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pa-member-name">Member Name</Label>
                  <Input
                    id="pa-member-name"
                    placeholder="Full name"
                    value={form.memberName}
                    onChange={e => handleFormChange('memberName', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pa-treatment">Treatment Type <span className="text-red-500">*</span></Label>
                <Input
                  id="pa-treatment"
                  placeholder="e.g. Elective surgery — knee replacement"
                  value={form.treatmentType}
                  onChange={e => handleFormChange('treatmentType', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pa-diagnosis">Diagnosis Code</Label>
                  <Input
                    id="pa-diagnosis"
                    placeholder="e.g. M17.1"
                    value={form.diagnosisCode}
                    onChange={e => handleFormChange('diagnosisCode', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pa-amount">Estimated Amount (KES) <span className="text-red-500">*</span></Label>
                  <Input
                    id="pa-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.estimatedAmount}
                    onChange={e => handleFormChange('estimatedAmount', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pa-notes">Notes</Label>
                <Textarea
                  id="pa-notes"
                  placeholder="Additional clinical notes or justification…"
                  rows={3}
                  value={form.notes}
                  onChange={e => handleFormChange('notes', e.target.value)}
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={submitRequest} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Review dialog ── */}
      <Dialog open={!!reviewing} onOpenChange={open => !open && setReviewing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewDecision === 'approved' ? 'Approve' : 'Reject'} Pre-Authorisation
              {reviewing && ` — ${reviewing.referenceNumber}`}
            </DialogTitle>
          </DialogHeader>

          {reviewing && (
            <div className="space-y-4 pt-2">
              {/* Summary */}
              <div className="p-3 bg-gray-50 rounded text-sm space-y-1">
                <div><span className="font-medium">Member:</span> {reviewing.memberNumber}{reviewing.memberName ? ` — ${reviewing.memberName}` : ''}</div>
                <div><span className="font-medium">Treatment:</span> {reviewing.treatmentType}</div>
                <div><span className="font-medium">Estimated:</span> {fmtKES(reviewing.estimatedAmount)}</div>
              </div>

              {reviewDecision === 'approved' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-amount">Approved Amount (KES) <span className="text-red-500">*</span></Label>
                    <Input
                      id="rev-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={approvedAmount}
                      onChange={e => setApprovedAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-valid-days">Valid for (days)</Label>
                    <Input
                      id="rev-valid-days"
                      type="number"
                      min="1"
                      max="365"
                      value={validDays}
                      onChange={e => setValidDays(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rev-conditions">Conditions / Remarks</Label>
                    <Textarea
                      id="rev-conditions"
                      placeholder="Any conditions attached to this approval…"
                      rows={2}
                      value={conditions}
                      onChange={e => setConditions(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="rev-rejection">Rejection Reason <span className="text-red-500">*</span></Label>
                  <Textarea
                    id="rev-rejection"
                    placeholder="Explain why this request is being rejected…"
                    rows={3}
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
                <Button
                  onClick={submitReview}
                  disabled={reviewSaving}
                  className={reviewDecision === 'rejected' ? 'bg-red-600 hover:bg-red-700' : ''}
                >
                  {reviewSaving
                    ? 'Saving…'
                    : reviewDecision === 'approved'
                      ? 'Confirm Approval'
                      : 'Confirm Rejection'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
