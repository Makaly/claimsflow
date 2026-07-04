import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  ShieldCheck, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, Search,
  Building2, CheckCircle2, AlertCircle, MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { PhoneInput } from '@/components/ui/PhoneInput'
import api from '@/services/api'
import { cn } from '@/lib/utils'

const schema = z.object({
  name:     z.string().min(2, 'Name is required'),
  email:    z.string().email('Valid email is required'),
  password: z.string().min(8, 'At least 8 characters'),
  phone:    z.string().optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
})
type Form = z.infer<typeof schema>

interface ApprovedProvider {
  id: string; name: string; type: string; city?: string; region?: string;
}

const typeStyle: Record<string, string> = {
  hospital: 'bg-blue-500/15 text-blue-300',
  clinic:   'bg-emerald-500/15 text-emerald-300',
  pharmacy: 'bg-purple-500/15 text-purple-300',
  lab:      'bg-orange-500/15 text-orange-300',
}

export default function UserRegister() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [providers, setProviders] = useState<ApprovedProvider[] | null>(null)
  const [search, setSearch] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string>(params.get('providerId') || '')
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  // Persistent error banner — toast fades too fast to read while debugging.
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { phone: '' } as any })

  useEffect(() => {
    api.get('/auth/providers/approved').then(({ data }) => setProviders(data || []))
      .catch(() => setProviders([]))
  }, [])

  const filtered = useMemo(() => {
    if (!providers) return []
    const q = search.trim().toLowerCase()
    if (!q) return providers
    return providers.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q) ||
      (p.region || '').toLowerCase().includes(q),
    )
  }, [providers, search])

  const selected = providers?.find((p) => p.id === selectedProviderId)

  const onSubmit = async (data: Form) => {
    if (!selectedProviderId) { toast.error('Pick a provider to register under'); return }
    setBusy(true)
    setSubmitError(null)
    try {
      await api.post('/auth/register-user-under-provider', {
        ...data,
        providerId: selectedProviderId,
      })
      toast.success('Account created. Verify your email next.')
      navigate(`/verify-email?email=${encodeURIComponent(data.email)}&auto=1`)
    } catch (err: any) {
      const raw = err?.response?.data?.message
      const msg = Array.isArray(raw) ? raw.join('; ') : (raw || err?.message || 'Registration failed')
      setSubmitError(msg)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-cyan-600/20 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col p-6 sm:p-10">
        <header className="mb-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg shadow-blue-500/30">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide">ClaimsFlow</p>
              <p className="text-xs text-slate-400">Join an approved provider</p>
            </div>
          </Link>
          <Link to="/login" className="text-sm text-slate-400 hover:text-slate-200">
            Already registered? <span className="font-medium text-blue-400">Sign in</span>
          </Link>
        </header>

        <div className="grid flex-1 gap-6 lg:grid-cols-5">
          {/* LEFT: provider picker */}
          <Card className="border-white/10 bg-white/[0.03] lg:col-span-3">
            <CardContent className="space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Select your provider</h2>
                <p className="mt-1 text-xs text-slate-400">Only providers approved by CIC are listed. The provider's admin must approve your access after you register.</p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, city or region…"
                  className="h-10 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                />
              </div>

              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {providers === null ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading providers…</div>
                ) : filtered.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">No approved providers match your search.</p>
                ) : filtered.map((p) => {
                  const active = p.id === selectedProviderId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProviderId(p.id)}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition',
                        active
                          ? 'border-cyan-400/60 bg-cyan-500/10'
                          : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/5',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', typeStyle[p.type] || 'bg-slate-500/15 text-slate-300')}>
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-100">{p.name}</p>
                          <p className="text-[11px] text-slate-500">
                            <Badge variant="secondary" className={cn('mr-1 capitalize', typeStyle[p.type] || '')}>{p.type}</Badge>
                            {(p.city || p.region) && <span className="inline-flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{[p.city, p.region].filter(Boolean).join(', ')}</span>}
                          </p>
                        </div>
                      </div>
                      {active && <CheckCircle2 className="h-5 w-5 text-cyan-300" />}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* RIGHT: account details */}
          <Card className="border-white/10 bg-white/[0.03] lg:col-span-2">
            <CardContent className="space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Your account</h2>
                <p className="mt-1 text-xs text-slate-400">You'll receive a 6-digit code to verify this email.</p>
              </div>

              {selected ? (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                  <CheckCircle2 className="mr-1.5 inline h-3 w-3" />
                  Registering under <strong>{selected.name}</strong>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <AlertCircle className="mr-1.5 inline h-3 w-3" />
                  Pick a provider on the left to continue.
                </div>
              )}

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-slate-200">Full name</Label>
                  <Input {...form.register('name')}
                    className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60" placeholder="Your name" />
                  {form.formState.errors.name && <p className="text-xs text-red-400">{form.formState.errors.name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-200">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input {...form.register('email')} type="email"
                      className="h-10 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      placeholder="you@example.com" />
                  </div>
                  {form.formState.errors.email && <p className="text-xs text-red-400">{form.formState.errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-200">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input {...form.register('password')} type={showPwd ? 'text' : 'password'}
                      className="h-10 border-white/10 bg-white/5 pl-9 pr-10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      placeholder="At least 8 characters" />
                    <button type="button" onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-200">Phone <span className="text-xs text-slate-500">(optional)</span></Label>
                  <PhoneInput
                    value={form.watch('phone') || ''}
                    onChange={(v) => form.setValue('phone', v, { shouldValidate: true })}
                    placeholder="700 000 000"
                  />
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                    <span>{submitError}</span>
                  </div>
                )}

                <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                  <Checkbox
                    checked={!!form.watch('acceptTerms')}
                    onCheckedChange={(v) => form.setValue('acceptTerms', Boolean(v) as any, { shouldValidate: true })}
                    className="mt-0.5 border-white/20 data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500"
                  />
                  <span>
                    I accept the{' '}
                    <Link to="/terms" className="text-cyan-400 hover:text-cyan-300">Terms of Service</Link> and{' '}
                    <Link to="/privacy" className="text-cyan-400 hover:text-cyan-300">Privacy Policy</Link>.
                  </span>
                </label>
                {form.formState.errors.acceptTerms && <p className="text-xs text-red-400">{form.formState.errors.acceptTerms.message as any}</p>}

                <Button type="submit" disabled={busy || !selectedProviderId}
                  className="h-11 w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-500 hover:to-cyan-500">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create account & send code
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="rounded-md bg-white/[0.03] p-2 text-[11px] text-slate-400">
                  After you verify your email, the provider's admin must approve your access before you can sign in.
                </p>
              </form>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-10 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} CIC Insurance Group — Medical Claims Division
        </footer>
      </div>
    </div>
  )
}
