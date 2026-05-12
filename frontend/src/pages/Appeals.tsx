import { useState, useEffect, useCallback } from 'react'
import { Scale, Plus, CheckCircle, XCircle, Clock, ChevronDown, RefreshCw, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuthStore } from '@/store/authStore'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-blue-100 text-blue-800',
  finalised: 'bg-gray-100 text-gray-700',
}

const outcomeColors: Record<string, string> = {
  upheld: 'bg-green-100 text-green-800',
  dismissed: 'bg-red-100 text-red-800',
}

export default function Appeals() {
  const { user } = useAuthStore()
  const [appeals, setAppeals] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [adjudicating, setAdjudicating] = useState<any | null>(null)
  const [outcome, setOutcome] = useState<'upheld' | 'dismissed'>('dismissed')
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const isStaff = ['admin', 'supervisor'].includes(user?.role ?? '')

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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Scale className="h-6 w-6 text-blue-600" /> Appeals
          </h1>
          <p className="text-gray-500 text-sm mt-1">{total} total appeals</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div><div className="text-2xl font-bold">{pendingCount}</div><div className="text-xs text-gray-500">Pending</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-blue-500" />
            <div><div className="text-2xl font-bold">{underReviewCount}</div><div className="text-xs text-gray-500">Under Review</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-gray-400" />
            <div><div className="text-2xl font-bold">{finalisedCount}</div><div className="text-xs text-gray-500">Finalised</div></div>
          </CardContent>
        </Card>
      </div>

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
                <TableHead>Claim</TableHead>
                <TableHead>Filed By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Filed</TableHead>
                {isStaff && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appeals.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No appeals found</TableCell></TableRow>
              )}
              {appeals.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.claim?.claimNumber ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.filer?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{a.reason}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[a.status] ?? ''}`}>{a.status.replace('_', ' ')}</span>
                  </TableCell>
                  <TableCell>
                    {a.outcome ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeColors[a.outcome] ?? ''}`}>{a.outcome}</span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{formatDate(a.createdAt)}</TableCell>
                  {isStaff && (
                    <TableCell>
                      <div className="flex gap-1">
                        {a.status === 'pending' && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markUnderReview(a.id)}>Review</Button>
                        )}
                        {(a.status === 'pending' || a.status === 'under_review') && (
                          <Button size="sm" className="h-7 text-xs" onClick={() => setAdjudicating(a)}>Decide</Button>
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

      <Dialog open={!!adjudicating} onOpenChange={open => !open && setAdjudicating(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjudicate Appeal — {adjudicating?.claim?.claimNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-sm font-medium">Appeal Reason</Label>
              <p className="text-sm text-gray-600 mt-1 p-2 bg-gray-50 rounded">{adjudicating?.reason}</p>
            </div>
            {adjudicating?.additionalNotes && (
              <div>
                <Label className="text-sm font-medium">Additional Notes</Label>
                <p className="text-sm text-gray-600 mt-1 p-2 bg-gray-50 rounded">{adjudicating.additionalNotes}</p>
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
              {outcome === 'upheld' && <p className="text-xs text-green-700 bg-green-50 p-2 rounded">Claim will be reinstated and re-enter the initial review queue.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Decision Notes</Label>
              <Textarea rows={3} value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} placeholder="Explain your decision..." />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAdjudicating(null)}>Cancel</Button>
              <Button onClick={adjudicate} disabled={saving}>{saving ? 'Saving…' : 'Confirm Decision'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
