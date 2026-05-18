import { useState, useEffect, useCallback } from 'react'
import { CreditCard, CheckCircle, Download, RefreshCw, DollarSign, FileText, Building2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import api from '@/services/api'
import { formatDate } from '@/lib/utils'

function fmtKES(n: number) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

export default function Payment() {
  const [pending, setPending] = useState<any[]>([])
  const [advices, setAdvices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set())
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<any | null>(null)
  const [payRef, setPayRef] = useState('')
  const [payDate, setPayDate] = useState('')
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pendingRes, advicesRes] = await Promise.all([
        api.get('/payment/pending'),
        api.get('/payment/advices'),
      ])
      setPending(pendingRes.data.providers || [])
      setAdvices(advicesRes.data.advices || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleClaim = (claimId: string) => {
    setSelectedClaims(prev => {
      const next = new Set(prev)
      if (next.has(claimId)) next.delete(claimId)
      else next.add(claimId)
      return next
    })
  }

  const generateAdvice = async () => {
    if (!selectedProvider || selectedClaims.size === 0) return
    setGenerating(true)
    try {
      await api.post('/payment/advices', {
        providerId: selectedProvider,
        claimIds: Array.from(selectedClaims),
      })
      setSelectedClaims(new Set())
      setSelectedProvider(null)
      load()
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to generate advice')
    } finally {
      setGenerating(false)
    }
  }

  const confirmPayment = async () => {
    if (!confirmDialog || !payRef) return
    setConfirming(true)
    try {
      await api.patch(`/payment/advices/${confirmDialog.id}/confirm`, { paymentReference: payRef, paymentDate: payDate })
      setConfirmDialog(null)
      setPayRef('')
      setPayDate('')
      load()
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to confirm')
    } finally {
      setConfirming(false)
    }
  }

  const exportCsv = async (id: string, adviceNumber: string) => {
    const { data: blob } = await api.get(`/payment/advices/${id}/export`, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${adviceNumber}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPending = pending.reduce((s, p) => s + p.totalAmount, 0)
  const totalAdvicePending = advices.filter(a => a.status === 'pending').reduce((s, a) => s + a.totalAmount, 0)
  const totalPaid = advices.filter(a => a.status === 'paid').reduce((s, a) => s + a.totalAmount, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="h-6 w-6 text-blue-600" /> Payment Settlement</h1>
          <p className="text-gray-500 text-sm mt-1">Finance — generate payment advices and confirm disbursements</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-amber-500" />
          <div><div className="text-xl font-bold">{fmtKES(totalPending)}</div><div className="text-xs text-gray-500">Approved, awaiting advice</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <FileText className="h-8 w-8 text-blue-500" />
          <div><div className="text-xl font-bold">{fmtKES(totalAdvicePending)}</div><div className="text-xs text-gray-500">Advices pending payment</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <div><div className="text-xl font-bold">{fmtKES(totalPaid)}</div><div className="text-xs text-gray-500">Total paid this period</div></div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Approved Claims ({pending.reduce((s, p) => s + p.claims.length, 0)})</TabsTrigger>
          <TabsTrigger value="advices">Payment Advices ({advices.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4 mt-4">
          {selectedClaims.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-sm font-medium text-blue-900">{selectedClaims.size} claim(s) selected</span>
              <Button size="sm" onClick={generateAdvice} disabled={generating}>
                {generating ? 'Generating…' : 'Generate Payment Advice'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedClaims(new Set())}>Clear</Button>
            </div>
          )}
          {pending.map(providerGroup => (
            <Card key={providerGroup.provider.id}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> {providerGroup.provider.name}
                </CardTitle>
                <div className="text-sm font-bold text-green-700">{fmtKES(providerGroup.totalAmount)}</div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={providerGroup.claims.every((c: any) => selectedClaims.has(c.id))}
                          onCheckedChange={checked => {
                            const next = new Set(selectedClaims)
                            if (checked) {
                              providerGroup.claims.forEach((c: any) => { next.add(c.id); setSelectedProvider(providerGroup.provider.id) })
                            } else {
                              providerGroup.claims.forEach((c: any) => next.delete(c.id))
                            }
                            setSelectedClaims(next)
                          }}
                        />
                      </TableHead>
                      <TableHead>Claim</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerGroup.claims.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedClaims.has(c.id)}
                            onCheckedChange={() => { toggleClaim(c.id); setSelectedProvider(providerGroup.provider.id) }}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                        <TableCell className="text-sm">{c.memberName ?? '—'}</TableCell>
                        <TableCell className="text-xs">{c.invoiceNumber ?? '—'}</TableCell>
                        <TableCell className="text-sm font-medium">{fmtKES(c.invoiceAmount ?? 0)}</TableCell>
                        <TableCell className="text-xs text-gray-500">{c.approvedAt ? formatDate(c.approvedAt) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {pending.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400">No approved claims awaiting payment</div>
          )}
        </TabsContent>

        <TabsContent value="advices" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Advice #</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Claims</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advices.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.adviceNumber}</TableCell>
                      <TableCell className="text-sm">{a.providerId}</TableCell>
                      <TableCell className="text-sm">{(a.claimIds as string[]).length}</TableCell>
                      <TableCell className="font-medium">{fmtKES(a.totalAmount)}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'paid' ? 'default' : 'outline'} className={a.status === 'paid' ? 'bg-green-100 text-green-800' : ''}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">{formatDate(a.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv(a.id, a.adviceNumber)}>
                            <Download className="h-3 w-3 mr-1" /> CSV
                          </Button>
                          {a.status === 'pending' && (
                            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => setConfirmDialog(a)}>
                              Confirm Payment
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {advices.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No payment advices yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirmDialog} onOpenChange={open => !open && setConfirmDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirm Payment — {confirmDialog?.adviceNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-600">Total: <strong>{fmtKES(confirmDialog?.totalAmount ?? 0)}</strong></p>
            <div className="space-y-1.5">
              <Label>Payment Reference *</Label>
              <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. EFT-20260512-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
              <Button onClick={confirmPayment} disabled={!payRef || confirming} className="bg-green-600 hover:bg-green-700">
                {confirming ? 'Confirming…' : 'Confirm Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
