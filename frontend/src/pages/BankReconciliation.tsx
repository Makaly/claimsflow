import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Upload, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import api from '@/services/api'

interface BankLine {
  id: string
  format: string
  reference?: string
  amount: number
  currency: string
  valueDate: string
  description?: string
  status: 'unreconciled' | 'matched' | 'written_off'
  matchedClaimId?: string
}

interface Summary {
  status: string
  _count: { id: number }
  _sum: { amount: number | null }
}

export default function BankReconciliation() {
  const [lines, setLines] = useState<BankLine[]>([])
  const [summary, setSummary] = useState<Summary[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [format, setFormat] = useState<'mt940' | 'camt053' | 'csv'>('csv')
  const [matchDialog, setMatchDialog] = useState<BankLine | null>(null)
  const [writeOffDialog, setWriteOffDialog] = useState<BankLine | null>(null)
  const [claimIdInput, setClaimIdInput] = useState('')
  const [writeOffReason, setWriteOffReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [linesRes, sumRes] = await Promise.all([
        api.get('/bank-recon/unreconciled?take=100'),
        api.get('/bank-recon/summary'),
      ])
      setLines(Array.isArray(linesRes.data) ? linesRes.data : [])
      setSummary(Array.isArray(sumRes.data) ? sumRes.data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const content = await file.text()
      await api.post('/bank-recon/ingest', { content, format })
      await fetchData()
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleMatch = async () => {
    if (!matchDialog || !claimIdInput.trim()) return
    setActionLoading(true)
    try {
      await api.patch(`/bank-recon/${matchDialog.id}/match`, { claimId: claimIdInput.trim() })
      setMatchDialog(null)
      setClaimIdInput('')
      await fetchData()
    } finally {
      setActionLoading(false)
    }
  }

  const handleWriteOff = async () => {
    if (!writeOffDialog || !writeOffReason.trim()) return
    setActionLoading(true)
    try {
      await api.patch(`/bank-recon/${writeOffDialog.id}/write-off`, { reason: writeOffReason.trim() })
      setWriteOffDialog(null)
      setWriteOffReason('')
      await fetchData()
    } finally {
      setActionLoading(false)
    }
  }

  const statusColor: Record<string, string> = {
    unreconciled: 'bg-amber-100 text-amber-700',
    matched: 'bg-emerald-100 text-emerald-700',
    written_off: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bank Reconciliation</h1>
          <p className="text-muted-foreground">Match bank statement lines to paid claims</p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {['unreconciled', 'matched', 'written_off'].map(s => {
          const row = summary.find(r => r.status === s)
          return (
            <Card key={s}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium capitalize">{s.replace('_', ' ')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{row?._count?.id ?? 0}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(row?._sum?.amount ?? 0)}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Upload panel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Import Bank Statement</CardTitle>
          <CardDescription>Upload MT940, camt.053 XML, or CSV file</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 items-center flex-wrap">
          <Select value={format} onValueChange={(v) => setFormat(v as any)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mt940">MT940</SelectItem>
              <SelectItem value="camt053">camt.053</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
          <label className="cursor-pointer">
            <input type="file" accept=".txt,.xml,.csv,.sta" className="hidden" onChange={handleFileUpload} disabled={uploading} />
            <Button size="sm" variant="outline" asChild disabled={uploading}>
              <span>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                {uploading ? 'Importing…' : 'Choose file'}
              </span>
            </Button>
          </label>
        </CardContent>
      </Card>

      {/* Unreconciled table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Unreconciled Lines ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Value Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No unreconciled lines
                  </TableCell>
                </TableRow>
              ) : lines.map(line => (
                <TableRow key={line.id}>
                  <TableCell className="font-mono text-xs">{line.reference || '—'}</TableCell>
                  <TableCell className="font-medium">{formatCurrency(line.amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(line.valueDate)}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{line.description || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[10px] ${statusColor[line.status]}`}>
                      {line.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                        onClick={() => { setMatchDialog(line); setClaimIdInput('') }}>
                        Match
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-destructive"
                        onClick={() => { setWriteOffDialog(line); setWriteOffReason('') }}>
                        Write off
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Manual match dialog */}
      <Dialog open={!!matchDialog} onOpenChange={o => !o && setMatchDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manual Match</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground text-xs">
              Line: {matchDialog?.reference} — {formatCurrency(matchDialog?.amount ?? 0)}
            </p>
            <div>
              <label className="text-xs font-medium">Claim ID or Claim Number</label>
              <Input className="mt-1 text-xs" value={claimIdInput} onChange={e => setClaimIdInput(e.target.value)} placeholder="e.g. CLM-2026-0041" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMatchDialog(null)}>Cancel</Button>
            <Button size="sm" onClick={handleMatch} disabled={!claimIdInput.trim() || actionLoading}>
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Write-off dialog */}
      <Dialog open={!!writeOffDialog} onOpenChange={o => !o && setWriteOffDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Write Off</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground text-xs">
              Line: {writeOffDialog?.reference} — {formatCurrency(writeOffDialog?.amount ?? 0)}
            </p>
            <div>
              <label className="text-xs font-medium">Reason <span className="text-red-600">*</span></label>
              <textarea
                className="mt-1 w-full rounded-md border bg-background p-2 text-xs"
                rows={2}
                value={writeOffReason}
                onChange={e => setWriteOffReason(e.target.value)}
                placeholder="e.g. Bank fee, duplicate posting…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setWriteOffDialog(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={handleWriteOff} disabled={!writeOffReason.trim() || actionLoading}>
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Write Off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
