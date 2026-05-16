import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Scale, CheckCircle, XCircle, Clock, RefreshCw, AlertTriangle,
  MessageSquare, Send, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useAuthStore } from '@/store/authStore'
import api from '@/services/api'
import { formatDate, formatDateTime, cn } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  under_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  finalised:    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
}

const outcomeColors: Record<string, string> = {
  upheld:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  dismissed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const roleLabel: Record<string, string> = {
  admin:          'Admin',
  claims_officer: 'Claims Officer',
  fraud_officer:  'Fraud Officer',
  provider_admin: 'Provider Admin',
  provider_user:  'Provider',
}

const roleBubbleColor: Record<string, string> = {
  admin:          'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800',
  claims_officer: 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
  fraud_officer:  'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800',
  provider_admin: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800',
  provider_user:  'bg-teal-100 dark:bg-teal-900/30 border-teal-200 dark:border-teal-800',
}

export default function Appeals() {
  const { user } = useAuthStore()
  const [appeals, setAppeals] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  // Adjudicate modal state
  const [adjudicating, setAdjudicating] = useState<any | null>(null)
  const [outcome, setOutcome] = useState<'upheld' | 'dismissed'>('dismissed')
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Thread modal state
  const [threadAppeal, setThreadAppeal] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isStaff = ['admin', 'claims_officer', 'fraud_officer'].includes(user?.role ?? '')
  const canMessage = ['admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user'].includes(user?.role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const { data } = await api.get(`/appeals?${params}`)
      setAppeals(data.appeals || [])
      setTotal(data.total || 0)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const loadMessages = async (appealId: string) => {
    setMessagesLoading(true)
    try {
      const { data } = await api.get(`/appeals/${appealId}/messages`)
      setMessages(Array.isArray(data) ? data : [])
    } catch {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const openThread = (appeal: any) => {
    setThreadAppeal(appeal)
    setMessages([])
    setNewMessage('')
    loadMessages(appeal.id)
  }

  const sendMessage = async () => {
    if (!threadAppeal || !newMessage.trim()) return
    setSending(true)
    try {
      const { data } = await api.post(`/appeals/${threadAppeal.id}/messages`, { message: newMessage.trim() })
      setMessages(prev => [...prev, data])
      setNewMessage('')
      // Refresh appeal list so status badge updates
      load()
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const adjudicate = async () => {
    if (!adjudicating) return
    setSaving(true)
    try {
      await api.patch(`/appeals/${adjudicating.id}/adjudicate`, { outcome, outcomeNotes })
      setAdjudicating(null)
      setOutcome('dismissed')
      setOutcomeNotes('')
      load()
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to adjudicate')
    } finally {
      setSaving(false)
    }
  }

  const markUnderReview = async (id: string) => {
    await api.patch(`/appeals/${id}/status`, { status: 'under_review' }).catch(() => {})
    load()
  }

  const pendingCount = appeals.filter(a => a.status === 'pending').length
  const underReviewCount = appeals.filter(a => a.status === 'under_review').length
  const finalisedCount = appeals.filter(a => a.status === 'finalised').length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-blue-600" /> Appeals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{total} total appeals</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div><div className="text-2xl font-bold">{pendingCount}</div><div className="text-xs text-muted-foreground">Pending</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-blue-500" />
            <div><div className="text-2xl font-bold">{underReviewCount}</div><div className="text-xs text-muted-foreground">Under Review</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-gray-400" />
            <div><div className="text-2xl font-bold">{finalisedCount}</div><div className="text-xs text-muted-foreground">Finalised</div></div>
          </CardContent>
        </Card>
      </div>

      {/* Appeals table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">All Appeals</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="finalised">Finalised</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Filed By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Filed</TableHead>
                <TableHead>Thread</TableHead>
                {isStaff && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appeals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No appeals found
                  </TableCell>
                </TableRow>
              )}
              {appeals.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.claim?.claimNumber ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.filer?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate" title={a.reason}>{a.reason}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[a.status] ?? ''}`}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell>
                    {a.outcome ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeColors[a.outcome] ?? ''}`}>
                        {a.outcome}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                  <TableCell>
                    {canMessage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => openThread(a)}
                      >
                        <MessageSquare className="h-3 w-3" />
                        Thread
                      </Button>
                    )}
                  </TableCell>
                  {isStaff && (
                    <TableCell>
                      <div className="flex gap-1">
                        {a.status === 'pending' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markUnderReview(a.id)}>
                            Review
                          </Button>
                        )}
                        {(a.status === 'pending' || a.status === 'under_review') && (
                          <Button size="sm" className="h-7 text-xs" onClick={() => { setAdjudicating(a); setOutcome('dismissed'); setOutcomeNotes('') }}>
                            Decide
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Thread Dialog ── */}
      <Dialog open={!!threadAppeal} onOpenChange={open => !open && setThreadAppeal(null)}>
        <DialogContent className="max-w-lg w-full flex flex-col" style={{ maxHeight: '85vh' }}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              Appeal Thread — {threadAppeal?.claim?.claimNumber}
            </DialogTitle>
            <DialogDescription>
              Three-party discussion: Provider · Claims Officer · Fraud Officer
            </DialogDescription>
          </DialogHeader>

          {/* Appeal context */}
          <div className="shrink-0 rounded-lg bg-muted/50 px-3 py-2 text-xs space-y-0.5">
            <p><span className="font-medium">Reason: </span>{threadAppeal?.reason}</p>
            {threadAppeal?.additionalNotes && (
              <p><span className="font-medium">Notes: </span>{threadAppeal.additionalNotes}</p>
            )}
            <p className="text-muted-foreground">
              Status: <span className={`inline px-1.5 py-0.5 rounded-full font-medium ${statusColors[threadAppeal?.status ?? ''] ?? ''}`}>
                {threadAppeal?.status?.replace('_', ' ')}
              </span>
              {threadAppeal?.outcome && (
                <> · Outcome: <span className={`inline px-1.5 py-0.5 rounded-full font-medium ${outcomeColors[threadAppeal.outcome] ?? ''}`}>
                  {threadAppeal.outcome}
                </span></>
              )}
            </p>
          </div>

          <Separator className="shrink-0" />

          {/* Messages */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
            {messagesLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                <MessageSquare className="h-8 w-8 opacity-30" />
                <p>No messages yet. Start the discussion below.</p>
              </div>
            ) : messages.map(msg => {
              const isOwn = msg.sender?.id === user?.id || msg.senderId === user?.id
              return (
                <div key={msg.id} className={cn('flex flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                    <span className="font-medium text-foreground">{msg.sender?.name ?? '—'}</span>
                    <span>·</span>
                    <span>{roleLabel[msg.sender?.role ?? msg.senderRole] ?? msg.senderRole}</span>
                    <span>·</span>
                    <span>{formatDateTime(msg.createdAt)}</span>
                  </div>
                  <div className={cn(
                    'rounded-lg border px-3 py-2 text-sm max-w-[85%]',
                    isOwn
                      ? 'bg-blue-600 text-white border-blue-700'
                      : (roleBubbleColor[msg.sender?.role ?? msg.senderRole] ?? 'bg-muted border-border'),
                  )}>
                    {msg.message}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Send area */}
          {canMessage && threadAppeal?.status !== 'finalised' && (
            <>
              <Separator className="shrink-0" />
              <div className="shrink-0 flex gap-2 items-end">
                <Textarea
                  placeholder="Type a message… (Shift+Enter for new line)"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  rows={2}
                  className="resize-none flex-1 text-sm"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || sending}
                  size="icon"
                  className="h-10 w-10 shrink-0"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
          {threadAppeal?.status === 'finalised' && (
            <p className="shrink-0 text-center text-xs text-muted-foreground py-2">
              This appeal has been finalised — the thread is read-only.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Adjudicate Dialog ── */}
      <Dialog open={!!adjudicating} onOpenChange={open => !open && setAdjudicating(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjudicate Appeal — {adjudicating?.claim?.claimNumber}</DialogTitle>
            <DialogDescription>
              Record the final decision. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-sm font-medium">Appeal Reason</Label>
              <p className="text-sm text-muted-foreground mt-1 p-2 bg-muted/50 rounded">{adjudicating?.reason}</p>
            </div>
            {adjudicating?.additionalNotes && (
              <div>
                <Label className="text-sm font-medium">Additional Notes</Label>
                <p className="text-sm text-muted-foreground mt-1 p-2 bg-muted/50 rounded">{adjudicating.additionalNotes}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <div className="flex gap-2">
                <Button
                  variant={outcome === 'upheld' ? 'default' : 'outline'}
                  className={`flex-1 ${outcome === 'upheld' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setOutcome('upheld')}
                >
                  <CheckCircle className="h-4 w-4 mr-1" /> Upheld
                </Button>
                <Button
                  variant={outcome === 'dismissed' ? 'default' : 'outline'}
                  className={`flex-1 ${outcome === 'dismissed' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                  onClick={() => setOutcome('dismissed')}
                >
                  <XCircle className="h-4 w-4 mr-1" /> Dismissed
                </Button>
              </div>
              {outcome === 'upheld' && (
                <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 dark:border-green-800">
                  Invoice will be reinstated and routed to the claims officer queue for final approval.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Decision Notes</Label>
              <Textarea rows={3} value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} placeholder="Explain your decision…" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAdjudicating(null)}>Cancel</Button>
              <Button
                onClick={adjudicate}
                disabled={saving}
                className={outcome === 'upheld' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
              >
                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'Confirm Decision'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
