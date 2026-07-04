import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, KeyRound, Trash2, Lock, RefreshCw, Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { rbacService, Permission } from '@/services/rbacService'

const EMPTY_FORM = { resource: '', action: '', description: '' }

export default function Permissions() {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  const [showDialog, setShowDialog] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<Permission | null>(null)

  const load = useCallback(async () => {
    try {
      const ps = await rbacService.listPermissions()
      setPermissions(ps)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load permissions')
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
    if (!q) return permissions
    return permissions.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.resource.toLowerCase().includes(q) ||
        p.action.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    )
  }, [permissions, search])

  const grouped = useMemo(() => {
    const groups = new Map<string, Permission[]>()
    for (const p of filtered) {
      if (!groups.has(p.resource)) groups.set(p.resource, [])
      groups.get(p.resource)!.push(p)
    }
    for (const list of groups.values()) list.sort((a, b) => a.action.localeCompare(b.action))
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const openAdd = () => {
    setForm({ ...EMPTY_FORM })
    setError(null)
    setShowDialog(true)
  }

  const handleSave = async () => {
    if (!form.resource.trim() || !form.action.trim()) {
      setError('Resource and action are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await rbacService.createPermission({
        resource: form.resource.trim().toLowerCase(),
        action: form.action.trim().toLowerCase(),
        description: form.description || undefined,
      })
      setShowDialog(false)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to create permission')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      await rbacService.deletePermission(deleteConfirm.id)
      setDeleteConfirm(null)
      await load()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to delete permission')
    }
  }

  const systemCount = permissions.filter((p) => p.isSystem).length
  const customCount = permissions.length - systemCount

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Permissions</h1>
          <p className="text-muted-foreground">
            The ACL catalogue — every action any role can grant
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add Permission
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Total', value: loading ? '…' : permissions.length, color: 'text-foreground' },
          { label: 'System', value: loading ? '…' : systemCount, color: 'text-blue-600' },
          { label: 'Custom', value: loading ? '…' : customCount, color: 'text-purple-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && !showDialog && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search permissions…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {grouped.map(([resource, perms]) => (
            <div key={resource} className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2 bg-muted/30 px-4 py-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold uppercase tracking-wider">
                  {resource}
                </p>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  {perms.length}
                </Badge>
              </div>
              <div className="divide-y">
                {perms.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                          {p.name}
                        </code>
                        {p.isSystem && (
                          <Lock
                            className="h-3 w-3 text-muted-foreground"
                          />
                        )}
                      </div>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive disabled:opacity-30"
                      disabled={p.isSystem}
                      onClick={() => setDeleteConfirm(p)}
                      title={
                        p.isSystem
                          ? 'System permissions cannot be deleted'
                          : 'Delete permission'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="text-center text-muted-foreground py-10">
              {loading ? 'Loading…' : 'No permissions found'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <Dialog open={showDialog} onOpenChange={(v) => !v && setShowDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add permission</DialogTitle>
            <DialogDescription>
              Create a custom ACL entry. Name is generated as{' '}
              <code className="text-xs">resource.action</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Resource <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. claims"
                  value={form.resource}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      resource: e.target.value.replace(/[^a-z0-9_]/g, '_').toLowerCase(),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Action <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. approve"
                  value={form.action}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      action: e.target.value.replace(/[^a-z0-9_]/g, '_').toLowerCase(),
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder="What does this permission grant?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            {form.resource && form.action && (
              <div className="text-xs text-muted-foreground">
                Will be created as{' '}
                <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
                  {form.resource}.{form.action}
                </code>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete permission</DialogTitle>
            <DialogDescription>
              Delete{' '}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {deleteConfirm?.name}
              </code>
              ? Any roles currently granting it will lose this permission.
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
