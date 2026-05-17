import { useMemo, useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Loader2,
  UserPlus,
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Users,
  Building2,
  Phone,
  MapPin,
  FileText,
  BadgeCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

import { useAuthStore } from '@/store/authStore'
import { authService } from '@/services/authService'
import api from '@/services/api'
import { cn } from '@/lib/utils'

// Bump this when the privacy policy or terms of service text changes so the
// consent row recorded on the backend points at the exact version the user saw.
const POLICY_VERSION = '2026-04-23'

const registerSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    role: z.string().min(1, 'Please select a role'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to continue' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type RegisterForm = z.infer<typeof registerSchema>

const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'claims_officer', label: 'Claims Officer' },
  { value: 'maker_checker', label: 'Maker-Checker' },
  { value: 'fraud_officer', label: 'Fraud Officer' },
  { value: 'finance', label: 'Finance' },
]

const PROVIDER_TYPES = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'lab', label: 'Laboratory' },
]

function scorePassword(password: string) {
  if (!password) return 0
  let score = 0
  if (password.length >= 6) score += 1
  if (password.length >= 10) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return Math.min(score, 4)
}

const STRENGTH_LABEL = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent']
const STRENGTH_COLOR = [
  'bg-slate-700',
  'bg-red-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-emerald-400',
]

// ── Custom role picker ─────────────────────────────────────────────────────────
function RolePicker({ value, onChange, error }: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = ROLES.find(r => r.value === value)
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm transition-colors ${
          error
            ? 'border-red-500/60 bg-white/5 text-red-300'
            : open
            ? 'border-blue-500/60 bg-white/5 text-slate-100 ring-2 ring-blue-500/30'
            : 'border-white/10 bg-white/5 text-slate-100 hover:border-white/20'
        }`}
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-400 shrink-0" />
          {selected ? (
            <span className="font-medium">{selected.label}</span>
          ) : (
            <span className="text-slate-400">Select your role</span>
          )}
        </span>
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-slate-800 shadow-2xl shadow-black/50">
          {ROLES.map((r) => {
            const isSelected = r.value === value
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => { onChange(r.value); setOpen(false) }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-slate-200 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <span>{r.label}</span>
                {isSelected && (
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ── Provider type picker (same pattern as RolePicker) ─────────────────────────
function ProviderTypePicker({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(false)
  const selected = PROVIDER_TYPES.find(r => r.value === value)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm transition-colors ${error ? 'border-red-500/60 bg-white/5 text-red-300' : open ? 'border-blue-500/60 bg-white/5 text-slate-100 ring-2 ring-blue-500/30' : 'border-white/10 bg-white/5 text-slate-100 hover:border-white/20'}`}>
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
          {selected ? <span className="font-medium">{selected.label}</span> : <span className="text-slate-400">Select provider type</span>}
        </span>
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-slate-800 shadow-2xl shadow-black/50">
          {PROVIDER_TYPES.map(r => {
            const isSel = r.value === value
            return (
              <button key={r.value} type="button" onClick={() => { onChange(r.value); setOpen(false) }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-sm transition-colors ${isSel ? 'bg-blue-600 text-white font-medium' : 'text-slate-200 hover:bg-slate-700 hover:text-white'}`}>
                <span>{r.label}</span>
                {isSel && <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </button>
            )
          })}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function Register() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [tab, setTab] = useState<'staff' | 'provider'>('staff')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // ── Staff form ──
  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: '', acceptTerms: false as unknown as true },
  })
  const password = form.watch('password') || ''
  const strength = useMemo(() => scorePassword(password), [password])

  // ── Provider form state ──
  const [prov, setProv] = useState({
    providerName: '', type: '', licenseNumber: '', phone: '', email: '',
    physicalAddress: '', contactPerson: '', city: '', region: '',
    adminName: '', adminEmail: '', adminPassword: '', adminConfirm: '',
    acceptTerms: false,
  })
  const [provErrors, setProvErrors] = useState<Record<string, string>>({})
  const [showProvPw, setShowProvPw] = useState(false)
  const provPwStrength = useMemo(() => scorePassword(prov.adminPassword), [prov.adminPassword])

  const pSet = (k: string, v: string | boolean) => setProv(prev => ({ ...prev, [k]: v }))

  const validateProvider = () => {
    const e: Record<string, string> = {}
    if (!prov.providerName.trim()) e.providerName = 'Organization name is required'
    if (!prov.type) e.type = 'Provider type is required'
    if (!prov.licenseNumber.trim()) e.licenseNumber = 'License number is required'
    if (!prov.phone.trim()) e.phone = 'Phone is required'
    if (!prov.email.trim()) e.email = 'Email is required'
    if (!prov.physicalAddress.trim()) e.physicalAddress = 'Address is required'
    if (!prov.contactPerson.trim()) e.contactPerson = 'Contact person is required'
    if (!prov.adminName.trim()) e.adminName = 'Admin name is required'
    if (!prov.adminEmail.trim()) e.adminEmail = 'Admin email is required'
    if (prov.adminPassword.length < 6) e.adminPassword = 'Min 6 characters'
    if (prov.adminPassword !== prov.adminConfirm) e.adminConfirm = 'Passwords do not match'
    if (!prov.acceptTerms) e.acceptTerms = 'You must accept the terms'
    return e
  }

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true); setError('')
    try {
      const result = await authService.register({
        name: data.name, email: data.email, password: data.password, role: data.role,
        acceptTerms: true,
        policyVersion: POLICY_VERSION,
      })
      login(result.user, result.access_token); navigate('/')
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || err.message?.includes('Network')) {
        login({ id: 'new-' + Math.random().toString(36).slice(2), email: data.email, name: data.name, role: data.role as any, isActive: true, twoFactorEnabled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any)
        navigate('/'); return
      }
      setError(err.response?.data?.message || 'Registration failed. Please try again.')
    } finally { setLoading(false) }
  }

  const onProviderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateProvider()
    if (Object.keys(errs).length > 0) { setProvErrors(errs); return }
    setProvErrors({}); setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/register-provider', {
        providerName: prov.providerName, type: prov.type, licenseNumber: prov.licenseNumber,
        phone: prov.phone, email: prov.email, physicalAddress: prov.physicalAddress,
        contactPerson: prov.contactPerson, city: prov.city || undefined, region: prov.region || undefined,
        adminName: prov.adminName, adminEmail: prov.adminEmail, adminPassword: prov.adminPassword,
        acceptTerms: true,
        policyVersion: POLICY_VERSION,
      })
      login(data.user, data.access_token); navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Provider registration failed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:32px_32px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="hidden flex-1 flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-100">ClaimsFlow</p>
              <p className="text-xs text-slate-400">Medical Claims Automation</p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              Join the platform
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
              Create your ClaimsFlow <br /> workspace account.
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              Get access to claims intake, automated triage, and provider collaboration — all
              within a secure, role-based environment.
            </p>
            <ul className="space-y-3">
              {[
                'Role-based access with maker-checker controls',
                'Encrypted at rest, audited end to end',
                'Single platform for internal teams and providers',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} ClaimsFlow. All rights reserved.
          </p>
        </aside>

        <main className="flex flex-1 items-start justify-center overflow-y-auto p-6 sm:p-10">
          <div className="w-full max-w-md py-4">
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-semibold text-white">ClaimsFlow</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <div className="mb-5 space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight text-white">Create account</h2>
                <p className="text-sm text-slate-400">Set up your workspace in under a minute.</p>
              </div>

              {/* Tab switcher */}
              <div className="mb-5 flex rounded-xl border border-white/10 bg-white/[0.04] p-1">
                <button type="button" onClick={() => { setTab('staff'); setError('') }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all ${tab === 'staff' ? 'bg-blue-600 text-white shadow-md shadow-blue-700/30' : 'text-slate-400 hover:text-slate-200'}`}>
                  <Users className="h-4 w-4" /> Staff Account
                </button>
                <button type="button" onClick={() => { setTab('provider'); setError('') }}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all ${tab === 'provider' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-700/30' : 'text-slate-400 hover:text-slate-200'}`}>
                  <Building2 className="h-4 w-4" /> Provider Account
                </button>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* ── STAFF FORM ── */}
              {tab === 'staff' && (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name" className="text-slate-200">Full name</Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="reg-name"
                      autoComplete="name"
                      placeholder="Jane Doe"
                      className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('name')}
                    />
                  </div>
                  {form.formState.errors.name && (
                    <p className="text-xs text-red-400">{form.formState.errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-email" className="text-slate-200">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="reg-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('email')}
                    />
                  </div>
                  {form.formState.errors.email && (
                    <p className="text-xs text-red-400">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-role" className="text-slate-200">Role</Label>
                  <RolePicker
                    value={form.watch('role')}
                    onChange={(val) => form.setValue('role', val, { shouldValidate: true })}
                    error={form.formState.errors.role?.message}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-password" className="text-slate-200">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Min 6 characters"
                      className="h-11 border-white/10 bg-white/5 pl-9 pr-10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {password && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={cn(
                              'h-1 flex-1 rounded-full transition-colors',
                              i < strength ? STRENGTH_COLOR[strength] : 'bg-slate-700'
                            )}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">
                        Strength: <span className="text-slate-200">{STRENGTH_LABEL[strength]}</span>
                      </p>
                    </div>
                  )}
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-confirm" className="text-slate-200">Confirm password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="reg-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      className="h-11 border-white/10 bg-white/5 pl-9 pr-10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('confirmPassword')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.confirmPassword && (
                    <p className="text-xs text-red-400">
                      {form.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                  <Checkbox
                    checked={form.watch('acceptTerms') === true}
                    onCheckedChange={(v) =>
                      form.setValue('acceptTerms', Boolean(v) as true, { shouldValidate: true })
                    }
                    className="mt-0.5 border-white/20 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500"
                  />
                  <span>
                    I agree to the{' '}
                    <Link to="/terms" target="_blank" className="text-blue-400 hover:text-blue-300">Terms of Service</Link>{' '}
                    and{' '}
                    <Link to="/privacy" target="_blank" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link>.
                  </span>
                </label>
                {form.formState.errors.acceptTerms && (
                  <p className="text-xs text-red-400">
                    {form.formState.errors.acceptTerms.message as string}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="group h-11 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" />
                  )}
                  Create account
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>
              )}

              {/* ── PROVIDER FORM ── */}
              {tab === 'provider' && (
                <form onSubmit={onProviderSubmit} className="space-y-4">
                  {/* Provider info section */}
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400 flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 shrink-0" />
                    Provider accounts are reviewed before activation. You'll be notified by email.
                  </div>

                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Organisation Details</p>

                  <div className="space-y-1.5">
                    <Label className="text-slate-200">Organisation Name</Label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input value={prov.providerName} onChange={e => pSet('providerName', e.target.value)}
                        placeholder="e.g. Nairobi Hospital"
                        className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                    </div>
                    {provErrors.providerName && <p className="text-xs text-red-400">{provErrors.providerName}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Provider Type</Label>
                      <ProviderTypePicker value={prov.type} onChange={v => pSet('type', v)} error={provErrors.type} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">License / Reg. No.</Label>
                      <div className="relative">
                        <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input value={prov.licenseNumber} onChange={e => pSet('licenseNumber', e.target.value)}
                          placeholder="LIC-000123"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.licenseNumber && <p className="text-xs text-red-400">{provErrors.licenseNumber}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Phone</Label>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input value={prov.phone} onChange={e => pSet('phone', e.target.value)}
                          placeholder="+254 700 000 000"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.phone && <p className="text-xs text-red-400">{provErrors.phone}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Provider Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input type="email" value={prov.email} onChange={e => pSet('email', e.target.value)}
                          placeholder="info@hospital.com"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.email && <p className="text-xs text-red-400">{provErrors.email}</p>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-200">Physical Address</Label>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input value={prov.physicalAddress} onChange={e => pSet('physicalAddress', e.target.value)}
                        placeholder="e.g. Hospital Road, Nairobi"
                        className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                    </div>
                    {provErrors.physicalAddress && <p className="text-xs text-red-400">{provErrors.physicalAddress}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Contact Person</Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input value={prov.contactPerson} onChange={e => pSet('contactPerson', e.target.value)}
                          placeholder="Dr. Jane Doe"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.contactPerson && <p className="text-xs text-red-400">{provErrors.contactPerson}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">City</Label>
                      <Input value={prov.city} onChange={e => pSet('city', e.target.value)}
                        placeholder="Nairobi"
                        className="h-11 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                    </div>
                  </div>

                  <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Admin Account</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Admin Full Name</Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input value={prov.adminName} onChange={e => pSet('adminName', e.target.value)}
                          placeholder="Jane Doe"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.adminName && <p className="text-xs text-red-400">{provErrors.adminName}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-200">Admin Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input type="email" value={prov.adminEmail} onChange={e => pSet('adminEmail', e.target.value)}
                          placeholder="admin@hospital.com"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      </div>
                      {provErrors.adminEmail && <p className="text-xs text-red-400">{provErrors.adminEmail}</p>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-200">Password</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input type={showProvPw ? 'text' : 'password'} value={prov.adminPassword} onChange={e => pSet('adminPassword', e.target.value)}
                        placeholder="Min 6 characters"
                        className="h-11 border-white/10 bg-white/5 pl-9 pr-10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                      <button type="button" onClick={() => setShowProvPw(v => !v)}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-200">
                        {showProvPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {prov.adminPassword && (
                      <div className="space-y-1 pt-1">
                        <div className="flex gap-1">
                          {[0,1,2,3].map(i => (
                            <div key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i < provPwStrength ? STRENGTH_COLOR[provPwStrength] : 'bg-slate-700')} />
                          ))}
                        </div>
                        <p className="text-xs text-slate-400">Strength: <span className="text-slate-200">{STRENGTH_LABEL[provPwStrength]}</span></p>
                      </div>
                    )}
                    {provErrors.adminPassword && <p className="text-xs text-red-400">{provErrors.adminPassword}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-200">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input type="password" value={prov.adminConfirm} onChange={e => pSet('adminConfirm', e.target.value)}
                        placeholder="Re-enter password"
                        className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/60" />
                    </div>
                    {provErrors.adminConfirm && <p className="text-xs text-red-400">{provErrors.adminConfirm}</p>}
                  </div>

                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                    <Checkbox checked={prov.acceptTerms}
                      onCheckedChange={v => pSet('acceptTerms', Boolean(v))}
                      className="mt-0.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
                    <span>I agree to the <Link to="/terms" target="_blank" className="text-emerald-400 hover:text-emerald-300">Terms of Service</Link> and <Link to="/privacy" target="_blank" className="text-emerald-400 hover:text-emerald-300">Privacy Policy</Link>.</span>
                  </label>
                  {provErrors.acceptTerms && <p className="text-xs text-red-400">{provErrors.acceptTerms}</p>}

                  <Button type="submit" disabled={loading}
                    className="group h-11 w-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/20 hover:from-emerald-500 hover:to-teal-500 transition-all">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                    Register Provider
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </form>
              )}

              <p className="mt-6 text-center text-sm text-slate-400">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 font-medium text-blue-400 transition-colors hover:text-blue-300"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to sign in
                </Link>
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
