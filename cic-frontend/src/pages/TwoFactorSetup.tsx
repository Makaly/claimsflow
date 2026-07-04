import { useState } from 'react'
import { toast } from 'sonner'
import { Shield, Copy, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import api from '@/services/api'

export default function TwoFactorSetup() {
  const [step, setStep] = useState<'intro' | 'scan' | 'verify' | 'complete'>('intro')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // Secret, QR image, and recovery codes are issued PER USER by the backend.
  // Previously these were hardcoded (a fixed RFC-example TOTP secret and fake
  // recovery codes), which is both non-functional and misleading.
  const [secret, setSecret] = useState('')
  const [qrCode, setQrCode] = useState('') // data-URL image from the server
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

  // Step 1 → ask the server to generate a fresh secret + QR for this account.
  const startSetup = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/auth/2fa/generate')
      setSecret(data.manualEntryKey ?? data.secret ?? '')
      setQrCode(data.qrCode ?? '')
      setStep('scan')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not start 2FA setup.')
    } finally {
      setBusy(false)
    }
  }

  // Step 2 → verify the TOTP code; on success the server enables 2FA and
  // returns the one-time recovery codes to display.
  const verifyAndEnable = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/auth/2fa/enable', { token: code })
      setRecoveryCodes(Array.isArray(data.backupCodes) ? data.backupCodes : [])
      setStep('complete')
      toast.success('Two-factor authentication enabled.')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Invalid verification code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Two-Factor Authentication</h1>
        <p className="text-muted-foreground">Secure your account with TOTP-based 2FA</p>
      </div>

      {step === 'intro' && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="mt-4">Enable Two-Factor Authentication</CardTitle>
            <CardDescription>
              Add an extra layer of security using a time-based one-time password (TOTP) authenticator app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <div className="mx-auto max-w-sm space-y-2 text-left text-sm text-muted-foreground">
              <p>1. Install an authenticator app (Google Authenticator, Authy, etc.)</p>
              <p>2. Scan the QR code with your authenticator app</p>
              <p>3. Enter the verification code to confirm setup</p>
            </div>
            <Button onClick={startSetup} disabled={busy} className="mt-4">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Get Started
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'scan' && (
        <Card>
          <CardHeader>
            <CardTitle>Scan QR Code</CardTitle>
            <CardDescription>Scan this code with your authenticator app</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-4">
                {qrCode
                  ? <img src={qrCode} alt="2FA QR code" width={200} height={200} />
                  : <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-2">Can't scan? Enter this code manually:</p>
              <div className="flex items-center justify-center gap-2">
                <code className="rounded-md bg-muted px-3 py-1 font-mono text-sm">{secret}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Enter verification code from your app</Label>
              <div className="flex gap-2 max-w-xs mx-auto">
                <Input
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center font-mono text-lg tracking-widest"
                  maxLength={6}
                />
                <Button onClick={verifyAndEnable} disabled={code.length !== 6 || busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'complete' && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
            <CardTitle className="mt-4">2FA Enabled Successfully</CardTitle>
            <CardDescription>Save your recovery codes in a safe place</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium mb-3">Recovery Codes</p>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code) => (
                  <code key={code} className="rounded bg-background px-3 py-1.5 text-center font-mono text-sm">
                    {code}
                  </code>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Each recovery code can only be used once. Store these somewhere safe.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline"><Copy className="mr-2 h-4 w-4" /> Copy Codes</Button>
              <Button onClick={() => window.history.back()}>Done</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
