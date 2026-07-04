import { useState, useEffect, useCallback } from 'react'
import { Shield, RefreshCw, Plus, Pencil, PowerOff, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import api from '@/services/api'
import { toast } from 'sonner'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PolicyPlan {
  id: string
  planCode: string
  planName: string
  description?: string | null
  inpatientLimit: number
  outpatientLimit: number
  dentalLimit: number
  opticalLimit: number
  maternityLimit: number
  copayPercent: number
  excessAmount: number
  isActive: boolean
  validFrom?: string | null
  validTo?: string | null
  createdAt: string
  updatedAt: string
  _count?: { memberPolicies: number }
}

interface MemberPolicy {
  id: string
  memberNumber: string
  memberName: string
  planId: string
  policyStartDate: string
  policyEndDate: string
  inpatientUsed: number
  outpatientUsed: number
  dentalUsed: number
  opticalUsed: number
  maternityUsed: number
  isActive: boolean
  plan: PolicyPlan
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtKES(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'KES 0'
  return `KES ${Number(n).toLocaleString('en-KE')}`
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('en-KE')
  } catch {
    return '—'
  }
}

function emptyPlanForm() {
  return {
    planCode: '',
    planName: '',
    description: '',
    inpatientLimit: '0',
    outpatientLimit: '0',
    dentalLimit: '0',
    opticalLimit: '0',
    maternityLimit: '0',
    copayPercent: '0',
    excessAmount: '0',
    validFrom: '',
    validTo: '',
  }
}

function emptyMemberForm() {
  return {
    memberNumber: '',
    memberName: '',
    planId: '',
    policyStartDate: '',
    policyEndDate: '',
  }
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function PolicyPlans() {
  const [tab, setTab] = useState('plans')

  // Plans state
  const [plans, setPlans] = useState<PolicyPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PolicyPlan | null>(null)
  const [planForm, setPlanForm] = useState(emptyPlanForm())
  const [planSaving, setPlanSaving] = useState(false)

  // Members state
  const [members, setMembers] = useState<MemberPolicy[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberPlanFilter, setMemberPlanFilter] = useState('all')
  const [memberDialogOpen, setMemberDialogOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<MemberPolicy | null>(null)
  const [memberForm, setMemberForm] = useState(emptyMemberForm())
  const [memberSaving, setMemberSaving] = useState(false)

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    try {
      const { data } = await api.get('/policy/plans')
      setPlans(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Failed to load policy plans')
    } finally {
      setPlansLoading(false)
    }
  }, [])

  const loadMembers = useCallback(async () => {
    setMembersLoading(true)
    try {
      const params = new URLSearchParams()
      if (memberSearch.trim()) params.set('search', memberSearch.trim())
      if (memberPlanFilter !== 'all') params.set('planId', memberPlanFilter)
      const { data } = await api.get(`/policy/members?${params}`)
      setMembers(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Failed to load member policies')
    } finally {
      setMembersLoading(false)
    }
  }, [memberSearch, memberPlanFilter])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  useEffect(() => {
    if (tab === 'members') loadMembers()
  }, [tab, loadMembers])

  // ── Plan dialog handlers ──────────────────────────────────────────────────

  function openNewPlan() {
    setEditingPlan(null)
    setPlanForm(emptyPlanForm())
    setPlanDialogOpen(true)
  }

  function openEditPlan(plan: PolicyPlan) {
    setEditingPlan(plan)
    setPlanForm({
      planCode: plan.planCode,
      planName: plan.planName,
      description: plan.description ?? '',
      inpatientLimit: String(plan.inpatientLimit),
      outpatientLimit: String(plan.outpatientLimit),
      dentalLimit: String(plan.dentalLimit),
      opticalLimit: String(plan.opticalLimit),
      maternityLimit: String(plan.maternityLimit),
      copayPercent: String(plan.copayPercent),
      excessAmount: String(plan.excessAmount),
      validFrom: plan.validFrom ? plan.validFrom.slice(0, 10) : '',
      validTo: plan.validTo ? plan.validTo.slice(0, 10) : '',
    })
    setPlanDialogOpen(true)
  }

  async function savePlan() {
    if (!planForm.planCode.trim() || !planForm.planName.trim()) {
      toast.error('Plan code and name are required')
      return
    }
    setPlanSaving(true)
    try {
      const payload: any = {
        planCode: planForm.planCode.trim(),
        planName: planForm.planName.trim(),
        description: planForm.description.trim() || null,
        inpatientLimit: parseFloat(planForm.inpatientLimit) || 0,
        outpatientLimit: parseFloat(planForm.outpatientLimit) || 0,
        dentalLimit: parseFloat(planForm.dentalLimit) || 0,
        opticalLimit: parseFloat(planForm.opticalLimit) || 0,
        maternityLimit: parseFloat(planForm.maternityLimit) || 0,
        copayPercent: parseFloat(planForm.copayPercent) || 0,
        excessAmount: parseFloat(planForm.excessAmount) || 0,
        validFrom: planForm.validFrom ? new Date(planForm.validFrom).toISOString() : null,
        validTo: planForm.validTo ? new Date(planForm.validTo).toISOString() : null,
      }
      if (editingPlan) {
        await api.patch(`/policy/plans/${editingPlan.id}`, payload)
        toast.success('Plan updated')
      } else {
        await api.post('/policy/plans', payload)
        toast.success('Plan created')
      }
      setPlanDialogOpen(false)
      loadPlans()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save plan')
    } finally {
      setPlanSaving(false)
    }
  }

  async function deactivatePlan(id: string) {
    if (!confirm('Deactivate this plan? Existing member policies will be unaffected.')) return
    try {
      await api.patch(`/policy/plans/${id}/deactivate`)
      toast.success('Plan deactivated')
      loadPlans()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to deactivate plan')
    }
  }

  // ── Member dialog handlers ────────────────────────────────────────────────

  function openNewMember() {
    setEditingMember(null)
    setMemberForm({
      ...emptyMemberForm(),
      planId: plans.find(p => p.isActive)?.id ?? '',
    })
    setMemberDialogOpen(true)
  }

  function openEditMember(m: MemberPolicy) {
    setEditingMember(m)
    setMemberForm({
      memberNumber: m.memberNumber,
      memberName: m.memberName,
      planId: m.planId,
      policyStartDate: m.policyStartDate.slice(0, 10),
      policyEndDate: m.policyEndDate.slice(0, 10),
    })
    setMemberDialogOpen(true)
  }

  async function saveMember() {
    if (!memberForm.memberNumber.trim() || !memberForm.memberName.trim()) {
      toast.error('Member number and name are required')
      return
    }
    if (!memberForm.planId) {
      toast.error('Please select a plan')
      return
    }
    if (!memberForm.policyStartDate || !memberForm.policyEndDate) {
      toast.error('Policy start and end dates are required')
      return
    }
    setMemberSaving(true)
    try {
      const payload = {
        memberNumber: memberForm.memberNumber.trim(),
        memberName: memberForm.memberName.trim(),
        planId: memberForm.planId,
        policyStartDate: memberForm.policyStartDate,
        policyEndDate: memberForm.policyEndDate,
      }
      if (editingMember) {
        await api.patch(`/policy/members/${editingMember.id}`, payload)
        toast.success('Member updated')
      } else {
        await api.post('/policy/members', payload)
        toast.success('Member registered')
      }
      setMemberDialogOpen(false)
      loadMembers()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save member')
    } finally {
      setMemberSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" /> Policy Plans & Members
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage benefit plans and member registrations powering the adjudication engine
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Plans ({plans.length})</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        {/* ── Plans tab ── */}
        <TabsContent value="plans" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base flex-1">Benefit Plans</CardTitle>
                <Button variant="outline" size="sm" onClick={loadPlans} disabled={plansLoading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${plansLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" onClick={openNewPlan}>
                  <Plus className="h-4 w-4 mr-1" /> New Plan
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Plan Name</TableHead>
                    <TableHead className="text-right">Inpatient</TableHead>
                    <TableHead className="text-right">Outpatient</TableHead>
                    <TableHead className="text-right">Dental</TableHead>
                    <TableHead className="text-right">Optical</TableHead>
                    <TableHead className="text-right">Maternity</TableHead>
                    <TableHead className="text-right">Co-pay</TableHead>
                    <TableHead className="text-right">Excess</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center text-gray-400 py-8">
                        No policy plans defined yet — click "New Plan" to create one
                      </TableCell>
                    </TableRow>
                  )}
                  {plans.map(plan => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono text-xs">{plan.planCode}</TableCell>
                      <TableCell className="font-medium">
                        {plan.planName}
                        {plan.description && (
                          <div className="text-xs text-gray-500 max-w-[200px] truncate">
                            {plan.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.inpatientLimit)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.outpatientLimit)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.dentalLimit)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.opticalLimit)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.maternityLimit)}</TableCell>
                      <TableCell className="text-right text-xs">{plan.copayPercent}%</TableCell>
                      <TableCell className="text-right text-xs">{fmtKES(plan.excessAmount)}</TableCell>
                      <TableCell>
                        {plan.isActive ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {plan._count?.memberPolicies ?? 0}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openEditPlan(plan)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {plan.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-600"
                              onClick={() => deactivatePlan(plan.id)}
                              title="Deactivate"
                            >
                              <PowerOff className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Members tab ── */}
        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base flex-1">Member Policies</CardTitle>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    className="h-8 w-56 text-xs pl-7"
                    placeholder="Search member # or name"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                  />
                </div>
                <Select value={memberPlanFilter} onValueChange={setMemberPlanFilter}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue placeholder="Plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All plans</SelectItem>
                    {plans.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.planName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={loadMembers} disabled={membersLoading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${membersLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" onClick={openNewMember} disabled={plans.length === 0}>
                  <Plus className="h-4 w-4 mr-1" /> Register Member
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member #</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Inpatient (Used / Limit)</TableHead>
                    <TableHead>Outpatient (Used / Limit)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-8">
                        No member policies found
                      </TableCell>
                    </TableRow>
                  )}
                  {members.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs font-medium">{m.memberNumber}</TableCell>
                      <TableCell>{m.memberName}</TableCell>
                      <TableCell className="text-xs">{m.plan.planName}</TableCell>
                      <TableCell className="text-xs">{fmtDate(m.policyStartDate)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(m.policyEndDate)}</TableCell>
                      <TableCell className="text-xs">
                        {fmtKES(m.inpatientUsed)} / {fmtKES(m.plan.inpatientLimit)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {fmtKES(m.outpatientUsed)} / {fmtKES(m.plan.outpatientLimit)}
                      </TableCell>
                      <TableCell>
                        {m.isActive ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEditMember(m)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Plan dialog ── */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Edit Policy Plan' : 'New Policy Plan'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-code">
                Plan Code <span className="text-red-500">*</span>
              </Label>
              <Input
                id="plan-code"
                placeholder="e.g. SILVER-2026"
                value={planForm.planCode}
                onChange={e => setPlanForm({ ...planForm, planCode: e.target.value })}
                disabled={!!editingPlan}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">
                Plan Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="plan-name"
                placeholder="Silver Cover 2026"
                value={planForm.planName}
                onChange={e => setPlanForm({ ...planForm, planName: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="plan-desc">Description</Label>
              <Textarea
                id="plan-desc"
                rows={2}
                placeholder="Optional plan description"
                value={planForm.description}
                onChange={e => setPlanForm({ ...planForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim-inp">Inpatient Limit (KES)</Label>
              <Input
                id="lim-inp"
                type="number"
                min="0"
                value={planForm.inpatientLimit}
                onChange={e => setPlanForm({ ...planForm, inpatientLimit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim-out">Outpatient Limit (KES)</Label>
              <Input
                id="lim-out"
                type="number"
                min="0"
                value={planForm.outpatientLimit}
                onChange={e => setPlanForm({ ...planForm, outpatientLimit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim-dental">Dental Limit (KES)</Label>
              <Input
                id="lim-dental"
                type="number"
                min="0"
                value={planForm.dentalLimit}
                onChange={e => setPlanForm({ ...planForm, dentalLimit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim-optical">Optical Limit (KES)</Label>
              <Input
                id="lim-optical"
                type="number"
                min="0"
                value={planForm.opticalLimit}
                onChange={e => setPlanForm({ ...planForm, opticalLimit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim-mat">Maternity Limit (KES)</Label>
              <Input
                id="lim-mat"
                type="number"
                min="0"
                value={planForm.maternityLimit}
                onChange={e => setPlanForm({ ...planForm, maternityLimit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copay">Co-pay (%)</Label>
              <Input
                id="copay"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={planForm.copayPercent}
                onChange={e => setPlanForm({ ...planForm, copayPercent: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="excess">Excess (KES)</Label>
              <Input
                id="excess"
                type="number"
                min="0"
                value={planForm.excessAmount}
                onChange={e => setPlanForm({ ...planForm, excessAmount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valid-from">Valid From</Label>
              <Input
                id="valid-from"
                type="date"
                value={planForm.validFrom}
                onChange={e => setPlanForm({ ...planForm, validFrom: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valid-to">Valid To</Label>
              <Input
                id="valid-to"
                type="date"
                value={planForm.validTo}
                onChange={e => setPlanForm({ ...planForm, validTo: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePlan} disabled={planSaving}>
              {planSaving ? 'Saving…' : editingPlan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Member dialog ── */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingMember ? 'Edit Member Policy' : 'Register Member'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="mem-num">
                Member Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mem-num"
                placeholder="CIC/2026/001234"
                value={memberForm.memberNumber}
                onChange={e => setMemberForm({ ...memberForm, memberNumber: e.target.value })}
                disabled={!!editingMember}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-name">
                Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mem-name"
                placeholder="Jane Doe"
                value={memberForm.memberName}
                onChange={e => setMemberForm({ ...memberForm, memberName: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="mem-plan">
                Plan <span className="text-red-500">*</span>
              </Label>
              <Select
                value={memberForm.planId}
                onValueChange={v => setMemberForm({ ...memberForm, planId: v })}
              >
                <SelectTrigger id="mem-plan">
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    .filter(p => p.isActive || p.id === memberForm.planId)
                    .map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.planName} ({p.planCode})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-start">
                Start Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mem-start"
                type="date"
                value={memberForm.policyStartDate}
                onChange={e => setMemberForm({ ...memberForm, policyStartDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mem-end">
                End Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mem-end"
                type="date"
                value={memberForm.policyEndDate}
                onChange={e => setMemberForm({ ...memberForm, policyEndDate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveMember} disabled={memberSaving}>
              {memberSaving
                ? 'Saving…'
                : editingMember
                  ? 'Update Member'
                  : 'Register Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
