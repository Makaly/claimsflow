import { useState } from 'react'
import { CheckSquare, UserCheck, ThumbsUp, ThumbsDown, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import api from '@/services/api'
import { toast } from 'sonner'

interface BulkActionsBarProps {
  selectedIds: string[]
  onClear: () => void
  onDone: () => void
  queueType: 'maker' | 'checker'
  showApprove?: boolean
  showReject?: boolean
  showAssignToMe?: boolean
}

export default function BulkActionsBar({
  selectedIds,
  onClear,
  onDone,
  queueType,
  showApprove = true,
  showReject = true,
  showAssignToMe = true,
}: BulkActionsBarProps) {
  const [loading, setLoading] = useState(false)
  const [rejectDialog, setRejectDialog] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  if (selectedIds.length === 0) return null

  const bulkAction = async (type: 'approve' | 'reject' | 'assign') => {
    setLoading(true)
    try {
      if (type === 'approve') {
        const endpoint = queueType === 'maker' ? '/workflow/bulk/approve-maker' : '/workflow/bulk/approve-checker'
        const res = await api.post(endpoint, { claimIds: selectedIds })
        toast.success(`${res.data.succeeded} claim(s) approved, ${res.data.failed} failed`)
      } else if (type === 'reject') {
        if (!rejectReason.trim()) return
        const res = await api.post('/workflow/bulk/reject', { claimIds: selectedIds, reason: rejectReason, stage: queueType })
        toast.success(`${res.data.succeeded} claim(s) rejected`)
        setRejectDialog(false)
        setRejectReason('')
      } else if (type === 'assign') {
        const res = await api.post('/workflow/bulk/assign-to-me', { claimIds: selectedIds })
        toast.success(`${res.data.assigned} claim(s) assigned to you`)
      }
      onClear()
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Bulk action failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-950 border border-blue-800 rounded-lg text-white">
        <CheckSquare className="h-4 w-4 text-blue-300 shrink-0" />
        <span className="text-sm font-medium text-blue-100">{selectedIds.length} selected</span>
        <div className="flex gap-2 ml-2">
          {showAssignToMe && (
            <Button size="sm" variant="secondary" className="h-7 text-xs bg-blue-800 hover:bg-blue-700 text-white border-blue-700" onClick={() => bulkAction('assign')} disabled={loading}>
              <UserCheck className="h-3 w-3 mr-1" /> Assign to Me
            </Button>
          )}
          {showApprove && (
            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => bulkAction('approve')} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ThumbsUp className="h-3 w-3 mr-1" />} Approve All
            </Button>
          )}
          {showReject && (
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setRejectDialog(true)} disabled={loading}>
              <ThumbsDown className="h-3 w-3 mr-1" /> Reject All
            </Button>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-auto text-blue-300 hover:text-white hover:bg-blue-800" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Reject {selectedIds.length} Claim(s)</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Rejection Reason *</Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Enter reason applied to all selected claims…"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectDialog(false)}>Cancel</Button>
              <Button variant="destructive" disabled={!rejectReason.trim() || loading} onClick={() => bulkAction('reject')}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Confirm Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
