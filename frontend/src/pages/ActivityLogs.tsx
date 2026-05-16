import React, { useState, useEffect, useCallback } from 'react'
import { Search, Download, Clock, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatDateTime } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'

interface ActivityLog {
  id: string
  username?: string
  userRole?: string
  action: string
  entity?: string
  entityId?: string
  ipAddress?: string
  userAgent?: string
  method?: string
  endpoint?: string
  status: string
  errorMessage?: string
  metadata?: Record<string, any>
  oldValue?: Record<string, any>
  newValue?: Record<string, any>
  createdAt: string
  user?: { name: string; email: string; role: string }
}

const DEMO_LOGS: ActivityLog[] = [
  {
    id: '1', username: 'Admin User', userRole: 'admin', action: 'login',
    entity: 'auth', ipAddress: '192.168.1.100', status: 'success',
    method: 'POST', endpoint: '/api/auth/login',
    metadata: { browser: 'Chrome 124', os: 'Ubuntu 22.04' },
    createdAt: '2026-04-15T08:00:12Z',
  },
  {
    id: '2', username: 'Jane Mwangi', userRole: 'claims_officer', action: 'approve_claim',
    entity: 'claim', entityId: 'CLM-2026-00138', ipAddress: '192.168.1.105', status: 'success',
    method: 'POST', endpoint: '/api/workflow/maker/approve',
    metadata: { comments: 'All documents verified. Invoice matches OCR extraction.', invoiceAmount: 34000 },
    createdAt: '2026-04-15T09:15:30Z',
  },
  {
    id: '3', username: 'Peter Omondi', userRole: 'claims_officer', action: 'reject_claim',
    entity: 'claim', entityId: 'CLM-2026-00139', ipAddress: '192.168.1.108', status: 'success',
    method: 'POST', endpoint: '/api/workflow/maker/reject',
    metadata: { reason: 'Invoice amount mismatch with OCR extraction', invoiceAmount: 78000 },
    createdAt: '2026-04-15T09:30:00Z',
  },
  {
    id: '4', username: 'System', userRole: 'system', action: 'batch_process',
    entity: 'batch', entityId: 'BTH-2026-0045', ipAddress: '127.0.0.1', status: 'success',
    method: 'POST', endpoint: '/api/batch/process',
    metadata: { totalClaims: 12, processed: 12, failed: 0, durationMs: 4320 },
    createdAt: '2026-04-15T09:45:00Z',
  },
  {
    id: '5', username: 'Unknown', action: 'login',
    entity: 'auth', ipAddress: '41.89.12.34', status: 'failure',
    method: 'POST', endpoint: '/api/auth/login',
    errorMessage: 'Invalid credentials — account does not exist',
    metadata: { attemptCount: 3, blocked: true },
    createdAt: '2026-04-15T10:00:00Z',
  },
  {
    id: '6', username: 'Sarah Wambui', userRole: 'claims_officer', action: 'assign_claim',
    entity: 'workflow', entityId: 'CLM-2026-00142', ipAddress: '192.168.1.112', status: 'success',
    method: 'POST', endpoint: '/api/workflow/assign',
    metadata: { assignedTo: 'Jane Mwangi', strategy: 'workload', priority: 'normal' },
    createdAt: '2026-04-15T10:15:00Z',
  },
  {
    id: '7', username: 'Dr. Provider Admin', userRole: 'provider_admin', action: 'submit_batch',
    entity: 'batch', entityId: 'BTH-2026-0046', ipAddress: '196.200.10.50', status: 'success',
    method: 'POST', endpoint: '/api/batch/submit',
    metadata: { provider: 'Aga Khan University Hospital', claimsCount: 8, totalAmount: 540000 },
    createdAt: '2026-04-15T10:30:00Z',
  },
  {
    id: '8', username: 'Grace Njeri', userRole: 'claims_officer', action: 'update_claim',
    entity: 'claim', entityId: 'CLM-2026-00137', ipAddress: '192.168.1.115', status: 'success',
    method: 'PATCH', endpoint: '/api/claims/CLM-2026-00137',
    oldValue: { priority: 'normal', status: 'under_review' },
    newValue: { priority: 'high', status: 'under_review' },
    createdAt: '2026-04-15T10:45:00Z',
  },
  {
    id: '9', username: 'Admin User', userRole: 'admin', action: 'create_user',
    entity: 'user', entityId: 'USR-0008', ipAddress: '192.168.1.100', status: 'success',
    method: 'POST', endpoint: '/api/users',
    metadata: { role: 'claims_officer', email: 'new.officer@cic.co.ke' },
    createdAt: '2026-04-15T11:00:00Z',
  },
  {
    id: '10', username: 'System', userRole: 'system', action: 'ocr_process',
    entity: 'document', entityId: 'DOC-2026-0089', ipAddress: '127.0.0.1', status: 'failure',
    method: 'POST', endpoint: '/api/ocr/process',
    errorMessage: 'Tesseract OCR failed: image quality too low (DPI < 150)',
    metadata: { documentType: 'invoice', fileSize: 204800, retryCount: 2 },
    createdAt: '2026-04-15T11:15:00Z',
  },
  {
    id: '11', username: 'Peter Omondi', userRole: 'claims_officer', action: 'checker_approve',
    entity: 'claim', entityId: 'CLM-2026-00131', ipAddress: '192.168.1.108', status: 'success',
    method: 'POST', endpoint: '/api/workflow/checker/approve',
    metadata: { comments: 'Final approval granted. Amount within policy limits.', invoiceAmount: 56000 },
    createdAt: '2026-04-15T11:30:00Z',
  },
  {
    id: '12', username: 'Sarah Wambui', userRole: 'claims_officer', action: 'return_to_provider',
    entity: 'claim', entityId: 'CLM-2026-00130', ipAddress: '192.168.1.112', status: 'success',
    method: 'POST', endpoint: '/api/workflow/checker/return-to-provider',
    metadata: { missingDocuments: ['Discharge Summary', 'Lab Results'], reason: 'Incomplete documentation' },
    createdAt: '2026-04-15T11:45:00Z',
  },
]

const actionColors: Record<string, string> = {
  login: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  logout: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  approve_claim: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  checker_approve: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  reject_claim: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  assign_claim: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  create_user: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  update_claim: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  submit_batch: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  batch_process: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
  ocr_process: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  return_to_provider: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
}

const PAGE_SIZE = 50

export default function ActivityLogs() {
  const [logs, setLogs] = useState<ActivityLog[]>(DEMO_LOGS)
  const [total, setTotal] = useState(DEMO_LOGS.length)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchLogs = useCallback(async (off = 0) => {
    const token = localStorage.getItem('token')
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(off),
      ...(search && { search }),
      ...(actionFilter !== 'all' && { action: actionFilter }),
      ...(statusFilter !== 'all' && { status: statusFilter }),
    })
    try {
      const res = await fetch(`/api/activity-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setLogs(Array.isArray(data.logs) ? data.logs : DEMO_LOGS)
        setTotal(data.total ?? DEMO_LOGS.length)
        setOffset(off)
      }
    } catch { /* keep current data */ }
  }, [search, actionFilter, statusFilter])

  useEffect(() => {
    fetchLogs(0).finally(() => setLoading(false))
  }, [fetchLogs])

  useEffect(() => {
    setPage(1)
  }, [search, actionFilter, statusFilter])

  const refresh = async () => {
    setRefreshing(true)
    await fetchLogs(0)
    setRefreshing(false)
  }

  const displayLogs = loading
    ? logs
    : logs.filter(log => {
        const q = search.toLowerCase()
        const name = log.user?.name || log.username || ''
        const matchesSearch = !q || name.toLowerCase().includes(q)
          || (log.entityId?.toLowerCase() || '').includes(q)
          || (log.endpoint?.toLowerCase() || '').includes(q)
        const matchesAction = actionFilter === 'all' || log.action === actionFilter
        const matchesStatus = statusFilter === 'all' || log.status === statusFilter
        return matchesSearch && matchesAction && matchesStatus
      })

  const getDisplayName = (log: ActivityLog) => log.user?.name || log.username || 'System'
  const getDisplayRole = (log: ActivityLog) => log.user?.role || log.userRole

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id)

  const renderDetails = (log: ActivityLog) => {
    const items: { label: string; value: string }[] = []
    if (log.method && log.endpoint) items.push({ label: 'Request', value: `${log.method} ${log.endpoint}` })
    if (log.userAgent) items.push({ label: 'User Agent', value: log.userAgent })
    if (log.errorMessage) items.push({ label: 'Error', value: log.errorMessage })
    if (log.oldValue) items.push({ label: 'Before', value: JSON.stringify(log.oldValue, null, 0) })
    if (log.newValue) items.push({ label: 'After', value: JSON.stringify(log.newValue, null, 0) })
    if (log.metadata) {
      Object.entries(log.metadata).forEach(([k, v]) =>
        items.push({ label: k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '), value: String(v) })
      )
    }
    return items
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activity Logs</h1>
          <p className="text-muted-foreground">System-wide audit trail of all user actions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by user, entity, or endpoint…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Action" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="approve_claim">Approve Claim</SelectItem>
                  <SelectItem value="checker_approve">Checker Approve</SelectItem>
                  <SelectItem value="reject_claim">Reject Claim</SelectItem>
                  <SelectItem value="assign_claim">Assign Claim</SelectItem>
                  <SelectItem value="update_claim">Update Claim</SelectItem>
                  <SelectItem value="return_to_provider">Return to Provider</SelectItem>
                  <SelectItem value="submit_batch">Batch Submit</SelectItem>
                  <SelectItem value="batch_process">Batch Process</SelectItem>
                  <SelectItem value="create_user">Create User</SelectItem>
                  <SelectItem value="ocr_process">OCR Process</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failure">Failure</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayLogs.slice((page - 1) * pageSize, page * pageSize).map((log) => {
                const isExpanded = expandedId === log.id
                const details = renderDetails(log)
                return (
                  <React.Fragment key={log.id}>
                    <TableRow
                      className={`cursor-pointer hover:bg-muted/40 ${log.status === 'failure' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                      onClick={() => toggleExpand(log.id)}
                    >
                      <TableCell className="pr-0">
                        {details.length > 0
                          ? isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          : null
                        }
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                          {formatDateTime(log.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{getDisplayName(log)}</p>
                          {getDisplayRole(log) && (
                            <p className="text-xs text-muted-foreground capitalize">
                              {getDisplayRole(log)!.replace(/_/g, ' ')}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={actionColors[log.action] || 'bg-gray-100 text-gray-800'} variant="secondary">
                          {log.action.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.entityId ? (
                          <div>
                            <span className="text-sm font-mono">{log.entityId}</span>
                            {log.entity && (
                              <p className="text-[10px] text-muted-foreground capitalize">{log.entity}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.method && log.endpoint ? (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">
                              {log.method}
                            </Badge>
                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px]" title={log.endpoint}>
                              {log.endpoint}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{log.ipAddress}</TableCell>
                      <TableCell>
                        <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                          {log.status}
                        </Badge>
                      </TableCell>
                    </TableRow>

                    {isExpanded && details.length > 0 && (
                      <TableRow key={`${log.id}-detail`} className="bg-muted/20">
                        <TableCell colSpan={8} className="pt-1 pb-3 pl-10">
                          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-3">
                            {details.map(({ label, value }) => (
                              <div key={label}>
                                <span className="text-muted-foreground capitalize">{label}: </span>
                                <span className={`font-mono break-all ${label === 'Error' ? 'text-red-600' : ''}`}>
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })}
              {displayLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No logs found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={displayLogs.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
