import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  Mail,
  Lock,
  AlertCircle,
  UserCog,
  Briefcase,
  Users,
  Building2,
  UserRound,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ClipboardCheck,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { useAuthStore } from '@/store/authStore'
import { authService } from '@/services/authService'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

type DemoRole =
  | 'admin'
  | 'claims_officer'
  | 'checker'
  | 'supervisor'
  | 'fraud_officer'
  | 'provider_admin'
  | 'provider_user'

const DEMO_ROLES: Array<{
  key: DemoRole
  label: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { key: 'admin',          label: 'Admin',         icon: UserCog },
  { key: 'claims_officer', label: 'Maker',         sub: 'Officer',       icon: Briefcase },
  { key: 'checker',        label: 'Checker',       sub: 'Approver',      icon: ClipboardCheck },
  { key: 'supervisor',     label: 'Supervisor',    icon: Users },
  { key: 'fraud_officer',  label: 'Fraud Officer', sub: 'Investigations', icon: ShieldAlert },
  { key: 'provider_admin', label: 'Prov. Admin',   icon: Building2 },
  { key: 'provider_user',  label: 'Prov. User',    icon: UserRound },
]

const HIGHLIGHTS = [
  'AI-assisted claims triage with sub-minute routing',
  'Maker-checker workflow with full audit trail',
  'Provider portal with real-time reimbursement status',
]

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState<DemoRole | null>(null)

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setLoading(true)
    setError('')
    try {
      const result = await authService.login(data)
      login(result.access_token, result.user)
      navigate('/')
    } catch (err: any) {
      if (!err.response) {
        setError('Cannot reach the server. The backend may be starting up — please wait 30 seconds and try again.')
      } else {
        setError(err.response.data?.message || 'Invalid credentials. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = async (role: DemoRole) => {
    const credentials: Record<DemoRole, { email: string; password: string }> = {
      admin: { email: 'admin@cic.co.ke', password: 'password123' },
      claims_officer: { email: 'jane@cic.co.ke', password: 'password123' },
      checker: { email: 'checker@cic.co.ke', password: 'password123' },
      supervisor: { email: 'sarah@cic.co.ke', password: 'password123' },
      fraud_officer: { email: 'fraud@cic.co.ke', password: 'password123' },
      provider_admin: { email: 'admin@nairobihospital.co.ke', password: 'password123' },
      provider_user: { email: 'billing.hq@nairobihospital.co.ke', password: 'password123' },
    }
    setDemoLoading(role)
    setError('')
    try {
      const result = await authService.login(credentials[role])
      login(result.access_token, result.user)
      navigate('/')
    } catch (err: any) {
      if (!err.response) {
        setError('Backend is starting up — please wait 30 seconds and try again.')
      } else {
        setError('Demo login failed. Ensure the database seed has been run: npx prisma db seed')
      }
    } finally {
      setDemoLoading(null)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:32px_32px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        {/* Brand panel */}
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
              <Sparkles className="h-3.5 w-3.5 text-blue-400" />
              Enterprise claims, simplified
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
              Process medical claims <br /> with precision and speed.
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              Sign in to access claims triage, provider approvals, and the full audit workflow
              of the ClaimsFlow platform.
            </p>
            <ul className="space-y-3">
              {HIGHLIGHTS.map((item) => (
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

        {/* Form panel */}
        <main className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-semibold text-white">ClaimsFlow</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <div className="mb-6 space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight text-white">Welcome back</h2>
                <p className="text-sm text-slate-400">
                  Sign in to continue to your claims workspace.
                </p>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email" className="text-slate-200">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="login-email"
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="login-password" className="text-slate-200">Password</Label>
                    <Link
                      to="/forgot-password"
                      className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
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
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <Checkbox
                    checked={rememberMe}
                    onCheckedChange={(v) => setRememberMe(Boolean(v))}
                    className="border-white/20 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500"
                  />
                  Remember me on this device
                </label>

                <Button
                  type="submit"
                  disabled={loading}
                  className="group h-11 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="mr-2 h-4 w-4" />
                  )}
                  Sign in
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <Separator className="flex-1 bg-white/10" />
                <span className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  Demo accounts
                </span>
                <Separator className="flex-1 bg-white/10" />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {DEMO_ROLES.map(({ key, label, sub, icon: Icon }) => {
                  const isLoading = demoLoading === key
                  const isWorkflowRole = key === 'claims_officer' || key === 'checker'
                  const isFraud = key === 'fraud_officer'
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleDemoLogin(key)}
                      disabled={demoLoading !== null || loading}
                      className={cn(
                        'group flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-medium transition-all',
                        isWorkflowRole
                          ? 'border-blue-500/30 bg-blue-500/5 text-slate-200 hover:border-blue-400/60 hover:bg-blue-500/15 hover:text-white'
                          : isFraud
                            ? 'border-red-500/30 bg-red-500/5 text-slate-200 hover:border-red-400/60 hover:bg-red-500/15 hover:text-white'
                            : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-white',
                        'disabled:cursor-not-allowed disabled:opacity-50'
                      )}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                      ) : (
                        <Icon
                          className={cn(
                            'h-4 w-4 transition-colors',
                            isWorkflowRole ? 'text-blue-400 group-hover:text-blue-300'
                            : isFraud ? 'text-red-400 group-hover:text-red-300'
                            : 'text-slate-400 group-hover:text-blue-400',
                          )}
                        />
                      )}
                      <span>{label}</span>
                      {sub && (
                        <span className="text-[9px] font-normal text-slate-500 group-hover:text-slate-300">
                          {sub}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <p className="mt-6 text-center text-sm text-slate-400">
                Don't have an account?{' '}
                <Link
                  to="/register"
                  className="font-medium text-blue-400 transition-colors hover:text-blue-300"
                >
                  Create one
                </Link>
              </p>
            </div>

            <p className="mt-6 text-center text-xs text-slate-500 lg:hidden">
              © {new Date().getFullYear()} ClaimsFlow
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
