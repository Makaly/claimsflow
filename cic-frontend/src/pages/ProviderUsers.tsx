import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Users, CheckCircle, XCircle, RefreshCw, Loader2, Mail, Clock,
  ShieldCheck, ShieldX, ShieldAlert, MailCheck, MailWarning,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { formatDate } from '@/lib/utils'
import api from '@/services/api'

interface ProviderUser {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  createdAt: string
  lastLogin?: string | null
  emailVerifiedAt?: string | null
  providerApprovalStatus?: 'pending' | 'approved' | 'rejected' | null
  providerApprovedAt?: string | null
  providerApprovalComment?: string | null
  providerRejectionReason?: string | null
}

type Decision = 'approve' | 'reject'

const STATUS_STYLE: Record<string, { badge: string; label: string }> = {
  pending:  { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', label: 'Pending' },
  approved: { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'Approved' },
  rejected: { badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: 'Rejected' },
}

export default function ProviderUsers() {
  const [users, setUsers] = useState<ProviderUser[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [search, setSearch] = useState('')
  const [decisionFor, setDecisionFor] = useState<ProviderUser | null>(null)
  const [decision, setDecision] = useState<Decision>('approve')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/providers/self-service/users')
      setUsers(Array.isArray(data) ? data : [])
    } catch { setUsers([]) }
  }
  useEffect(() => { fetchUsers().finally(() => setLoading(false)) }, [])

  const refresh = async () => { setRefreshing(true); await fetchUsers(); setRefreshing(false) }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (tab === 'pending' && u.providerApprovalStatus !== 'pending') return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })
  }, [users, tab, search])

  const stats = useMemo(() => ({
    pending:  users.filter((u) => u.providerApprovalStatus === 'pending').length,
    approved: users.filter((u) => u.providerApprovalStatus === 'approved').length,
    rejected: users.filter((u) => u.providerApprovalStatus === 'rejected').length,
  }), [users])

  const openDecision = (user: ProviderUser, kind: Decision) => {
    setDecisionFor(user); setDecision(kind); setComment(''); setReason('')
  }
  const closeDecision = () => { setDecisionFor(null); setComment(''); setReason('') }

  const submit = async () => {
    if (!decisionFor) return
    if (decision === 'approve' && !comment.trim()) { toast.error('Approval comment is required'); return }
    if (decision === 'reject' && !reason.trim())   { toast.error('Rejection reason is required'); return }
    setSubmitting(true)
    try {
      if (decision === 'approve') {
        await api.post(`/providers/self-service/users/${decisionFor.id}/approve`, { comment })
        toast.success(`${decisionFor.name} approved`)
      } else {
        await api.post(`/providers/self-service/users/${decisionFor.id}/reject`, { reason, comment: comment.trim() || undefined })
        toast.success(`${decisionFor.name} rejected`)
      }
      await fetchUsers()
      closeDecision()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Action failed')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users under your provider</h1>
          <p className="text-muted-foreground">Approve or reject staff who sign up under your organisation.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Pending approval',  value: stats.pending,  icon: ShieldAlert, color: 'text-amber-500' },
          { label: 'Approved',          value: stats.approved, icon: ShieldCheck, color: 'text-emerald-500' },
          { label: 'Rejected',          value: stats.rejected, icon: ShieldX,     color: 'text-red-500' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`mt-0.5 text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon className={`h-7 w-7 opacity-30 ${s.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1">
          <button onClick={() => setTab('pending')}
            className={`rounded-md px-3 py-1.5 text-sm transition ${tab === 'pending' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            Pending ({stats.pending})
          </button>
          <button onClick={() => setTab('all')}
            className={`rounded-md px-3 py-1.5 text-sm transition ${tab === 'all' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            All users ({users.length})
          </button>
        </div>
        <div className="relative max-w-sm flex-1 sm:flex-none">
          <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading users…
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
            {tab === 'pending' ? 'No users awaiting approval' : 'No users match your search'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((u) => {
            const status = u.providerApprovalStatus || 'pending'
            const style = STATUS_STYLE[status]
            const waitDays = u.providerApprovalStatus === 'pending'
              ? Math.round((Date.now() - new Date(u.createdAt).getTime()) / 86400000)
              : null
            return (
              <Card key={u.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {u.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{u.name}</p>
                        <Badge className={style.badge}>{style.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{u.role}</Badge>
                        {u.emailVerifiedAt
                          ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><MailCheck className="h-3 w-3" /> verified</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><MailWarning className="h-3 w-3" /> unverified</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {u.email}</span>
                        <span>Registered: {formatDate(u.createdAt)}</span>
                        {u.providerApprovedAt && <span>Decided: {formatDate(u.providerApprovedAt)}</span>}
                        {waitDays !== null && waitDays > 0 && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Clock className="h-3 w-3" /> {waitDays}d waiting</span>}
                      </div>
                      {status === 'approved' && u.providerApprovalComment && (
                        <p className="mt-1 text-xs italic text-muted-foreground">"{u.providerApprovalComment}"</p>
                      )}
                      {status === 'rejected' && u.providerRejectionReason && (
                        <p className="mt-1 text-xs italic text-red-600 dark:text-red-400">Reason: {u.providerRejectionReason}</p>
                      )}
                    </div>
                  </div>
                  {status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={() => openDecision(u, 'reject')}>
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openDecision(u, 'approve')}>
                        <CheckCircle className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={!!decisionFor} onOpenChange={closeDecision}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {decision === 'approve' ? 'Approve user' : 'Reject user'}
            </DialogTitle>
          </DialogHeader>
          {decisionFor && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="font-medium">{decisionFor.name}</p>
                <p className="text-xs text-muted-foreground">{decisionFor.email}</p>
              </div>
              <Separator />
              {decision === 'approve' ? (
                <>
                  <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                    Approving lets this user sign in immediately. They'll receive a notification email.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Approval comment <span className="text-destructive">*</span></Label>
                    <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
                      placeholder="What role will they take on? Any conditions on their access?" />
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300">
                    The user will be notified with the reason you give below.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rejection reason (sent to user) <span className="text-destructive">*</span></Label>
                    <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Why are you rejecting this access request?" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Internal comment (optional)</Label>
                    <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
                      placeholder="Private note for the audit trail" />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDecision}>Cancel</Button>
            {decision === 'approve' ? (
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={submitting || !comment.trim()}>
                {submitting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-2 h-3.5 w-3.5" />}
                Confirm approval
              </Button>
            ) : (
              <Button variant="destructive" onClick={submit} disabled={submitting || !reason.trim()}>
                {submitting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-2 h-3.5 w-3.5" />}
                Confirm rejection
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
