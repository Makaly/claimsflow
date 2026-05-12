import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ShieldCheck,
  Mail,
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  MailCheck,
  Inbox,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type ForgotForm = z.infer<typeof schema>

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)

  const form = useForm<ForgotForm>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: ForgotForm) => {
    setLoading(true)
    setError('')
    try {
      // Best-effort request; backend endpoint may not exist in demo environments.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      }).catch(() => null)
      setSentTo(data.email)
    } catch (err: any) {
      setError(err?.message || 'Unable to send reset link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    if (!sentTo) return
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sentTo }),
      }).catch(() => null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-3xl" />
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
              <KeyRound className="h-3.5 w-3.5 text-blue-400" />
              Account recovery
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
              Reset your password <br /> and get back to work.
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              We'll email you a secure link so you can set a new password and continue processing
              claims without interruption.
            </p>
            <ul className="space-y-3">
              {[
                'One-time link, expires in 30 minutes',
                'Sent only to the registered email on file',
                'No password is ever shared or stored in plain text',
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

        <main className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-semibold text-white">ClaimsFlow</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              {!sentTo ? (
                <>
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20">
                      <KeyRound className="h-5 w-5 text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-white">
                        Forgot password?
                      </h2>
                      <p className="text-sm text-slate-400">
                        We'll send a reset link to your email.
                      </p>
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="fp-email" className="text-slate-200">
                        Email address
                      </Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input
                          id="fp-email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          placeholder="you@company.com"
                          className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                          {...form.register('email')}
                        />
                      </div>
                      {form.formState.errors.email && (
                        <p className="text-xs text-red-400">{form.formState.errors.email.message}</p>
                      )}
                      <p className="pt-1 text-xs text-slate-500">
                        Enter the email associated with your ClaimsFlow account.
                      </p>
                    </div>

                    <Button
                      type="submit"
                      disabled={loading}
                      className="group h-11 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40"
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <MailCheck className="mr-2 h-4 w-4" />
                      )}
                      Send reset link
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                  </form>
                </>
              ) : (
                <div className="space-y-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
                    <Inbox className="h-7 w-7 text-emerald-400" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-semibold tracking-tight text-white">
                      Check your inbox
                    </h2>
                    <p className="text-sm text-slate-400">
                      If an account exists for{' '}
                      <span className="font-medium text-slate-200">{sentTo}</span>, a password
                      reset link is on its way.
                    </p>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-left text-sm text-slate-300">
                    <p className="mb-2 font-medium text-slate-200">Didn't receive it?</p>
                    <ul className="space-y-1.5 text-xs text-slate-400">
                      <li>• Check your spam or junk folder.</li>
                      <li>• Make sure the email address is correct.</li>
                      <li>• The link is valid for 30 minutes.</li>
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resend}
                      disabled={loading}
                      className="h-11 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <MailCheck className="mr-2 h-4 w-4" />
                      )}
                      Resend email
                    </Button>
                    <button
                      type="button"
                      onClick={() => setSentTo(null)}
                      className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                    >
                      Use a different email
                    </button>
                  </div>
                </div>
              )}

              <p className="mt-6 text-center text-sm text-slate-400">
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
