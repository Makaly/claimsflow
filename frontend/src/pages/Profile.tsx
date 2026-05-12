import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Mail, Shield, Key, Camera, Save, CheckCircle, Phone, Globe,
  Briefcase, MapPin, Calendar, Clock, Languages, Building2, AlertTriangle,
  Eye, EyeOff, Loader2, KeyRound, Smartphone, Monitor, LogOut, Trash2,
  CheckCircle2, XCircle, Lock, Sparkles, ShieldCheck, Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/store/authStore'
import { getInitials, formatDateTime, cn } from '@/lib/utils'

// Extended profile fields — persisted per-user on the backend (users table)
interface ProfileExtras {
  phone?: string
  title?: string       // maps to jobTitle on the backend
  department?: string
  location?: string
  timezone?: string
  language?: string
  bio?: string
  avatarUrl?: string
}

const TIMEZONES = [
  { value: 'Africa/Nairobi', label: '(GMT+3) Nairobi' },
  { value: 'Europe/London', label: '(GMT+0) London' },
  { value: 'Europe/Paris', label: '(GMT+1) Paris' },
  { value: 'America/New_York', label: '(GMT-5) New York' },
  { value: 'Asia/Dubai', label: '(GMT+4) Dubai' },
  { value: 'Asia/Singapore', label: '(GMT+8) Singapore' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sw', label: 'Swahili' },
  { value: 'fr', label: 'French' },
  { value: 'ar', label: 'Arabic' },
]

const ROLE_COLORS: Record<string, string> = {
  admin: 'from-red-500 to-orange-500',
  supervisor: 'from-purple-500 to-pink-500',
  claims_officer: 'from-blue-500 to-cyan-500',
  checker: 'from-indigo-500 to-blue-500',
  provider_admin: 'from-emerald-500 to-teal-500',
  provider_user: 'from-teal-500 to-cyan-500',
}

function scorePassword(password: string) {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return Math.min(score, 4)
}

const STRENGTH_LABEL = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent']
const STRENGTH_COLOR = [
  'bg-slate-300 dark:bg-slate-700',
  'bg-red-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-emerald-400',
]

// Demo session data — shown if no backend endpoint is available
const DEMO_SESSIONS = [
  { id: 's1', device: 'Chrome on macOS', location: 'Nairobi, Kenya', ip: '41.90.12.34', lastActive: new Date().toISOString(), current: true },
  { id: 's2', device: 'Safari on iPhone', location: 'Nairobi, Kenya', ip: '102.88.14.11', lastActive: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), current: false },
  { id: 's3', device: 'Firefox on Windows', location: 'Mombasa, Kenya', ip: '154.122.4.9', lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), current: false },
]

export default function Profile() {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Core profile state — seeded from the logged-in user, then refreshed from /auth/profile
  const [name, setName] = useState(user?.name || '')
  const [email] = useState(user?.email || '')
  const [extras, setExtras] = useState<ProfileExtras>(() => ({
    phone: user?.phone,
    title: user?.jobTitle,
    department: user?.department,
    location: user?.location,
    timezone: user?.timezone,
    language: user?.language,
    bio: user?.bio,
    avatarUrl: user?.avatarUrl,
  }))
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(user?.avatarUrl)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Password state
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const pwStrength = scorePassword(newPw)

  // 2FA state
  const [twoFaEnabled, setTwoFaEnabled] = useState(user?.twoFactorEnabled ?? false)
  const [twoFaBusy, setTwoFaBusy] = useState(false)

  // Sessions
  const [sessions, setSessions] = useState(DEMO_SESSIONS)

  // Notifications
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('notif_prefs') || '{}') } catch { return {} }
  })

  const token = () => localStorage.getItem('token')
  const displayName = user?.name || 'User'
  const roleLabel = user?.role?.replace(/_/g, ' ') || '—'
  const memberSince = user?.createdAt
  const roleGradient = ROLE_COLORS[user?.role ?? ''] ?? 'from-blue-500 to-indigo-500'

  // ── Fetch the authoritative per-user profile from the backend on mount ─
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/profile', {
          headers: { Authorization: `Bearer ${token()}` },
        })
        if (!res.ok) return
        const data = await res.json()
        setName(data.name || '')
        setExtras({
          phone: data.phone,
          title: data.jobTitle,
          department: data.department,
          location: data.location,
          timezone: data.timezone,
          language: data.language,
          bio: data.bio,
          avatarUrl: data.avatarUrl,
        })
        setAvatarDataUrl(data.avatarUrl)
        setUser?.({ ...(user as any), ...data })
      } catch { /* offline — fall back to cached user fields */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-clear transient messages ────────────────────────────────────
  useEffect(() => {
    if (profileMsg) {
      const t = setTimeout(() => setProfileMsg(null), 3500)
      return () => clearTimeout(t)
    }
  }, [profileMsg])
  useEffect(() => {
    if (pwMsg?.ok) {
      const t = setTimeout(() => setPwMsg(null), 3500)
      return () => clearTimeout(t)
    }
  }, [pwMsg])

  // ── Profile save — writes to the backend (per-user), then updates authStore ─
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setProfileMsg(null)
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          name,
          phone: extras.phone,
          jobTitle: extras.title,
          department: extras.department,
          location: extras.location,
          timezone: extras.timezone,
          language: extras.language,
          bio: extras.bio,
          avatarUrl: avatarDataUrl,
        }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const updated = await res.json()
      setUser?.({ ...(user as any), ...updated })
      setProfileMsg({ text: 'Profile saved', ok: true })
    } catch (err: any) {
      setProfileMsg({ text: err?.message || 'Could not save profile', ok: false })
    }
    setSavingProfile(false)
  }

  // ── Avatar upload ────────────────────────────────────────────────────
  const onAvatarPick = () => fileInputRef.current?.click()

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileMsg({ text: 'Please choose an image file', ok: false })
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setProfileMsg({ text: 'Image must be under 3 MB', ok: false })
      return
    }
    setUploadingAvatar(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      setAvatarDataUrl(dataUrl)
      setExtras((x) => ({ ...x, avatarUrl: dataUrl }))

      // Persist immediately to the backend so the avatar survives reload & shows in Header
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const updated = await res.json()
      setUser?.({ ...(user as any), ...updated })
      setProfileMsg({ text: 'Profile picture updated', ok: true })
    } catch (err: any) {
      setProfileMsg({ text: err?.message || 'Failed to upload image', ok: false })
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeAvatar = async () => {
    setAvatarDataUrl(undefined)
    setExtras((x) => ({ ...x, avatarUrl: undefined }))
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ avatarUrl: null }),
      })
      if (res.ok) {
        const updated = await res.json()
        setUser?.({ ...(user as any), ...updated })
      }
    } catch { /* ignore */ }
  }

  // ── Password change ──────────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setPwMsg({ text: 'Passwords do not match', ok: false }); return }
    if (pwStrength < 2) { setPwMsg({ text: 'Choose a stronger password (at least 8 chars, mix of types)', ok: false }); return }
    setSavingPw(true)
    setPwMsg(null)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      if (res.ok) {
        setPwMsg({ text: 'Password updated successfully', ok: true })
        setCurrentPw(''); setNewPw(''); setConfirmPw('')
      } else {
        const data = await res.json().catch(() => ({}))
        setPwMsg({ text: data.message || 'Failed to change password', ok: false })
      }
    } catch {
      setPwMsg({ text: 'Could not reach the server', ok: false })
    }
    setSavingPw(false)
  }

  // ── 2FA toggle ───────────────────────────────────────────────────────
  const onToggle2FA = async (enable: boolean) => {
    if (enable) {
      navigate('/2fa-setup')
      return
    }
    if (!confirm('Disable two-factor authentication? Your account will be less protected.')) return
    setTwoFaBusy(true)
    try {
      await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      }).catch(() => null)
      setTwoFaEnabled(false)
      if (user) setUser?.({ ...user, twoFactorEnabled: false })
    } finally {
      setTwoFaBusy(false)
    }
  }

  // ── Sessions ─────────────────────────────────────────────────────────
  const revokeSession = async (id: string) => {
    await fetch(`/api/auth/sessions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` },
    }).catch(() => null)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  const revokeAllOthers = async () => {
    if (!confirm('Sign out of all other devices? You will remain signed in here.')) return
    await fetch('/api/auth/sessions/revoke-others', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
    }).catch(() => null)
    setSessions(prev => prev.filter(s => s.current))
  }

  // ── Notifications ────────────────────────────────────────────────────
  const toggleNotif = (key: string, val: boolean) => {
    const next = { ...prefs, [key]: val }
    setPrefs(next)
    localStorage.setItem('notif_prefs', JSON.stringify(next))
  }

  const initial = getInitials(displayName)
  const profileCompletion = (() => {
    const fields = [name, email, extras.phone, extras.title, extras.location, extras.bio, avatarDataUrl]
    const filled = fields.filter(Boolean).length
    return Math.round((filled / fields.length) * 100)
  })()

  return (
    <div className="space-y-6">
      {/* ── Premium hero banner ──────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-50 via-white to-slate-50 p-6 shadow-sm dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 sm:p-8">
        {/* Decorative gradient */}
        <div className={cn('pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-gradient-to-br opacity-20 blur-3xl', roleGradient)} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)] [background-size:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)]" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="relative">
              <div className={cn('absolute inset-0 rounded-full bg-gradient-to-br blur-md opacity-60', roleGradient)} />
              <Avatar className="relative h-24 w-24 ring-4 ring-background shadow-xl">
                {avatarDataUrl
                  ? <AvatarImage src={avatarDataUrl} alt={displayName} />
                  : null}
                <AvatarFallback className={cn('bg-gradient-to-br text-2xl font-bold text-white', roleGradient)}>
                  {initial}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={onAvatarPick}
                disabled={uploadingAvatar}
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform hover:scale-105 disabled:opacity-50"
                aria-label="Change profile picture"
              >
                {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onAvatarFile}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
                {user?.twoFactorEnabled && (
                  <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <ShieldCheck className="h-3 w-3" /> 2FA
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground capitalize flex items-center justify-center gap-2 sm:justify-start">
                <Briefcase className="h-3.5 w-3.5" /> {roleLabel}
                {extras.department && <><span>·</span> {extras.department}</>}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground sm:justify-start">
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {email}</span>
                {extras.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {extras.location}</span>}
                {memberSince && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Joined {formatDateTime(memberSince)}</span>}
              </div>
            </div>
          </div>

          {/* Right column: profile completion meter */}
          <div className="w-full max-w-[220px] space-y-2 rounded-xl border bg-background/70 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Profile strength</span>
              <span className="text-sm font-bold">{profileCompletion}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  profileCompletion >= 80 ? 'bg-emerald-500'
                  : profileCompletion >= 50 ? 'bg-amber-500'
                  : 'bg-red-500'
                )}
                style={{ width: `${profileCompletion}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {profileCompletion >= 80
                ? 'Looking great — your profile is complete.'
                : 'Add more details to reach 100%.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <Tabs defaultValue="general">
        <TabsList className="h-11">
          <TabsTrigger value="general" className="gap-2"><User className="h-4 w-4" /> General</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Shield className="h-4 w-4" /> Security</TabsTrigger>
          <TabsTrigger value="sessions" className="gap-2"><Monitor className="h-4 w-4" /> Sessions</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2"><Mail className="h-4 w-4" /> Notifications</TabsTrigger>
        </TabsList>

        {/* ── GENERAL ─────────────────────────────────────────────── */}
        <TabsContent value="general" className="mt-6 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-muted/30">
              <CardTitle className="flex items-center gap-2"><User className="h-4 w-4 text-blue-500" /> Profile Information</CardTitle>
              <CardDescription>This information will be displayed on your account and in shared audit logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {/* Avatar inline controls */}
              <div className="flex items-center gap-4 rounded-xl border bg-muted/20 p-4">
                <Avatar className="h-14 w-14">
                  {avatarDataUrl ? <AvatarImage src={avatarDataUrl} alt={displayName} /> : null}
                  <AvatarFallback className={cn('bg-gradient-to-br text-white', roleGradient)}>{initial}</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm font-medium">Profile photo</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG or GIF · max 3 MB</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={onAvatarPick} disabled={uploadingAvatar}>
                    {uploadingAvatar ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                    Upload
                  </Button>
                  {avatarDataUrl && (
                    <Button size="sm" variant="ghost" onClick={removeAvatar} className="text-destructive hover:text-destructive">
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove
                    </Button>
                  )}
                </div>
              </div>

              {/* Form grid */}
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Full Name</Label>
                  <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-email">Email</Label>
                  <div className="relative">
                    <Input id="p-email" value={email} disabled className="pr-20" />
                    <Badge variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2 gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-phone" className="flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</Label>
                  <Input
                    id="p-phone"
                    placeholder="+254 700 000 000"
                    value={extras.phone || ''}
                    onChange={e => setExtras(x => ({ ...x, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-title" className="flex items-center gap-1"><Briefcase className="h-3 w-3" /> Job title</Label>
                  <Input
                    id="p-title"
                    placeholder="e.g. Claims Supervisor"
                    value={extras.title || ''}
                    onChange={e => setExtras(x => ({ ...x, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-dept" className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Department</Label>
                  <Input
                    id="p-dept"
                    placeholder="e.g. Claims Operations"
                    value={extras.department || ''}
                    onChange={e => setExtras(x => ({ ...x, department: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-loc" className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</Label>
                  <Input
                    id="p-loc"
                    placeholder="e.g. Nairobi, Kenya"
                    value={extras.location || ''}
                    onChange={e => setExtras(x => ({ ...x, location: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Globe className="h-3 w-3" /> Timezone</Label>
                  <Select value={extras.timezone || 'Africa/Nairobi'} onValueChange={v => setExtras(x => ({ ...x, timezone: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Languages className="h-3 w-3" /> Language</Label>
                  <Select value={extras.language || 'en'} onValueChange={v => setExtras(x => ({ ...x, language: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-bio">Bio</Label>
                <Textarea
                  id="p-bio"
                  placeholder="A short description about you"
                  rows={3}
                  value={extras.bio || ''}
                  onChange={e => setExtras(x => ({ ...x, bio: e.target.value }))}
                  maxLength={240}
                />
                <p className="text-right text-xs text-muted-foreground">{(extras.bio || '').length}/240</p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                {profileMsg ? (
                  <p className={cn('flex items-center gap-1 text-sm', profileMsg.ok ? 'text-emerald-600' : 'text-destructive')}>
                    {profileMsg.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {profileMsg.text}
                  </p>
                ) : <span />}
                <Button onClick={handleSaveProfile} disabled={savingProfile} className="min-w-[140px]">
                  {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SECURITY ────────────────────────────────────────────── */}
        <TabsContent value="security" className="mt-6 space-y-6">
          {/* Password card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4 text-blue-500" /> Change password</CardTitle>
              <CardDescription>Use a strong password with at least 8 characters including numbers and symbols.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-1.5">
                <Label>Current password</Label>
                <div className="relative">
                  <Input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <div className="relative">
                  <Input
                    type={showNew ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPw && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map(i => (
                        <div
                          key={i}
                          className={cn(
                            'h-1 flex-1 rounded-full transition-colors',
                            i < pwStrength ? STRENGTH_COLOR[pwStrength] : 'bg-muted'
                          )}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Strength: <span className="font-medium text-foreground">{STRENGTH_LABEL[pwStrength]}</span>
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Confirm new password</Label>
                <Input type={showNew ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
              </div>
              {pwMsg && (
                <p className={cn('flex items-center gap-1 text-sm', pwMsg.ok ? 'text-emerald-600' : 'text-destructive')}>
                  {pwMsg.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {pwMsg.text}
                </p>
              )}
              <Button onClick={handleChangePassword} disabled={savingPw || !currentPw || !newPw || !confirmPw}>
                {savingPw ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                {savingPw ? 'Updating…' : 'Update password'}
              </Button>
            </CardContent>
          </Card>

          {/* 2FA card */}
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-emerald-500" /> Two-factor authentication
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Add a TOTP authenticator app (Google Authenticator, Authy, 1Password) for a second layer of protection.
                  </CardDescription>
                </div>
                <Badge variant={twoFaEnabled ? 'default' : 'secondary'} className={cn(twoFaEnabled && 'bg-emerald-500 hover:bg-emerald-500')}>
                  {twoFaEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-full', twoFaEnabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted-foreground/10 text-muted-foreground')}>
                    {twoFaEnabled ? <ShieldCheck className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {twoFaEnabled ? 'Two-factor authentication is active' : 'Two-factor authentication is off'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {twoFaEnabled
                        ? 'You will be asked for a 6-digit code each time you sign in.'
                        : 'We strongly recommend enabling 2FA for admins and supervisors.'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={twoFaEnabled}
                  disabled={twoFaBusy}
                  onCheckedChange={onToggle2FA}
                />
              </div>

              {!twoFaEnabled && (
                <Button variant="outline" className="mt-4 gap-2" onClick={() => navigate('/2fa-setup')}>
                  <KeyRound className="h-4 w-4" /> Set up authenticator
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> Danger zone</CardTitle>
              <CardDescription>Irreversible account actions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div>
                  <p className="text-sm font-medium">Sign out everywhere</p>
                  <p className="text-xs text-muted-foreground">Revoke all sessions on other devices.</p>
                </div>
                <Button variant="outline" onClick={revokeAllOthers} className="border-destructive/30 text-destructive hover:bg-destructive/10">
                  <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out others
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SESSIONS ────────────────────────────────────────────── */}
        <TabsContent value="sessions" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Monitor className="h-4 w-4 text-blue-500" /> Active sessions</CardTitle>
                  <CardDescription>Devices currently signed in to your account.</CardDescription>
                </div>
                {sessions.filter(s => !s.current).length > 0 && (
                  <Button variant="outline" size="sm" onClick={revokeAllOthers}>
                    <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out all others
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.map(s => (
                <div key={s.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Monitor className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{s.device}</p>
                        {s.current && (
                          <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                            <Sparkles className="mr-1 h-3 w-3" /> This device
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.location} · {s.ip} · <Clock className="inline h-3 w-3" /> Last active {formatDateTime(s.lastActive)}
                      </p>
                    </div>
                  </div>
                  {!s.current && (
                    <Button variant="outline" size="sm" onClick={() => revokeSession(s.id)} className="text-destructive hover:text-destructive">
                      <XCircle className="mr-2 h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── NOTIFICATIONS ───────────────────────────────────────── */}
        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-blue-500" /> Notification preferences</CardTitle>
              <CardDescription>Choose how and when ClaimsFlow reaches you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {[
                { key: 'email',      label: 'Email notifications',     description: 'Receive emails for claim status changes', defaultOn: true  },
                { key: 'sms',        label: 'SMS notifications',       description: 'Get SMS alerts for urgent claims',        defaultOn: true  },
                { key: 'browser',    label: 'Browser notifications',   description: 'Desktop push notifications',              defaultOn: true  },
                { key: 'assignment', label: 'Assignment alerts',       description: 'Notify when new claims are assigned',     defaultOn: false },
                { key: 'sla',        label: 'SLA warnings',            description: 'Alert before SLA deadline approaches',    defaultOn: false },
                { key: 'weekly',     label: 'Weekly digest',           description: 'A recap of your queue every Monday',      defaultOn: false },
              ].map(pref => (
                <div key={pref.key} className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-muted/40">
                  <div>
                    <p className="text-sm font-medium">{pref.label}</p>
                    <p className="text-xs text-muted-foreground">{pref.description}</p>
                  </div>
                  <Switch
                    checked={prefs[pref.key] ?? pref.defaultOn}
                    onCheckedChange={v => toggleNotif(pref.key, v)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
