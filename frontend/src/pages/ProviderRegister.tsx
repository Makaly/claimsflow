import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  ShieldCheck, Building2, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight,
  ArrowLeft, CheckCircle2, Upload, FileText, X, Plus, AlertCircle, Trash2,
  KeyRound, RefreshCw, Send, Sparkles, FileImage, FileType2,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { DEFAULT_COUNTRY_ISO } from '@/lib/countries'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

// ── Step 1 — account + company basics ──────────────────────────────────────
const accountSchema = z.object({
  adminName: z.string().min(2, 'Name is required'),
  adminEmail: z.string().email('Valid email is required'),
  adminPassword: z.string().min(8, 'At least 8 characters'),
  providerName: z.string().min(2, 'Provider name is required'),
  type: z.enum(['hospital', 'clinic', 'pharmacy', 'lab']),
  licenseNumber: z.string().min(2, 'Licence number is required'),
  companyStructure: z.enum(['sole_proprietorship', 'partnership', 'registered_company']),
  registrationNumber: z.string().optional(),
  kraPin: z.string().optional(),
  incorporationDate: z.string().optional(),
  numberOfPartners: z.coerce.number().int().min(0).optional(),
  ownerName: z.string().optional(),
  ownerIdNumber: z.string().optional(),
  yearsProvidingServices: z.coerce.number().int().min(0, 'Required').max(150),
  contactPerson: z.string().min(2, 'Contact person is required'),
  phone: z.string().min(7, 'Phone is required'),
  email: z.string().email('Valid provider email is required'),
  physicalAddress: z.string().min(3, 'Address is required'),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().min(2, 'Country is required').default(DEFAULT_COUNTRY_ISO),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
})
type AccountForm = z.infer<typeof accountSchema>

const ONBOARDING_CATEGORIES = [
  { key: 'company_profile',     label: 'Company profile',          spec: 'Item (a) — registration certificate, ownership structure' },
  { key: 'experience_evidence', label: 'Experience evidence',      spec: 'Item (b) — proof of years providing similar services' },
  { key: 'firm_certifications', label: 'Firm certifications',      spec: 'Item (d) — accreditations held by the firm' },
  { key: 'staff_certifications',label: 'Staff certifications',     spec: 'Item (d) — licences / certificates of key staff' },
  { key: 'program_of_works',    label: 'Program of works',         spec: 'Item (f) — timeline + milestones for the engagement' },
  { key: 'other',               label: 'Other supporting documents', spec: 'Anything else that strengthens the application' },
] as const
type DocCategory = typeof ONBOARDING_CATEGORIES[number]['key']

interface OnboardingDoc {
  id: string; category: string; fileName: string; mimeType?: string;
  fileSize?: number; pageCount?: number;
  status?: 'pending' | 'approved' | 'rejected';
  reviewComment?: string | null;
  version?: number;
}
interface ProviderReference {
  id: string; clientName: string; contactPerson: string; contactEmail?: string;
  contactPhone?: string; servicesProvided: string;
  engagementStartDate: string; engagementEndDate?: string | null;
}

const STEPS = [
  { key: 'account',  label: 'Account & company',     subtitle: 'Tell us who you are' },
  { key: 'verify',   label: 'Verify email',          subtitle: 'Confirm your inbox' },
  { key: 'scope',    label: 'Scope & program',       subtitle: 'Procurement spec (c) + (f)' },
  { key: 'docs',     label: 'Documents',             subtitle: 'Items (a), (b), (d), (f)' },
  { key: 'refs',     label: 'References',            subtitle: 'Item (e) — past engagements' },
  { key: 'submit',   label: 'Review & submit',       subtitle: 'Send to CIC for approval' },
] as const
type StepKey = typeof STEPS[number]['key']

export default function ProviderRegister() {
  const navigate = useNavigate()
  const { login, user, isAuthenticated } = useAuthStore()
  // If the user is already signed in as a provider_admin (because they
  // registered + verified in a previous session but never finished the
  // onboarding packet), skip the account+OTP steps and drop them at the
  // first authenticated step. They can still walk Back if they need to.
  const [step, setStep] = useState<StepKey>(() => (
    isAuthenticated && user?.role === 'provider_admin' && user?.providerId
      ? 'scope'
      : 'account'
  ))
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpResendIn, setOtpResendIn] = useState(0)
  // Surface the most recent registration error as a persistent banner — the
  // toast disappears too fast for users to read while debugging a stuck form.
  const [submitError, setSubmitError] = useState<string | null>(null)
  // PR4 — surface the "returned for correction" comment to the provider so
  // they immediately understand what CIC needs them to fix.
  const [returnedComment, setReturnedComment] = useState<string | null>(null)

  useEffect(() => {
    if (!(isAuthenticated && user?.role === 'provider_admin')) { setReturnedComment(null); return }
    api.get('/providers/self-service/profile')
      .then(({ data }) => {
        if (data?.approvalStatus === 'returned_for_correction') {
          setReturnedComment(data?.approvalComment || 'CIC asked you to revise your packet — please update and re-submit.')
        } else {
          setReturnedComment(null)
        }
      })
      .catch(() => setReturnedComment(null))
  }, [isAuthenticated, user?.role, user?.providerId])

  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      type: 'clinic',
      companyStructure: 'registered_company',
      country: DEFAULT_COUNTRY_ISO,
      phone: '',
    } as any,
  })

  // Resend cooldown ticker
  useEffect(() => {
    if (otpResendIn <= 0) return
    const id = setInterval(() => setOtpResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [otpResendIn])

  // ── Step 1: account + register ─────────────────────────────────────────
  const submitAccount = async (data: AccountForm) => {
    setBusy(true)
    setSubmitError(null)
    try {
      await api.post('/auth/register-provider', data)
      setRegisteredEmail(data.adminEmail)
      setOtpResendIn(60)
      setStep('verify')
      toast.success('Account created. Check your email for a 6-digit code.')
    } catch (err: any) {
      // Show the actual reason inline so the user can see what's wrong
      // instead of a toast that fades after a second. Common cases here:
      // "A user with this email already exists" or unique-licence collisions.
      const raw = err?.response?.data?.message
      const msg = Array.isArray(raw) ? raw.join('; ') : (raw || err?.message || 'Registration failed')
      setSubmitError(msg)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  // ── Step 2: OTP verify ─────────────────────────────────────────────────
  const verifyOtp = async () => {
    if (!registeredEmail) return
    if (!/^\d{6}$/.test(otpCode)) { toast.error('Enter the 6-digit code'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/auth/verify-email-otp', { email: registeredEmail, code: otpCode })
      // Token is now set as cookie + returned in body. Persist for cross-origin.
      if (data?.access_token) localStorage.setItem('token', data.access_token)
      if (data?.user) login(data.user, data.access_token)
      sessionStorage.setItem('tab_auth', '1')
      toast.success("Email verified — you're signed in.")
      setStep('scope')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Code did not match')
    } finally { setBusy(false) }
  }

  const resendOtp = async () => {
    if (!registeredEmail || otpResendIn > 0) return
    try {
      await api.post('/auth/send-email-otp', { email: registeredEmail })
      toast.success('A fresh code has been sent.')
      setOtpResendIn(60)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not send code')
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Ambient backdrop — matches Login.tsx */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-emerald-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-cyan-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:32px_32px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col p-6 sm:p-10">
        {/* Brand bar */}
        <header className="mb-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-lg shadow-emerald-500/30">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-100">ClaimsFlow</p>
              <p className="text-xs text-slate-400">Provider onboarding</p>
            </div>
          </Link>
          <Link to="/login" className="text-sm text-slate-400 transition-colors hover:text-slate-200">
            Already registered? <span className="font-medium text-emerald-400">Sign in</span>
          </Link>
        </header>

        {/* Stepper */}
        <Stepper current={step} />

        {/* Active step body */}
        <div className="mt-8 flex-1">
          {step === 'account' && (
            <AccountStep
              form={form}
              showPwd={showPwd}
              setShowPwd={setShowPwd}
              busy={busy}
              submitError={submitError}
              onSubmit={submitAccount}
            />
          )}
          {step === 'verify' && (
            <VerifyStep
              email={registeredEmail!}
              code={otpCode}
              setCode={setOtpCode}
              busy={busy}
              resendIn={otpResendIn}
              onResend={resendOtp}
              onVerify={verifyOtp}
            />
          )}
          {isAuthenticated && returnedComment && (step === 'scope' || step === 'docs' || step === 'refs' || step === 'submit') && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold">CIC returned your application for correction.</p>
                <p className="mt-1 italic opacity-90">"{returnedComment}"</p>
                <p className="mt-1 text-xs opacity-80">Make the requested updates in any of the steps below, then go to "Review &amp; submit" to send it back.</p>
              </div>
            </div>
          )}
          {step === 'scope' && isAuthenticated && (
            <ScopeStep onDone={() => setStep('docs')} onBack={() => setStep('verify')} />
          )}
          {step === 'docs' && isAuthenticated && (
            <DocumentsStep onDone={() => setStep('refs')} onBack={() => setStep('scope')} />
          )}
          {step === 'refs' && isAuthenticated && (
            <ReferencesStep onDone={() => setStep('submit')} onBack={() => setStep('docs')} />
          )}
          {step === 'submit' && isAuthenticated && (
            <SubmitStep onBack={() => setStep('refs')} navigate={navigate} />
          )}
          {(step === 'scope' || step === 'docs' || step === 'refs' || step === 'submit') && !isAuthenticated && (
            <Card className="border-amber-500/30 bg-amber-500/10">
              <CardContent className="flex items-start gap-3 p-4 text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <p className="text-sm">Your session ended. Please <Link to="/login" className="underline">sign in</Link> to continue the onboarding wizard.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <footer className="mt-10 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} CIC Insurance Group — Medical Claims Division
        </footer>
      </div>
    </div>
  )
}

// ── Shared stepper ─────────────────────────────────────────────────────────
function Stepper({ current }: { current: StepKey }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)
  return (
    <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo'
        return (
          <li key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold',
                state === 'done'   && 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
                state === 'active' && 'border-cyan-400/70 bg-cyan-500/20 text-cyan-200',
                state === 'todo'   && 'border-white/10 bg-white/[0.02] text-slate-500',
              )}
            >
              {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <div className="hidden sm:block">
              <p className={cn('text-xs font-medium', state === 'todo' ? 'text-slate-500' : 'text-slate-200')}>{s.label}</p>
              <p className="text-[10px] text-slate-500">{s.subtitle}</p>
            </div>
            {i < STEPS.length - 1 && <div className="hidden h-px w-6 bg-white/10 sm:block" />}
          </li>
        )
      })}
    </ol>
  )
}

// ── Step 1 ─────────────────────────────────────────────────────────────────
function AccountStep({
  form, showPwd, setShowPwd, busy, submitError, onSubmit,
}: {
  form: ReturnType<typeof useForm<AccountForm>>
  showPwd: boolean
  setShowPwd: (b: boolean) => void
  busy: boolean
  submitError: string | null
  onSubmit: (data: AccountForm) => void
}) {
  const errors = form.formState.errors
  // Collect every field-level zod error so we can also show an aggregate
  // banner at the top — required so users don't miss errors hidden below
  // the fold on long forms.
  const errorList = Object.entries(errors)
    .filter(([, v]) => v && (v as any).message)
    .map(([k, v]) => ({ field: k, message: (v as any).message as string }))
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-2">
      {(submitError || errorList.length > 0) && (
        <div className="lg:col-span-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="flex-1 space-y-1">
              {submitError && (
                <p className="font-medium">{submitError}</p>
              )}
              {errorList.length > 0 && (
                <>
                  <p className="font-medium">Please fix the highlighted field{errorList.length === 1 ? '' : 's'} below:</p>
                  <ul className="ml-4 list-disc text-xs text-red-200/90">
                    {errorList.map((e) => (<li key={e.field}>{e.message}</li>))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-white">Your admin account</h3>
            <p className="text-xs text-slate-400">You'll manage your provider's users, branches, and claims from this account.</p>
          </div>
          <Field label="Full name" error={errors.adminName?.message}>
            <Input {...form.register('adminName')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="Dr. Jane Wanjiku" />
          </Field>
          <Field label="Email" error={errors.adminEmail?.message}>
            <Input {...form.register('adminEmail')} type="email" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="admin@yourprovider.co.ke" />
          </Field>
          <Field label="Password" error={errors.adminPassword?.message}>
            <div className="relative">
              <Input
                {...form.register('adminPassword')}
                type={showPwd ? 'text' : 'password'}
                className="h-10 border-white/10 bg-white/5 pr-10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60"
                placeholder="At least 8 characters"
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200">
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-white">Your organisation</h3>
            <p className="text-xs text-slate-400">As listed on your registration certificate.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider name" error={errors.providerName?.message}>
              <Input {...form.register('providerName')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="Nairobi Health Clinic" />
            </Field>
            <Field label="Type" error={errors.type?.message}>
              <Select value={form.watch('type')} onValueChange={(v: any) => form.setValue('type', v)}>
                <SelectTrigger className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hospital">Hospital</SelectItem>
                  <SelectItem value="clinic">Clinic</SelectItem>
                  <SelectItem value="pharmacy">Pharmacy</SelectItem>
                  <SelectItem value="lab">Diagnostic lab</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Licence number" error={errors.licenseNumber?.message}>
              <Input {...form.register('licenseNumber')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="MOH-LIC-12345" />
            </Field>
            <Field label="Company structure" error={errors.companyStructure?.message}>
              <Select value={form.watch('companyStructure')} onValueChange={(v: any) => form.setValue('companyStructure', v)}>
                <SelectTrigger className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sole_proprietorship">Sole proprietorship</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="registered_company">Registered company</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Registration #">
              <Input {...form.register('registrationNumber')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="CR/1234567" />
            </Field>
            <Field label="KRA PIN">
              <Input {...form.register('kraPin')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="P051234567X" />
            </Field>
            <Field label="Years providing similar services" error={errors.yearsProvidingServices?.message}>
              <Input {...form.register('yearsProvidingServices')} type="number" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" />
            </Field>
            <Field label="Incorporation date">
              <Input {...form.register('incorporationDate')} type="date" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.03] lg:col-span-2">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-white">Contact & address</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person" error={errors.contactPerson?.message}>
              <Input {...form.register('contactPerson')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" />
            </Field>
            <Field label="Provider email" error={errors.email?.message}>
              <Input {...form.register('email')} type="email" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="info@yourprovider.co.ke" />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <PhoneInput
                value={form.watch('phone') || ''}
                onChange={(v) => form.setValue('phone', v, { shouldValidate: true })}
                placeholder="700 000 000"
              />
            </Field>
            <Field label="Physical address" error={errors.physicalAddress?.message}>
              <Input {...form.register('physicalAddress')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="Plot 12, Westlands Rd" />
            </Field>
            <Field label="City"><Input {...form.register('city')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" /></Field>
            <Field label="Region / county"><Input {...form.register('region')} className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="e.g. Nairobi County" /></Field>
            <Field label="Country" error={errors.country?.message}>
              <CountryCombobox
                value={form.watch('country') || DEFAULT_COUNTRY_ISO}
                onChange={(v) => form.setValue('country', v, { shouldValidate: true })}
                buttonClassName="w-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
              />
            </Field>
          </div>

          <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
            <Checkbox
              checked={!!form.watch('acceptTerms')}
              onCheckedChange={(v) => form.setValue('acceptTerms', Boolean(v) as any, { shouldValidate: true })}
              className="mt-0.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
            />
            <span>
              I accept the{' '}
              <Link to="/terms" className="text-emerald-400 hover:text-emerald-300">Terms of Service</Link> and{' '}
              <Link to="/privacy" className="text-emerald-400 hover:text-emerald-300">Privacy Policy</Link>, and confirm that the information above is accurate.
            </span>
          </label>
          {errors.acceptTerms && <p className="text-xs text-red-400">{errors.acceptTerms.message as any}</p>}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={busy} className="h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Create account & send code
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

// ── Step 2: OTP verify ──────────────────────────────────────────────────────
function VerifyStep({
  email, code, setCode, busy, resendIn, onResend, onVerify,
}: {
  email: string; code: string; setCode: (s: string) => void; busy: boolean;
  resendIn: number; onResend: () => void; onVerify: () => void;
}) {
  // Auto-submit the moment the 6th digit is entered — the user shouldn't
  // need to reach for the mouse. We track the last code we auto-fired so
  // a failed verify doesn't loop on every re-render with the same value.
  const lastFiredRef = useRef<string>('')
  useEffect(() => {
    if (code.length === 6 && !busy && lastFiredRef.current !== code) {
      lastFiredRef.current = code
      onVerify()
    }
  }, [code, busy, onVerify])
  return (
    <Card className="mx-auto max-w-xl border-white/10 bg-white/[0.03]">
      <CardContent className="space-y-6 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/30 to-emerald-500/30 text-cyan-200">
          <KeyRound className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white">Verify your email</h3>
          <p className="mt-1 text-sm text-slate-400">
            We sent a 6-digit code to <span className="font-medium text-slate-200">{email}</span>.
          </p>
        </div>

        <div className="mx-auto max-w-xs space-y-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            inputMode="numeric"
            placeholder="000000"
            className="h-14 border-white/10 bg-white/5 text-center font-mono text-2xl tracking-[0.6em] text-slate-100 placeholder:text-slate-600 focus-visible:ring-cyan-500/60"
          />
          <Button onClick={onVerify} disabled={busy || code.length !== 6}
            className="h-11 w-full bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Verify and continue
          </Button>
          <button onClick={onResend} disabled={resendIn > 0}
            className="text-xs text-slate-400 transition hover:text-slate-200 disabled:text-slate-600">
            <RefreshCw className="mr-1 inline h-3 w-3" />
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Step 3: Scope (c) + Program of works text (f) ──────────────────────────
function ScopeStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [scope, setScope] = useState('')
  const [program, setProgram] = useState('')
  const [busy, setBusy] = useState(false)

  // Hydrate from server if user has saved earlier.
  useEffect(() => {
    api.get('/providers/self-service/onboarding-packet').then(({ data }) => {
      setScope(data?.sections?.c_scopeUnderstanding?.scopeUnderstanding ?? '')
      setProgram(data?.sections?.f_programOfWorks?.programOfWorksText ?? '')
    }).catch(() => undefined)
  }, [])

  const save = async () => {
    if (scope.trim().length < 100) { toast.error('Scope understanding must be at least 100 characters'); return }
    if (program.trim().length < 50) { toast.error('Program of works must be at least 50 characters'); return }
    setBusy(true)
    try {
      await api.patch('/providers/self-service/onboarding-info', {
        scopeUnderstanding: scope,
        programOfWorksText: program,
      })
      onDone()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not save')
    } finally { setBusy(false) }
  }

  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardContent className="space-y-6 p-6">
        <div>
          <h3 className="text-lg font-semibold text-white">Scope of service & program of works</h3>
          <p className="mt-1 text-xs text-slate-400">Procurement spec items (c) and (f) — your narrative answers, not file uploads.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-200">Detailed understanding of the scope of services (c)</Label>
          <Textarea rows={6} value={scope} onChange={(e) => setScope(e.target.value)}
            className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="Describe, in your own words, what you understand the scope of this engagement to be…" />
          <p className="text-[11px] text-slate-500">{scope.length} / 100 minimum</p>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-200">Program of works narrative (f)</Label>
          <Textarea rows={6} value={program} onChange={(e) => setProgram(e.target.value)}
            className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" placeholder="High-level milestones and timelines for executing the engagement…" />
          <p className="text-[11px] text-slate-500">{program.length} / 50 minimum (a detailed PDF can also be uploaded in the next step)</p>
        </div>

        <StepNav onBack={onBack} onNext={save} busy={busy} />
      </CardContent>
    </Card>
  )
}

// ── Step 4: Documents ───────────────────────────────────────────────────────
function DocumentsStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [docs, setDocs] = useState<OnboardingDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingFor, setUploadingFor] = useState<DocCategory | null>(null)

  // Single fetch on mount. After that we update local state from each upload's
  // response — no need to refetch the whole packet, which would otherwise
  // burn through the 120 req/min global throttle in a few clicks.
  useEffect(() => {
    let cancelled = false
    api.get('/providers/self-service/onboarding-packet')
      .then(({ data }) => {
        if (cancelled) return
        const flat: OnboardingDoc[] = []
        for (const k of Object.keys(data?.sections ?? {})) {
          const docsAtKey = (data.sections as any)[k].documents
          if (Array.isArray(docsAtKey)) flat.push(...docsAtKey)
        }
        setDocs(flat)
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const uploadMany = async (cat: DocCategory, files: File[]) => {
    if (!files.length) return
    setUploadingFor(cat)
    let ok = 0, failed = 0
    for (const file of files) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('category', cat)
        const { data } = await api.post('/providers/self-service/onboarding-document', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        // The endpoint returns the created row — append to local state so
        // the UI updates without re-fetching the entire packet.
        if (data?.id) setDocs((prev) => [...prev, data as OnboardingDoc])
        ok++
      } catch (err: any) {
        failed++
        toast.error(`${file.name}: ${err?.response?.data?.message || 'upload failed'}`)
      }
    }
    setUploadingFor(null)
    if (ok > 0) toast.success(`${ok} file${ok === 1 ? '' : 's'} uploaded`)
    if (failed === 0 && ok === 0) toast.error('No files uploaded')
  }

  const remove = async (docId: string) => {
    // Optimistic: drop from local state first, restore on error.
    const previous = docs
    setDocs((prev) => prev.filter((d) => d.id !== docId))
    try {
      await api.delete(`/providers/self-service/onboarding-document/${docId}`)
    } catch {
      setDocs(previous)
      toast.error('Could not remove document')
    }
  }

  // Upload a corrected file for a rejected document. Backend supersedes the
  // old row and returns the new v+1 row, which replaces the old one in the
  // list so the user sees the new status (pending) immediately.
  const resubmit = async (oldDocId: string, file: File) => {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data: replacement } = await api.post(
        `/providers/self-service/onboarding-document/${oldDocId}/resubmit`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      if (replacement?.id) {
        setDocs((prev) => prev.filter((d) => d.id !== oldDocId).concat(replacement as OnboardingDoc))
      }
      toast.success(`Replaced with v${replacement?.version ?? '?'} — sent for re-review`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Resubmit failed')
    }
  }

  if (loading) return <Card className="border-white/10 bg-white/[0.03]"><CardContent className="p-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></CardContent></Card>

  // Treat company_profile/experience_evidence/firm/staff/program_of_works as
  // "required" categories (mirrors the backend section completeness rules).
  const REQUIRED_CATS = ['company_profile','experience_evidence','firm_certifications','staff_certifications','program_of_works'] as const
  const filledRequired = REQUIRED_CATS.filter((c) => docs.some((d) => d.category === c)).length

  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Supporting documents</h3>
            <p className="mt-1 text-xs text-slate-400">PDF, JPEG, PNG and TIFF up to 10 MB each. Drag a file onto a category — or click to browse.</p>
          </div>
          <Badge className={filledRequired === REQUIRED_CATS.length
            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
            : 'bg-amber-500/20 text-amber-200 border border-amber-500/30'}>
            {filledRequired}/{REQUIRED_CATS.length} required categories
          </Badge>
        </div>

        <div className="grid gap-3">
          {ONBOARDING_CATEGORIES.map(({ key, label, spec }) => {
            const here = docs.filter((d) => d.category === key)
            const isRequired = (REQUIRED_CATS as readonly string[]).includes(key)
            return (
              <DocCategoryCard
                key={key}
                category={key}
                label={label}
                spec={spec}
                required={isRequired}
                docs={here}
                busy={uploadingFor === key}
                onUpload={(files) => uploadMany(key, files)}
                onRemove={remove}
                onResubmit={resubmit}
              />
            )
          })}
        </div>

        <StepNav onBack={onBack} onNext={onDone} />
      </CardContent>
    </Card>
  )
}

function DocCategoryCard({
  category, label, spec, required, docs, busy, onUpload, onRemove, onResubmit,
}: {
  category: DocCategory
  label: string
  spec: string
  required: boolean
  docs: OnboardingDoc[]
  busy: boolean
  onUpload: (files: File[]) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onResubmit: (oldDocId: string, file: File) => void | Promise<void>
}) {
  const complete = docs.length > 0
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: true,
    noClick: true,        // we render our own click target so the whole card isn't a button
    noKeyboard: true,
    disabled: busy,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png':  ['.png'],
      'image/tiff': ['.tif', '.tiff'],
    },
    onDrop: (accepted) => onUpload(accepted),
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'rounded-xl border p-4 transition-colors',
        isDragActive
          ? 'border-cyan-400/70 bg-cyan-500/10'
          : complete
            ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
            : 'border-white/10 bg-white/[0.02]',
      )}
    >
      <input {...getInputProps()} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-slate-100">{label}</p>
            {required && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">required</span>}
            {complete && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{spec}</p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); open() }}
          disabled={busy}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {busy ? 'Uploading…' : 'Choose files'}
        </button>
      </div>

      {isDragActive && (
        <div className="mt-3 rounded-md border border-dashed border-cyan-400/40 bg-cyan-500/5 p-3 text-center text-xs font-medium text-cyan-200">
          Drop to upload to "{label}"
        </div>
      )}

      {docs.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {docs.map((d) => {
            const status = d.status || 'pending'
            const statusPill =
              status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : status === 'rejected' ? 'bg-red-500/15 text-red-300 border-red-500/30'
              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
            return (
              <li key={d.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 rounded-md bg-black/30 px-3 py-2 text-xs text-slate-300">
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                    <DocIcon mime={d.mimeType} />
                    <span className="truncate" title={d.fileName}>{d.fileName}</span>
                    {d.version && d.version > 1 ? <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">v{d.version}</span> : null}
                    <span className="ml-1 text-slate-500 shrink-0">
                      {d.pageCount ? `· ${d.pageCount} pg` : ''}
                      {d.fileSize ? ` · ${formatBytes(d.fileSize)}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize ${statusPill}`}>{status}</span>
                  {status !== 'approved' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(d.id) }}
                      className="shrink-0 text-slate-500 transition hover:text-red-400"
                      title="Remove"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>

                {status === 'rejected' && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
                    <p className="font-medium">CIC reviewer flagged this file for revision.</p>
                    {d.reviewComment && <p className="mt-1 italic">"{d.reviewComment}"</p>}
                    <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/25">
                      <Upload className="h-3 w-3" />
                      Upload corrected version
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) onResubmit(d.id, f)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {docs.length === 0 && !isDragActive && (
        <p className="mt-3 text-[11px] text-slate-500">No files yet — drag one here, or use the button.</p>
      )}
    </div>
  )
}

function DocIcon({ mime }: { mime?: string }) {
  if (mime?.startsWith('image/')) return <FileImage className="h-3.5 w-3.5 shrink-0 text-purple-400" />
  if (mime === 'application/pdf') return <FileType2 className="h-3.5 w-3.5 shrink-0 text-red-400" />
  return <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ── Step 5: References (≥2) ─────────────────────────────────────────────────
function ReferencesStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [refs, setRefs] = useState<ProviderReference[]>([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Partial<ProviderReference>>({})

  const refresh = async () => {
    const { data } = await api.get('/providers/self-service/onboarding-packet')
    setRefs(data?.sections?.e_references?.references ?? [])
  }
  useEffect(() => { refresh() }, [])

  const add = async () => {
    if (!draft.clientName || !draft.contactPerson || !draft.servicesProvided || !draft.engagementStartDate) {
      toast.error('Client, contact, services and start date are required'); return
    }
    setBusy(true)
    try {
      await api.post('/providers/self-service/references', draft)
      setDraft({})
      await refresh()
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Could not add reference') }
    finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    try { await api.delete(`/providers/self-service/references/${id}`); await refresh() }
    catch { toast.error('Could not remove') }
  }

  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Past engagement references</h3>
            <p className="mt-1 text-xs text-slate-400">Procurement spec item (e) — at least two past clients in the last 5 years.</p>
          </div>
          <Badge className="bg-cyan-500/15 text-cyan-200">{refs.length} added</Badge>
        </div>

        {refs.length > 0 && (
          <ul className="space-y-2">
            {refs.map((r) => (
              <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-100">{r.clientName}</p>
                    <p className="text-xs text-slate-400">{r.servicesProvided}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {r.contactPerson}{r.contactEmail ? ` · ${r.contactEmail}` : ''} · from {r.engagementStartDate?.slice(0, 10)}
                    </p>
                  </div>
                  <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-red-400" title="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-xl border border-dashed border-white/10 p-4">
          <p className="mb-3 text-xs font-medium text-slate-300">Add a reference</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Client / organisation" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={draft.clientName || ''} onChange={(e) => setDraft({ ...draft, clientName: e.target.value })} />
            <Input placeholder="Contact person" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={draft.contactPerson || ''} onChange={(e) => setDraft({ ...draft, contactPerson: e.target.value })} />
            <Input placeholder="Contact email" type="email" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={draft.contactEmail || ''} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
            <Input placeholder="Contact phone" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={draft.contactPhone || ''} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
            <Input placeholder="Engagement start" type="date" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={(draft.engagementStartDate || '').toString().slice(0,10)} onChange={(e) => setDraft({ ...draft, engagementStartDate: e.target.value })} />
            <Input placeholder="Engagement end (optional)" type="date" className="h-10 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" value={(draft.engagementEndDate || '').toString().slice(0,10)} onChange={(e) => setDraft({ ...draft, engagementEndDate: e.target.value })} />
            <Textarea placeholder="Services provided" className="dark-field sm:col-span-2" rows={2} value={draft.servicesProvided || ''} onChange={(e) => setDraft({ ...draft, servicesProvided: e.target.value })} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={add} disabled={busy} className="bg-cyan-600 text-white hover:bg-cyan-500">
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
              Add reference
            </Button>
          </div>
        </div>

        <StepNav onBack={onBack} onNext={onDone} disabled={refs.length < 2} disabledReason="Add at least two references" />
      </CardContent>
    </Card>
  )
}

// ── Step 6: Review + submit ─────────────────────────────────────────────────
function SubmitStep({ onBack, navigate }: { onBack: () => void; navigate: ReturnType<typeof useNavigate> }) {
  const [packet, setPacket] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    const { data } = await api.get('/providers/self-service/onboarding-packet')
    setPacket(data)
  }
  useEffect(() => { refresh() }, [])

  const submit = async () => {
    setBusy(true)
    try {
      await api.post('/providers/self-service/onboarding-submit')
      toast.success('Submitted for approval. CIC will be in touch.')
      navigate('/')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Submission failed — see missing sections')
      refresh()
    } finally { setBusy(false) }
  }

  if (!packet) return <Card className="border-white/10 bg-white/[0.03]"><CardContent className="p-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></CardContent></Card>

  const sectionLabels: Record<string, string> = {
    a_companyProfile: '(a) Company profile',
    b_yearsOfExperience: '(b) Years of experience',
    c_scopeUnderstanding: '(c) Scope understanding',
    d_certifications: '(d) Certifications',
    e_references: '(e) References',
    f_programOfWorks: '(f) Program of works',
  }

  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardContent className="space-y-5 p-6">
        <div>
          <h3 className="text-lg font-semibold text-white">Review & submit</h3>
          <p className="mt-1 text-xs text-slate-400">CIC reviewers will be notified the moment you submit.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(packet.sections).map(([k, v]: [string, any]) => (
            <div key={k} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm',
              v.complete ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200')}>
              <span>{sectionLabels[k] || k}</span>
              {v.complete ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-cyan-500/10 p-3 text-xs text-cyan-200">
          <Sparkles className="mr-1 inline h-3 w-3" />
          {packet.completedCount} of {packet.totalSections} sections complete.
          {packet.isComplete ? ' All required sections are ready.' : ' Resolve missing sections before submitting.'}
        </div>

        <StepNav
          onBack={onBack}
          onNext={submit}
          busy={busy}
          nextLabel={packet.isComplete ? 'Submit for approval' : 'Submit anyway'}
          disabled={!packet.isComplete}
          disabledReason="Complete every section first"
        />
      </CardContent>
    </Card>
  )
}

// ── Small helpers ───────────────────────────────────────────────────────────
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-200">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function StepNav({
  onBack, onNext, busy, nextLabel = 'Continue', disabled, disabledReason,
}: {
  onBack: () => void; onNext: () => void; busy?: boolean; nextLabel?: string;
  disabled?: boolean; disabledReason?: string;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <Button variant="ghost" onClick={onBack} className="text-slate-400 hover:text-slate-200">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <div className="flex items-center gap-3">
        {disabled && disabledReason && <span className="text-xs text-amber-300">{disabledReason}</span>}
        <Button onClick={onNext} disabled={busy || disabled}
          className="h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {nextLabel}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
