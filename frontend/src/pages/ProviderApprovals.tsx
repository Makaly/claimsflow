import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Building2, CheckCircle, XCircle, Eye, MapPin, Phone, Mail,
  Globe, Loader2, RefreshCw, Clock, FileText, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'

interface PendingProvider {
  id: string
  name: string
  type: string
  licenseNumber?: string
  contactPerson?: string
  email?: string
  phone?: string
  physicalAddress?: string
  city?: string
  region?: string
  website?: string
  appliedAt: string
  notes?: string
  kraPin?: string
  nhifNumber?: string
}

const DEMO_PROVIDERS: PendingProvider[] = [
  {
    id: '1', name: 'Mombasa Medical Centre', type: 'clinic', licenseNumber: 'LIC-003',
    contactPerson: 'Dr. Hassan Ali', email: 'info@mombasamedical.co.ke', phone: '+254 41 2312000',
    physicalAddress: 'Moi Avenue, Mombasa', city: 'Mombasa', region: 'Coast',
    appliedAt: '2026-03-10T09:00:00Z', kraPin: 'A004901371L', nhifNumber: 'NHIF-0038821',
  },
  {
    id: '2', name: 'Nakuru Wellness Pharmacy', type: 'pharmacy', licenseNumber: 'LIC-007',
    contactPerson: 'James Kiprotich', email: 'info@nakuruwellness.co.ke', phone: '+254 51 2214000',
    physicalAddress: 'Kenyatta Ave, Nakuru', city: 'Nakuru', region: 'Rift Valley',
    appliedAt: '2026-03-25T11:00:00Z', kraPin: 'A007234561P',
  },
  {
    id: '3', name: 'Coast Diagnostics Lab', type: 'lab', licenseNumber: 'LIC-008',
    contactPerson: 'Dr. Amina Bakhit', email: 'info@coastdiagnostics.co.ke', phone: '+254 41 3315000',
    physicalAddress: 'Nyali Rd, Mombasa', city: 'Mombasa', region: 'Coast',
    appliedAt: '2026-04-02T14:00:00Z', kraPin: 'A009876543M', nhifNumber: 'NHIF-0041337',
    notes: 'Documents submitted. Awaiting license verification from MOH.',
  },
]

const typeColors: Record<string, string> = {
  hospital: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  clinic: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  pharmacy: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  lab: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  specialist: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
}

export default function ProviderApprovals() {
  const [providers, setProviders] = useState<PendingProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<PendingProvider | null>(null)
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'view' | null>(null)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchProviders = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/providers/approvals/pending', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (res.ok) {
        const data = await res.json()
        setProviders(Array.isArray(data) ? data : Array.isArray(data?.providers) ? data.providers : [])
      } else {
        setProviders([])
      }
    } catch {
      setProviders([])
    }
  }

  useEffect(() => {
    fetchProviders().finally(() => setLoading(false))
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    await fetchProviders()
    setRefreshing(false)
  }

  const filtered = providers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.region || '').toLowerCase().includes(search.toLowerCase())
  )

  const openAction = (provider: PendingProvider, type: 'approve' | 'reject' | 'view') => {
    setSelectedProvider(provider)
    setActionType(type)
    setReason('')
    setNotes('')
  }

  const closeAction = () => {
    setActionType(null)
    setSelectedProvider(null)
    setReason('')
  }

  const handleSubmit = async () => {
    if (!selectedProvider || !actionType || actionType === 'view') return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const endpoint = actionType === 'approve'
        ? `/api/providers/${selectedProvider.id}/approve`
        : `/api/providers/${selectedProvider.id}/reject`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(actionType === 'approve' ? { notes } : { reason }),
      })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (res.ok) {
        setProviders(prev => prev.filter(p => p.id !== selectedProvider.id))
        toast.success(actionType === 'approve'
          ? `${selectedProvider.name} approved successfully`
          : `${selectedProvider.name} rejected`)
        closeAction()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.message || `Failed to ${actionType} provider`)
      }
    } catch {
      toast.error('Network error — please try again')
    }
    setSubmitting(false)
  }

  const stats = {
    total: providers.length,
    clinics: providers.filter(p => p.type === 'clinic').length,
    hospitals: providers.filter(p => p.type === 'hospital').length,
    labs: providers.filter(p => p.type === 'lab' || p.type === 'pharmacy').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Approvals</h1>
          <p className="text-muted-foreground">Review and approve new provider registrations</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Pending Approval', value: stats.total, color: 'text-blue-500' },
          { label: 'Hospitals / Clinics', value: stats.hospitals + stats.clinics, color: 'text-green-500' },
          { label: 'Labs / Pharmacies', value: stats.labs, color: 'text-purple-500' },
          { label: 'Avg Wait (days)', value: providers.length > 0
            ? Math.round(providers.reduce((s, p) => s + (Date.now() - new Date(p.appliedAt).getTime()), 0) / providers.length / 86400000)
            : 0, color: 'text-amber-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search providers, cities, regions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading pending providers…
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
                {search ? 'No providers match search' : 'No pending provider approvals'}
              </CardContent>
            </Card>
          ) : filtered.slice((page - 1) * pageSize, page * pageSize).map(provider => {
            const waitDays = Math.round((Date.now() - new Date(provider.appliedAt).getTime()) / 86400000)
            return (
              <Card key={provider.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${typeColors[provider.type] ?? 'bg-gray-100 text-gray-700'}`}>
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{provider.name}</h3>
                          <Badge className={typeColors[provider.type] ?? ''} variant="secondary">{provider.type}</Badge>
                          {waitDays > 14 && (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              <Clock className="mr-1 h-2.5 w-2.5" />{waitDays}d waiting
                            </Badge>
                          )}
                        </div>
                        {provider.licenseNumber && (
                          <p className="text-sm text-muted-foreground mt-0.5 font-mono">{provider.licenseNumber}</p>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                          {provider.email && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0" /> {provider.email}
                            </div>
                          )}
                          {provider.phone && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0" /> {provider.phone}
                            </div>
                          )}
                          {(provider.city || provider.region) && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {[provider.city, provider.region].filter(Boolean).join(', ')}
                            </div>
                          )}
                          {provider.contactPerson && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Globe className="h-3 w-3 shrink-0" /> Contact: {provider.contactPerson}
                            </div>
                          )}
                        </div>
                        {provider.notes && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{provider.notes}</span>
                          </div>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">Applied: {formatDate(provider.appliedAt)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => openAction(provider, 'view')}>
                        <Eye className="mr-1 h-3 w-3" /> Review
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => openAction(provider, 'approve')}>
                        <CheckCircle className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button variant="destructive" size="sm"
                        onClick={() => openAction(provider, 'reject')}>
                        <XCircle className="mr-1 h-3 w-3" /> Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </div>
      )}

      {/* ── Action Dialog ── */}
      <Dialog open={!!actionType} onOpenChange={closeAction}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {actionType === 'approve' ? 'Approve Provider'
               : actionType === 'reject' ? 'Reject Provider'
               : 'Provider Details'}
            </DialogTitle>
            <DialogDescription>
              {selectedProvider?.name}
              {selectedProvider?.licenseNumber && ` · ${selectedProvider.licenseNumber}`}
            </DialogDescription>
          </DialogHeader>

          {selectedProvider && (
            <div className="space-y-4 text-sm">
              {/* Full detail grid */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Provider Type</Label>
                  <Badge className={typeColors[selectedProvider.type] ?? ''} variant="secondary">{selectedProvider.type}</Badge>
                </div>
                <div><Label className="text-xs text-muted-foreground">License #</Label>
                  <p className="font-mono">{selectedProvider.licenseNumber || '—'}</p>
                </div>
                {selectedProvider.kraPin && (
                  <div><Label className="text-xs text-muted-foreground">KRA PIN</Label>
                    <p className="font-mono">{selectedProvider.kraPin}</p>
                  </div>
                )}
                {selectedProvider.nhifNumber && (
                  <div><Label className="text-xs text-muted-foreground">NHIF #</Label>
                    <p className="font-mono">{selectedProvider.nhifNumber}</p>
                  </div>
                )}
                <div><Label className="text-xs text-muted-foreground">Contact</Label>
                  <p>{selectedProvider.contactPerson || '—'}</p>
                </div>
                <div><Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="truncate">{selectedProvider.email || '—'}</p>
                </div>
                <div><Label className="text-xs text-muted-foreground">Phone</Label>
                  <p>{selectedProvider.phone || '—'}</p>
                </div>
                <div><Label className="text-xs text-muted-foreground">Location</Label>
                  <p>{[selectedProvider.city, selectedProvider.region].filter(Boolean).join(', ') || '—'}</p>
                </div>
                {selectedProvider.physicalAddress && (
                  <div className="col-span-2"><Label className="text-xs text-muted-foreground">Physical Address</Label>
                    <p>{selectedProvider.physicalAddress}</p>
                  </div>
                )}
              </div>

              {selectedProvider.notes && (
                <>
                  <Separator />
                  <div className="rounded bg-amber-50 dark:bg-amber-950/20 p-2 flex gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">{selectedProvider.notes}</p>
                  </div>
                </>
              )}

              {actionType !== 'view' && <Separator />}

              {actionType === 'approve' && (
                <div className="space-y-2">
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle className="inline mr-1.5 h-3.5 w-3.5" />
                    Approving will activate this provider. They will be notified via email and can immediately start submitting claims.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Approval Notes (optional)</Label>
                    <Textarea
                      placeholder="Any notes for the provider or internal records…"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {actionType === 'reject' && (
                <div className="space-y-2">
                  <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-800 dark:text-red-300">
                    <XCircle className="inline mr-1.5 h-3.5 w-3.5" />
                    The provider will be notified of the rejection with your reason. They may reapply once they resolve the issues.
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rejection Reason <span className="text-destructive">*</span></Label>
                    <Textarea
                      placeholder="Explain why the application is being rejected…"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>
              {actionType === 'view' ? 'Close' : 'Cancel'}
            </Button>
            {actionType === 'approve' && (
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                <CheckCircle className="mr-2 h-3.5 w-3.5" /> Confirm Approval
              </Button>
            )}
            {actionType === 'reject' && (
              <Button variant="destructive" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
                {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                <XCircle className="mr-2 h-3.5 w-3.5" /> Confirm Rejection
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
