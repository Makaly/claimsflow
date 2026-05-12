import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search, Plus, MoreHorizontal, Shield, Eye, Edit, Trash2,
  UserCheck, UserX, Key, RefreshCw, Building2, GitBranch,
  Link2, Unlink, Users, ChevronDown, ChevronRight, Copy, Check,
} from 'lucide-react'
import { Pagination } from '@/components/Pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getInitials, formatDate } from '@/lib/utils'
import { rbacService, Role, UserRole } from '@/services/rbacService'
import { Checkbox } from '@/components/ui/checkbox'

// ── Types ──────────────────────────────────────────────────────────────────

interface MappedUser {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  twoFactorEnabled?: boolean
  lastLogin?: string
  createdAt: string
  requirePasswordChange?: boolean
  providerId?: string
  branchId?: string
  provider?: { id: string; name: string; type: string; licenseNumber: string; status: string } | null
  branch?: { name: string; code: string } | null
}

interface Provider {
  id: string
  name: string
  type: string
  licenseNumber: string
  status: string
}

interface Branch {
  id: string
  name: string
  code: string
  providerId: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEMO_USERS: MappedUser[] = [
  { id: '1', name: 'Admin User', email: 'admin@cic.co.ke', role: 'admin', isActive: true, twoFactorEnabled: true, lastLogin: '2026-04-10T08:00:00Z', createdAt: '2025-01-01' },
  { id: '2', name: 'Jane Mwangi', email: 'jane@cic.co.ke', role: 'claims_officer', isActive: true, twoFactorEnabled: true, lastLogin: '2026-04-10T09:30:00Z', createdAt: '2025-02-15' },
  { id: '3', name: 'Sarah Wambui', email: 'sarah@cic.co.ke', role: 'supervisor', isActive: true, twoFactorEnabled: true, lastLogin: '2026-04-10T07:45:00Z', createdAt: '2025-01-20' },
  { id: '4', name: 'Dr. James Maina', email: 'admin@nairobihospital.co.ke', role: 'provider_admin', isActive: true, twoFactorEnabled: false, lastLogin: '2026-04-09T16:00:00Z', createdAt: '2025-05-15', providerId: 'p1', provider: { id: 'p1', name: 'Nairobi Hospital', type: 'hospital', licenseNumber: 'LIC-001', status: 'approved' } },
  { id: '5', name: 'Grace Njeri', email: 'claims@nairobihospital.co.ke', role: 'provider_user', isActive: true, twoFactorEnabled: false, lastLogin: '2026-04-08T11:00:00Z', createdAt: '2025-06-01', providerId: 'p1', branchId: 'b1', provider: { id: 'p1', name: 'Nairobi Hospital', type: 'hospital', licenseNumber: 'LIC-001', status: 'approved' }, branch: { name: 'Nairobi HQ', code: 'NBI-HQ' } },
  { id: '6', name: 'Dr. Fatima Omar', email: 'admin@agakhan.org', role: 'provider_admin', isActive: true, twoFactorEnabled: false, lastLogin: '2026-04-09T10:00:00Z', createdAt: '2025-05-20', providerId: 'p2', provider: { id: 'p2', name: 'Aga Khan University Hospital', type: 'hospital', licenseNumber: 'LIC-002', status: 'approved' } },
]

const roleColors: Record<string, string> = {
  admin:          'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  supervisor:     'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  claims_officer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  checker:        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  provider_admin: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  provider_user:  'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
}

const providerRoles = ['provider_admin', 'provider_user']

const EMPTY_FORM = {
  name: '', email: '', role: 'claims_officer', password: '',
  providerId: '', branchId: '',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge className={roleColors[role] ?? 'bg-gray-100 text-gray-700'} variant="secondary">
      {role.replace(/_/g, ' ')}
    </Badge>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function UserManagement() {
  const [users, setUsers] = useState<MappedUser[]>(DEMO_USERS)
  const [total, setTotal] = useState(DEMO_USERS.length)
  const [providers, setProviders] = useState<Provider[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('users')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [showDialog, setShowDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<MappedUser | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<MappedUser | null>(null)

  const [rolesDialog, setRolesDialog] = useState<MappedUser | null>(null)
  const [allRoles, setAllRoles] = useState<Role[]>([])
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [rolesSaving, setRolesSaving] = useState<string | null>(null)

  const token = () => localStorage.getItem('token')
  const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('search', search)
      if (roleFilter !== 'all') params.set('role', roleFilter)
      const res = await fetch(`/api/users?${params}`, { headers: h() })
      if (res.ok) {
        const data = await res.json()
        setUsers(Array.isArray(data.users) ? data.users : DEMO_USERS)
        setTotal(data.total ?? DEMO_USERS.length)
      }
    } catch { /* keep demo */ }
  }, [search, roleFilter])

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/providers', { headers: h() })
      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data) ? data : Array.isArray(data.providers) ? data.providers : []
        setProviders(list.filter((p: Provider) => p.status === 'approved'))
      }
    } catch { /* ignore */ }
  }, [])

  const fetchBranches = useCallback(async (providerId?: string) => {
    if (!providerId) { setBranches([]); return }
    try {
      const res = await fetch(`/api/branches?providerId=${providerId}`, { headers: h() })
      if (res.ok) {
        const data = await res.json()
        setBranches(Array.isArray(data) ? data : Array.isArray(data.branches) ? data.branches : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    Promise.all([fetchUsers(), fetchProviders()]).finally(() => setLoading(false))
  }, [fetchUsers, fetchProviders])

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchUsers(), fetchProviders()])
    setRefreshing(false)
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u =>
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      && (roleFilter === 'all' || u.role === roleFilter)
    )
  }, [users, search, roleFilter])

  // Reset to page 1 whenever the filtered result set changes (search / role / data)
  useEffect(() => { setPage(1) }, [search, roleFilter, pageSize])

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Group users by provider for the Mappings tab
  const providerMappings = useMemo(() => {
    const map = new Map<string, { provider: Provider; users: MappedUser[] }>()

    // Seed with all providers (even those with no users yet)
    providers.forEach(p => map.set(p.id, { provider: p, users: [] }))

    users.filter(u => u.providerId).forEach(u => {
      if (!map.has(u.providerId!)) {
        const prov = u.provider ?? { id: u.providerId!, name: '(Unknown)', type: '', licenseNumber: '', status: '' }
        map.set(u.providerId!, { provider: prov, users: [] })
      }
      map.get(u.providerId!)!.users.push(u)
    })

    return Array.from(map.values()).sort((a, b) => a.provider.name.localeCompare(b.provider.name))
  }, [users, providers])

  const unmappedUsers = users.filter(u => !u.providerId && providerRoles.includes(u.role))

  const stats = {
    total,
    active: users.filter(u => u.isActive).length,
    providers: users.filter(u => u.providerId).length,
    unmapped: unmappedUsers.length,
  }

  // ── CRUD helpers ──────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditingUser(null)
    setForm({ ...EMPTY_FORM })
    setTempPassword(null)
    setBranches([])
    setShowDialog(true)
  }

  const openEdit = (user: MappedUser) => {
    setEditingUser(user)
    setForm({
      name: user.name, email: user.email, role: user.role, password: '',
      providerId: user.providerId ?? '',
      branchId: user.branchId ?? '',
    })
    setTempPassword(null)
    if (user.providerId) fetchBranches(user.providerId)
    setShowDialog(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.email || !form.role) return
    setSaving(true)
    setTempPassword(null)
    try {
      const body: any = {
        name: form.name, email: form.email, role: form.role,
        providerId: form.providerId || null,
        branchId: form.branchId || null,
      }

      if (editingUser) {
        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PATCH', headers: h(), body: JSON.stringify(body),
        })
        if (res.ok) {
          const updated = await res.json()
          setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...updated } : u))
          setShowDialog(false)
        }
      } else {
        if (form.password) body.password = form.password
        const res = await fetch('/api/users', {
          method: 'POST', headers: h(), body: JSON.stringify(body),
        })
        if (res.ok) {
          const created = await res.json()
          if (created.tempPassword) {
            setTempPassword(created.tempPassword)
          } else {
            setShowDialog(false)
          }
          setUsers(prev => [created, ...prev])
          setTotal(t => t + 1)
        }
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleToggleActive = async (user: MappedUser) => {
    const endpoint = user.isActive ? 'deactivate' : 'activate'
    try {
      const res = await fetch(`/api/users/${user.id}/${endpoint}`, { method: 'POST', headers: h() })
      if (res.ok) setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u))
    } catch { /* ignore */ }
  }

  const handleResetPassword = async (user: MappedUser) => {
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: 'POST', headers: h() })
      if (res.ok) {
        const data = await res.json()
        setTempPassword(data.tempPassword)
        setEditingUser(user)
        setShowDialog(true)
      }
    } catch { /* ignore */ }
  }

  const handleDelete = async (user: MappedUser) => {
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE', headers: h() })
      if (res.ok) { setUsers(prev => prev.filter(u => u.id !== user.id)); setTotal(t => t - 1) }
    } catch { /* ignore */ }
    setDeleteConfirm(null)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  // ── Role management ───────────────────────────────────────────────────────

  const openManageRoles = async (user: MappedUser) => {
    setRolesDialog(user)
    setRolesLoading(true)
    try {
      const [rs, urs] = await Promise.all([
        rbacService.listRoles(),
        rbacService.listUserRoles(user.id),
      ])
      setAllRoles(rs.filter((r) => r.isActive))
      setUserRoles(urs)
    } catch { /* ignore */ } finally {
      setRolesLoading(false)
    }
  }

  const toggleUserRole = async (user: MappedUser, roleName: string, checked: boolean) => {
    setRolesSaving(roleName)
    try {
      const updated = checked
        ? await rbacService.assignRole(user.id, roleName)
        : await rbacService.revokeRole(user.id, roleName)
      setUserRoles(updated)
    } catch { /* ignore */ } finally {
      setRolesSaving(null)
    }
  }

  const makePrimary = async (user: MappedUser, roleName: string) => {
    setRolesSaving(roleName)
    try {
      const updated = await rbacService.setPrimaryRole(user.id, roleName)
      setUserRoles(updated)
      // Reflect the primary role change on the row.
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: roleName } : u))
    } catch { /* ignore */ } finally {
      setRolesSaving(null)
    }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">Manage system users and their provider assignments</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total Users',      value: loading ? '…' : stats.total,     color: 'text-foreground' },
          { label: 'Active',           value: loading ? '…' : stats.active,    color: 'text-emerald-600' },
          { label: 'Mapped to Provider', value: loading ? '…' : stats.providers, color: 'text-blue-600' },
          { label: 'Unmapped Provider Staff', value: loading ? '…' : stats.unmapped, color: 'text-amber-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Unmapped warning */}
      {unmappedUsers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/10 dark:border-amber-800 px-4 py-3 flex items-center gap-3">
          <Unlink className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">{unmappedUsers.length} provider staff account{unmappedUsers.length !== 1 ? 's' : ''}</span>
            {' '}not yet mapped to a provider: {unmappedUsers.map(u => u.name).join(', ')}
          </p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="users">
            <Users className="mr-1.5 h-3.5 w-3.5" /> All Users ({users.length})
          </TabsTrigger>
          <TabsTrigger value="mappings">
            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Provider Mappings ({providerMappings.length})
          </TabsTrigger>
        </TabsList>

        {/* ── All Users tab ──────────────────────────────────────────────── */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Roles" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="claims_officer">Claims Officer</SelectItem>
                    <SelectItem value="checker">Checker</SelectItem>
                    <SelectItem value="provider_admin">Provider Admin</SelectItem>
                    <SelectItem value="provider_user">Provider User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>2FA</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map(user => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10">{getInitials(user.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{user.name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={user.role} /></TableCell>
                      <TableCell>
                        {user.provider ? (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Building2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            <div>
                              <p className="font-medium">{user.provider.name}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{user.provider.licenseNumber}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.branch ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <GitBranch className="h-3 w-3 text-teal-500 shrink-0" />
                            <div>
                              <p className="font-medium">{user.branch.name}</p>
                              <p className="font-mono text-muted-foreground">{user.branch.code}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? 'default' : 'destructive'} className="text-[10px]">
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Shield className={`h-4 w-4 ${user.twoFactorEnabled ? 'text-emerald-500' : 'text-muted-foreground/25'}`} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {user.lastLogin ? formatDate(user.lastLogin) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(user)}>
                              <Edit className="mr-2 h-3.5 w-3.5" /> Edit / Remap
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openManageRoles(user)}>
                              <Shield className="mr-2 h-3.5 w-3.5" /> Manage Roles
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetPassword(user)}>
                              <Key className="mr-2 h-3.5 w-3.5" /> Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className={user.isActive ? 'text-destructive' : 'text-emerald-600'}
                              onClick={() => handleToggleActive(user)}
                            >
                              {user.isActive
                                ? <><UserX className="mr-2 h-3.5 w-3.5" /> Deactivate</>
                                : <><UserCheck className="mr-2 h-3.5 w-3.5" /> Activate</>}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(user)}>
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                        No users found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {filtered.length > 0 && (
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={filtered.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Provider Mappings tab ──────────────────────────────────────── */}
        <TabsContent value="mappings" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Each approved provider and the users assigned to manage or upload invoices for them.
          </p>

          {providerMappings.map(({ provider, users: pUsers }) => (
            <ProviderMappingCard
              key={provider.id}
              provider={provider}
              users={pUsers}
              onEdit={openEdit}
            />
          ))}

          {providerMappings.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Building2 className="h-8 w-8 opacity-30" />
                <p>No approved providers found</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={v => { if (!v) { setShowDialog(false); setEditingUser(null); setTempPassword(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingUser ? `Edit ${editingUser.name}` : 'Add New User'}</DialogTitle>
            <DialogDescription>
              {editingUser ? 'Update user details and provider assignment' : 'Create a new user account and optionally map to a provider'}
            </DialogDescription>
          </DialogHeader>

          {tempPassword ? (
            /* Show generated password */
            <div className="space-y-4 py-4">
              <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-3">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {editingUser ? 'Password reset successfully' : 'User created successfully'}
                </p>
                <div className="relative">
                  <div className="rounded-lg bg-muted px-4 py-3 font-mono text-xl tracking-widest text-center select-all">
                    {tempPassword}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => copyToClipboard(tempPassword)}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this temporary password with <strong>{editingUser?.name}</strong>. They will be required to change it on first login.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 py-2">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Full Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email <span className="text-destructive">*</span></Label>
                  <Input type="email" placeholder="user@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Role <span className="text-destructive">*</span></Label>
                  <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v, providerId: '', branchId: '' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="claims_officer">Claims Officer</SelectItem>
                      <SelectItem value="checker">Checker</SelectItem>
                      <SelectItem value="provider_admin">Provider Admin</SelectItem>
                      <SelectItem value="provider_user">Provider User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!editingUser && (
                  <div className="space-y-1.5">
                    <Label>Password <span className="text-muted-foreground text-xs font-normal">(auto if blank)</span></Label>
                    <Input type="password" placeholder="Leave blank to auto-generate" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                )}
              </div>

              {/* Provider assignment (only for provider roles) */}
              {providerRoles.includes(form.role) && (
                <>
                  <Separator />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Provider Assignment
                  </p>

                  <div className="space-y-1.5">
                    <Label>Provider <span className="text-destructive">*</span></Label>
                    <Select
                      value={form.providerId || '__none__'}
                      onValueChange={v => {
                        const id = v === '__none__' ? '' : v
                        setForm(f => ({ ...f, providerId: id, branchId: '' }))
                        fetchBranches(id)
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not assigned —</SelectItem>
                        {providers.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            <span className="ml-2 text-xs text-muted-foreground font-mono">({p.licenseNumber})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Branch (only for provider_user) */}
                  {form.role === 'provider_user' && (
                    <div className="space-y-1.5">
                      <Label>Branch <span className="text-muted-foreground text-xs font-normal">(optional — leave blank for provider-level access)</span></Label>
                      <Select
                        value={form.branchId || '__none__'}
                        onValueChange={v => setForm(f => ({ ...f, branchId: v === '__none__' ? '' : v }))}
                        disabled={!form.providerId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={form.providerId ? 'Select branch' : 'Select provider first'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— All branches —</SelectItem>
                          {branches.map(b => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                              <span className="ml-2 text-xs font-mono text-muted-foreground">({b.code})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Branch users only see claims for their assigned branch
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditingUser(null); setTempPassword(null) }}>
              {tempPassword ? 'Close' : 'Cancel'}
            </Button>
            {!tempPassword && (
              <Button onClick={handleSave} disabled={saving || !form.name || !form.email}>
                {saving ? 'Saving…' : editingUser ? 'Save Changes' : 'Create User'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage Roles Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!rolesDialog} onOpenChange={(v) => { if (!v) setRolesDialog(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage roles</DialogTitle>
            <DialogDescription>
              Assign or revoke roles for <strong>{rolesDialog?.name}</strong>. The
              user receives the union of all granted permissions.
            </DialogDescription>
          </DialogHeader>

          {rolesLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="py-2 space-y-2 max-h-[60vh] overflow-y-auto">
              {allRoles.map((role) => {
                const held = userRoles.some((ur) => ur.roleId === role.id)
                const isPrimary = rolesDialog?.role === role.name
                return (
                  <div
                    key={role.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      checked={held}
                      disabled={rolesSaving === role.name}
                      onCheckedChange={(v) =>
                        rolesDialog && toggleUserRole(rolesDialog, role.name, !!v)
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">
                          {role.displayName ?? role.name}
                        </p>
                        {isPrimary && (
                          <Badge variant="secondary" className="text-[9px]">Primary</Badge>
                        )}
                        {role.isSystem && (
                          <Badge variant="outline" className="text-[9px]">System</Badge>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {role.name} · {role.rolePermissions.length} permission
                        {role.rolePermissions.length !== 1 ? 's' : ''}
                      </p>
                      {role.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {role.description}
                        </p>
                      )}
                    </div>
                    {held && !isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={rolesSaving === role.name}
                        onClick={() =>
                          rolesDialog && makePrimary(rolesDialog, role.name)
                        }
                      >
                        Make primary
                      </Button>
                    )}
                  </div>
                )
              })}
              {allRoles.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No active roles available. Create one on the Roles page.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleteConfirm?.name}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Provider Mapping Card ──────────────────────────────────────────────────

function ProviderMappingCard({
  provider,
  users,
  onEdit,
}: {
  provider: Provider
  users: MappedUser[]
  onEdit: (u: MappedUser) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const admins  = users.filter(u => u.role === 'provider_admin')
  const uploaders = users.filter(u => u.role === 'provider_user')

  return (
    <Card className="overflow-hidden">
      {/* Provider header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 shrink-0">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{provider.name}</p>
          <p className="text-xs font-mono text-muted-foreground">{provider.licenseNumber} · {provider.type}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {users.length === 0
            ? <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">No users mapped</Badge>
            : <Badge variant="secondary" className="text-[10px]">{users.length} user{users.length !== 1 ? 's' : ''}</Badge>
          }
          <Badge className={provider.status === 'approved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px]' : 'text-[10px]'} variant="secondary">
            {provider.status}
          </Badge>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {users.length === 0 ? (
            <div className="px-6 py-6 text-sm text-muted-foreground flex items-center gap-2">
              <Unlink className="h-4 w-4 text-amber-500" />
              No users are currently mapped to this provider.
              Use <strong>Add User</strong> and assign this provider.
            </div>
          ) : (
            <div className="divide-y">
              {/* Admins */}
              {admins.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Shield className="h-3 w-3" /> Provider Admin{admins.length > 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {admins.map(u => <UserRow key={u.id} user={u} onEdit={onEdit} />)}
                  </div>
                </div>
              )}

              {/* Invoice uploaders */}
              {uploaders.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Eye className="h-3 w-3" /> Invoice Uploader{uploaders.length > 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {uploaders.map(u => <UserRow key={u.id} user={u} onEdit={onEdit} showBranch />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function UserRow({ user, onEdit, showBranch = false }: { user: MappedUser; onEdit: (u: MappedUser) => void; showBranch?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/30 group">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[10px] bg-primary/10">{getInitials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{user.name}</p>
          {!user.isActive && <Badge variant="destructive" className="text-[9px] py-0">Inactive</Badge>}
        </div>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        {showBranch && user.branch && (
          <div className="flex items-center gap-1 mt-0.5">
            <GitBranch className="h-3 w-3 text-teal-500" />
            <span className="text-[10px] text-teal-700 dark:text-teal-400">{user.branch.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground">({user.branch.code})</span>
          </div>
        )}
        {showBranch && !user.branch && (
          <span className="text-[10px] text-muted-foreground/60">All branches</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onEdit(user)}
      >
        <Edit className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
