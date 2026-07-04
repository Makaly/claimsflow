import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Shield, Edit, Trash2, Lock, RefreshCw, Search, Users as UsersIcon,
  CheckCircle2, XCircle, UserPlus, UserMinus, Sparkles, KeyRound, Sliders,
  Star, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { rbacService, Role, Permission, UserRole } from '@/services/rbacService'
import { formatDate, getInitials } from '@/lib/utils'
import api from '@/services/api'

interface FormState {
  name: string
  displayName: string
  description: string
  isActive: boolean
  selected: Set<string>
}

interface ApiUser {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  provider?: { name: string } | null
}

const EMPTY_FORM: FormState = {
  name: '',
  displayName: '',
  description: '',
  isActive: true,
  selected: new Set(),
}

// Subtle per-resource accent so the permissions grid is scannable.
const RESOURCE_HUES: Record<string, string> = {
  claims: 'from-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  documents: 'from-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  users: 'from-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  providers: 'from-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  branches: 'from-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
  batches: 'from-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  reports: 'from-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  roles: 'from-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  permissions: 'from-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
  system_config: 'from-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
  activity_logs: 'from-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
}

function hueFor(resource: string) {
  return RESOURCE_HUES[resource] ?? 'from-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20'
}

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  const [showDialog, setShowDialog] = useState(false)
  const [dialogTab, setDialogTab] = useState('details')
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, selected: new Set() })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null)

  // Role-users state (Users tab inside the dialog)
  const [allUsers, setAllUsers] = useState<ApiUser[]>([])
  const [assignedUsers, setAssignedUsers] = useState<UserRole[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userSaving, setUserSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rs, ps] = await Promise.all([
        rbacService.listRoles(),
        rbacService.listPermissions(),
      ])
      setRoles(rs)
      setPermissions(ps)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load roles')
    }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return roles
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.displayName ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    )
  }, [roles, search])

  const permissionsByResource = useMemo(() => {
    const groups = new Map<string, Permission[]>()
    for (const p of permissions) {
      if (!groups.has(p.resource)) groups.set(p.resource, [])
      groups.get(p.resource)!.push(p)
    }
    for (const list of groups.values()) list.sort((a, b) => a.action.localeCompare(b.action))
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [permissions])

  // ── Dialog lifecycle ──────────────────────────────────────────────────────

  const resetDialog = () => {
    setEditing(null)
    setDialogTab('details')
    setError(null)
    setAllUsers([])
    setAssignedUsers([])
    setUserSearch('')
  }

  const openAdd = () => {
    resetDialog()
    setForm({ ...EMPTY_FORM, selected: new Set() })
    setShowDialog(true)
  }

  const openEdit = (role: Role) => {
    resetDialog()
    setEditing(role)
    setForm({
      name: role.name,
      displayName: role.displayName ?? '',
      description: role.description ?? '',
      isActive: role.isActive,
      selected: new Set(role.rolePermissions.map((rp) => rp.permission.name)),
    })
    setShowDialog(true)
  }

  // Fetch users lazily when the Users tab is opened on an existing role.
  const loadUsers = useCallback(async () => {
    if (!editing) return
    setUsersLoading(true)
    try {
      const [usersRes, urs] = await Promise.all([
        api.get('/users?limit=500').then(({ data }) => data).catch(() => ({ users: [] })),
        rbacService.getRole(editing.id),
      ])
      setAllUsers(Array.isArray(usersRes.users) ? usersRes.users : [])
      setAssignedUsers(
        (urs.userRoles ?? []).map((ur: any) => ({
          id: ur.id,
          userId: ur.userId,
          roleId: ur.roleId,
          assignedAt: ur.assignedAt,
          assignedBy: ur.assignedBy,
          role: urs,
        })),
      )
    } catch { /* ignore */ } finally {
      setUsersLoading(false)
    }
  }, [editing])

  useEffect(() => {
    if (showDialog && editing && dialogTab === 'users' && allUsers.length === 0) {
      loadUsers()
    }
  }, [showDialog, editing, dialogTab, allUsers.length, loadUsers])

  // ── Permissions grid ──────────────────────────────────────────────────────

  const togglePerm = (name: string, checked: boolean) => {
    setForm((f) => {
      const next = new Set(f.selected)
      if (checked) next.add(name)
      else next.delete(name)
      return { ...f, selected: next }
    })
  }

  const toggleResource = (resource: string, checked: boolean) => {
    const group = permissionsByResource.find(([r]) => r === resource)?.[1] ?? []
    setForm((f) => {
      const next = new Set(f.selected)
      for (const p of group) {
        if (checked) next.add(p.name)
        else next.delete(p.name)
      }
      return { ...f, selected: next }
    })
  }

  // ── Users tab actions ─────────────────────────────────────────────────────

  const assignedUserIds = useMemo(
    () => new Set(assignedUsers.map((u) => u.userId)),
    [assignedUsers],
  )

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase()
    if (!q) return allUsers
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.role ?? '').toLowerCase().includes(q),
    )
  }, [allUsers, userSearch])

  const toggleUserInRole = async (userId: string, checked: boolean) => {
    if (!editing) return
    setUserSaving(userId)
    try {
      if (checked) {
        await rbacService.assignRole(userId, editing.name)
      } else {
        await rbacService.revokeRole(userId, editing.name)
      }
      // Refetch the assignments from server for this role.
      const fresh = await rbacService.getRole(editing.id)
      setAssignedUsers(
        (fresh.userRoles ?? []).map((ur: any) => ({
          id: ur.id,
          userId: ur.userId,
          roleId: ur.roleId,
          assignedAt: ur.assignedAt,
          assignedBy: ur.assignedBy,
          role: fresh,
        })),
      )
      // Update list header counts.
      setRoles((prev) =>
        prev.map((r) =>
          r.id === editing.id
            ? { ...r, _count: { userRoles: fresh.userRoles?.length ?? 0 } }
            : r,
        ),
      )
    } catch { /* ignore */ } finally {
      setUserSaving(null)
    }
  }

  // ── Save / delete ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const permsArr = Array.from(form.selected)
      if (editing) {
        await rbacService.updateRole(editing.id, {
          displayName: form.displayName || undefined,
          description: form.description || undefined,
          isActive: form.isActive,
          permissions: permsArr,
        })
      } else {
        if (!form.name.trim()) {
          setError('Role name is required')
          setSaving(false)
          return
        }
        await rbacService.createRole({
          name: form.name.trim(),
          displayName: form.displayName || undefined,
          description: form.description || undefined,
          permissions: permsArr,
        })
      }
      setShowDialog(false)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save role')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      await rbacService.deleteRole(deleteConfirm.id)
      setDeleteConfirm(null)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to delete role')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const totalPerms = permissions.length
  const selectedPct = totalPerms > 0 ? (form.selected.size / totalPerms) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
          <p className="text-muted-foreground">
            Define roles, assign permissions, and map users in one place
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> New Role
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Total Roles"
          value={loading ? '…' : roles.length}
          icon={<Shield className="h-4 w-4" />}
          tint="bg-primary/10 text-primary"
        />
        <StatCard
          label="Active"
          value={loading ? '…' : roles.filter((r) => r.isActive).length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="System Roles"
          value={loading ? '…' : roles.filter((r) => r.isSystem).length}
          icon={<Lock className="h-4 w-4" />}
          tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Permissions"
          value={loading ? '…' : permissions.length}
          icon={<KeyRound className="h-4 w-4" />}
          tint="bg-purple-500/10 text-purple-600 dark:text-purple-400"
        />
      </div>

      {error && !showDialog && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Roles table */}
      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search roles…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((role) => (
                <TableRow
                  key={role.id}
                  className="cursor-pointer"
                  onClick={() => openEdit(role)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
                        <Shield className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-sm">
                            {role.displayName ?? role.name}
                          </p>
                          {role.isSystem && (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {role.name}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    <p className="line-clamp-2">{role.description ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <KeyRound className="h-2.5 w-2.5" />
                      {role.rolePermissions.length}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <UsersIcon className="h-2.5 w-2.5" />
                      {role._count?.userRoles ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {role.isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Active
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <XCircle className="h-2.5 w-2.5" /> Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(role.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(role)}
                        title="Edit role"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive disabled:opacity-30"
                        disabled={role.isSystem}
                        onClick={() => setDeleteConfirm(role)}
                        title={
                          role.isSystem
                            ? 'System roles cannot be deleted'
                            : 'Delete role'
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    {loading ? 'Loading…' : 'No roles found'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Role editor dialog ───────────────────────────────────────────── */}
      <Dialog
        open={showDialog}
        onOpenChange={(v) => {
          if (!v) { setShowDialog(false); resetDialog() }
        }}
      >
        <DialogContent className="max-w-4xl p-0 max-h-[92vh] overflow-hidden flex flex-col gap-0">
          {/* Gradient header */}
          <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary/10 via-background to-background px-6 py-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,theme(colors.primary/15),transparent_60%)] pointer-events-none" />
            <DialogHeader className="relative">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-xl flex items-center gap-2">
                    {editing
                      ? `${editing.displayName ?? editing.name}`
                      : 'New role'}
                    {editing?.isSystem && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Lock className="h-2.5 w-2.5" /> System
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {editing
                      ? 'Manage the role — its details, the permissions it grants, and the users who hold it.'
                      : 'Create a new role, pick the permissions it grants, then assign users.'}
                  </DialogDescription>
                  {editing && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <KeyRound className="h-2.5 w-2.5" />
                        {form.selected.size} permission{form.selected.size !== 1 ? 's' : ''}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <UsersIcon className="h-2.5 w-2.5" />
                        {editing._count?.userRoles ?? 0} user{(editing._count?.userRoles ?? 0) !== 1 ? 's' : ''}
                      </Badge>
                      {form.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <XCircle className="h-2.5 w-2.5" /> Inactive
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </DialogHeader>
          </div>

          <Tabs value={dialogTab} onValueChange={setDialogTab} className="flex-1 flex flex-col min-h-0">
            <div className="border-b px-6 pt-3 bg-muted/20">
              <TabsList className="h-10">
                <TabsTrigger value="details" className="gap-1.5">
                  <Sliders className="h-3.5 w-3.5" /> Details
                </TabsTrigger>
                <TabsTrigger value="permissions" className="gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" /> Permissions
                  <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1.5">
                    {form.selected.size}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="users"
                  className="gap-1.5"
                  disabled={!editing}
                >
                  <UsersIcon className="h-3.5 w-3.5" /> Users
                  {editing && (
                    <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1.5">
                      {assignedUsers.length || editing._count?.userRoles || 0}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ── Details ─────────────────────────────────────────────── */}
              <TabsContent value="details" className="m-0 p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      Internal name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      placeholder="e.g. claims_reviewer"
                      value={form.name}
                      disabled={!!editing}
                      className="font-mono text-sm"
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          name: e.target.value.replace(/[^a-z0-9_]/g, '_').toLowerCase(),
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Lowercase, underscores only. Locked after creation.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display name</Label>
                    <Input
                      placeholder="e.g. Claims Reviewer"
                      value={form.displayName}
                      onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Shown in menus and tables.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea
                    rows={3}
                    placeholder="What this role is for…"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${form.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {form.isActive ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {form.isActive ? 'Role is active' : 'Role is inactive'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Inactive roles don't grant permissions to their users.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                    disabled={!editing}
                  />
                </div>

                {editing && (
                  <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">Created</p>
                      <p className="font-medium">{formatDate(editing.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last updated</p>
                      <p className="font-medium">{formatDate(editing.updatedAt)}</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Permissions ─────────────────────────────────────────── */}
              <TabsContent value="permissions" className="m-0 flex flex-col">
                <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-6 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {form.selected.size} of {totalPerms} permissions selected
                      </p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-primary/70 to-primary transition-all"
                          style={{ width: `${selectedPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            selected: new Set(permissions.map((p) => p.name)),
                          }))
                        }
                      >
                        <Sparkles className="mr-1.5 h-3 w-3" /> Select all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setForm((f) => ({ ...f, selected: new Set() }))}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="p-6 grid gap-3">
                  {permissionsByResource.map(([resource, perms]) => {
                    const allChecked = perms.every((p) => form.selected.has(p.name))
                    const someChecked = perms.some((p) => form.selected.has(p.name))
                    const selCount = perms.filter((p) => form.selected.has(p.name)).length
                    const hue = hueFor(resource)
                    return (
                      <div
                        key={resource}
                        className={`rounded-xl border overflow-hidden transition-colors ${
                          allChecked ? 'border-primary/40 shadow-sm' : ''
                        }`}
                      >
                        <div className={`flex items-center gap-3 bg-gradient-to-r ${hue} border-b px-4 py-2.5`}>
                          <Checkbox
                            checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                            onCheckedChange={(v) => toggleResource(resource, !!v)}
                          />
                          <p className="text-xs font-bold uppercase tracking-wider flex-1">
                            {resource.replace(/_/g, ' ')}
                          </p>
                          <Badge
                            variant={allChecked ? 'default' : 'outline'}
                            className="text-[10px] tabular-nums"
                          >
                            {selCount} / {perms.length}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-2">
                          {perms.map((p) => {
                            const checked = form.selected.has(p.name)
                            return (
                              <label
                                key={p.id}
                                className={`flex items-start gap-2 text-xs cursor-pointer rounded-md p-2 transition-colors ${
                                  checked
                                    ? 'bg-primary/5 hover:bg-primary/10'
                                    : 'hover:bg-muted/50'
                                }`}
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={checked}
                                  onCheckedChange={(v) => togglePerm(p.name, !!v)}
                                />
                                <div className="min-w-0">
                                  <p className="font-mono text-[11px] font-medium">
                                    {p.action}
                                  </p>
                                  {p.description && (
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                                      {p.description}
                                    </p>
                                  )}
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {permissionsByResource.length === 0 && (
                    <div className="p-12 text-center text-sm text-muted-foreground">
                      No permissions found
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Users ────────────────────────────────────────────────── */}
              <TabsContent value="users" className="m-0 flex flex-col">
                <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-6 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search users by name, email, or role…"
                        className="pl-9"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <Badge variant="outline" className="gap-1">
                      <UserPlus className="h-3 w-3" /> {assignedUsers.length} in role
                    </Badge>
                  </div>
                </div>

                <div className="p-4">
                  {usersLoading ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      Loading users…
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      {userSearch ? 'No users match your search.' : 'No users found.'}
                    </div>
                  ) : (
                    <div className="grid gap-1.5">
                      {filteredUsers.map((u) => {
                        const held = assignedUserIds.has(u.id)
                        const isPrimary = u.role === editing?.name
                        const saving = userSaving === u.id
                        return (
                          <div
                            key={u.id}
                            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                              held
                                ? 'bg-primary/5 border-primary/30'
                                : 'hover:bg-muted/40'
                            }`}
                          >
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="text-xs bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
                                {getInitials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium truncate">{u.name}</p>
                                {isPrimary && (
                                  <Badge variant="secondary" className="text-[9px] gap-1">
                                    <Star className="h-2.5 w-2.5 fill-current" /> Primary
                                  </Badge>
                                )}
                                {!u.isActive && (
                                  <Badge variant="destructive" className="text-[9px]">
                                    Inactive
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="truncate">{u.email}</span>
                                <span className="opacity-30">·</span>
                                <span className="font-mono">{u.role?.replace(/_/g, ' ') || '—'}</span>
                              </div>
                            </div>
                            <Button
                              variant={held ? 'outline' : 'default'}
                              size="sm"
                              className="h-8 text-xs shrink-0"
                              disabled={saving}
                              onClick={() => toggleUserInRole(u.id, !held)}
                            >
                              {saving ? (
                                '…'
                              ) : held ? (
                                <>
                                  <UserMinus className="mr-1.5 h-3 w-3" /> Remove
                                </>
                              ) : (
                                <>
                                  <UserPlus className="mr-1.5 h-3 w-3" /> Add
                                </>
                              )}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="border-t bg-muted/20 px-6 py-3">
            {error && (
              <p className="mr-auto text-xs text-destructive">{error}</p>
            )}
            <Button variant="outline" onClick={() => { setShowDialog(false); resetDialog() }}>
              {editing ? 'Close' : 'Cancel'}
            </Button>
            {dialogTab !== 'users' && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Role'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ──────────────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete role</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleteConfirm?.displayName ?? deleteConfirm?.name}</strong>?
              {(deleteConfirm?._count?.userRoles ?? 0) > 0 && (
                <span className="mt-2 block text-amber-600">
                  {deleteConfirm?._count?.userRoles} user(s) currently hold this role.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, tint,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  tint: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}
