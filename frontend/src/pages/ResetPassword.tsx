import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShieldCheck, Lock, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

type FormData = z.infer<typeof schema>

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    if (!token) setError('No reset token found. Please request a new link.')
  }, [token])

  const form = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: data.password }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || 'Reset failed')
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (e: any) {
      setError(e.message || 'Unable to reset password. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-[#0f1e3d] to-[#1a2f5f] px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">ClaimsFlow</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8">
          {done ? (
            <div className="text-center">
              <CheckCircle2 className="h-14 w-14 text-green-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Password Reset!</h2>
              <p className="text-slate-300 text-sm">Your password has been updated. Redirecting to login…</p>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-white mb-1">Set new password</h2>
              <p className="text-slate-400 text-sm mb-6">Enter and confirm your new password below.</p>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-4">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                  <span className="text-sm text-red-300">{error}</span>
                </div>
              )}

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type={showPw ? 'text' : 'password'}
                      className="h-11 border-white/10 bg-white/5 pl-9 pr-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('password')}
                    />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type="password"
                      className="h-11 border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500/60"
                      {...form.register('confirm')}
                    />
                  </div>
                  {form.formState.errors.confirm && <p className="text-xs text-red-400">{form.formState.errors.confirm.message}</p>}
                </div>

                <Button type="submit" disabled={loading || !token} className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Reset Password
                </Button>
              </form>

              <div className="mt-5 text-center">
                <Link to="/login" className="text-sm text-blue-400 hover:text-blue-300">Back to login</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
