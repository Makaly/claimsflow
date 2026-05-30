import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ShieldCheck, KeyRound, Loader2, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [email, setEmail] = useState(params.get('email') || '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  // Auto-send on first load when we arrived from a redirect that already
  // provided the email (e.g. login refused with email_not_verified).
  useEffect(() => {
    if (email && params.get('auto') === '1') {
      api.post('/auth/send-email-otp', { email }).catch(() => undefined)
      setResendIn(60)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  // Auto-submit when the user lands on the 6th digit so they don't have
  // to click the button. Guarded by a ref so a failed attempt doesn't
  // loop on the same value.
  const lastFiredRef = useRef<string>('')
  useEffect(() => {
    if (email && code.length === 6 && !busy && lastFiredRef.current !== code) {
      lastFiredRef.current = code
      verify()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy, email])

  const verify = async () => {
    if (!email || !/^\d{6}$/.test(code)) { toast.error('Enter your email and a 6-digit code'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/auth/verify-email-otp', { email, code })
      if (data?.access_token) localStorage.setItem('token', data.access_token)
      if (data?.user) login(data.user, data.access_token)
      sessionStorage.setItem('tab_auth', '1')
      toast.success('Verified. Welcome to ClaimsFlow.')
      navigate('/')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Verification failed')
    } finally { setBusy(false) }
  }

  const resend = async () => {
    if (!email || resendIn > 0) return
    try {
      await api.post('/auth/send-email-otp', { email })
      toast.success('A fresh code has been sent.')
      setResendIn(60)
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Could not send code') }
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-cyan-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-[500px] w-[500px] rounded-full bg-emerald-600/20 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-lg shadow-emerald-500/30">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">ClaimsFlow</span>
        </div>

        <Card className="border-white/10 bg-white/[0.03]">
          <CardContent className="space-y-6 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/30 to-emerald-500/30 text-cyan-200">
              <KeyRound className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Verify your email</h1>
              <p className="mt-1 text-sm text-slate-400">Enter the 6-digit code we sent to your inbox.</p>
            </div>

            <div className="space-y-3">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                className="h-11 border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-500/60" />
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6} inputMode="numeric" placeholder="000000"
                className="h-14 border-white/10 bg-white/5 text-center font-mono text-2xl tracking-[0.6em] text-slate-100 placeholder:text-slate-600 focus-visible:ring-cyan-500/60" />
              <Button onClick={verify} disabled={busy || code.length !== 6}
                className="h-11 w-full bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Verify and continue<ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <button onClick={resend} disabled={resendIn > 0 || !email}
                className="text-xs text-slate-400 transition hover:text-slate-200 disabled:text-slate-600">
                <RefreshCw className="mr-1 inline h-3 w-3" />
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a fresh code'}
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Wrong email? <Link to="/login" className="text-emerald-400 hover:text-emerald-300">Back to sign in</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
