import { useState, useEffect, useCallback } from 'react'
import {
  FileUp, Upload, Loader2, XCircle, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { ProviderOnboarding } from './ProviderOnboarding'
import api from '@/services/api'

interface ProviderInfo {
  name: string
  approvalStatus: string
  status?: string
  canSubmitClaims: boolean
  proofDocumentName?: string
  rejectionReason?: string
  approvalComment?: string | null
}

/**
 * Blocks every route for unapproved providers. Until the provider is approved,
 * users can only see this pending screen — no dashboard, no batch upload, no
 * branches, nothing. Once approved, renders its children normally.
 *
 * CIC staff and approved providers pass through untouched.
 */
export function ProviderApprovalGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadDocFile, setUploadDocFile] = useState<File | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadDocError, setUploadDocError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const isProviderUser = user?.role === 'provider_admin' || user?.role === 'provider_user'
  const isProviderAdmin = user?.role === 'provider_admin'

  const fetchStatus = useCallback(async () => {
    if (!isProviderUser || !user?.providerId) {
      setLoading(false)
      return
    }
    setRefreshing(true)
    try {
      const { data } = await api.get(`/providers/${user.providerId}`)
      setProviderInfo(data)
    } catch { /* tolerate */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [isProviderUser, user?.providerId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleUploadProofDoc = async () => {
    if (!uploadDocFile || !user?.providerId) return
    setUploadingDoc(true)
    setUploadDocError(null)
    try {
      const fd = new FormData()
      fd.append('proofDocument', uploadDocFile)
      const { data: updated } = await api.post('/providers/self-service/proof-document', fd)
      setProviderInfo(prev => prev ? { ...prev, ...updated } : updated)
      setUploadDocFile(null)
    } catch (e: any) {
      setUploadDocError(e?.response?.data?.message ?? e?.message ?? 'Upload failed')
    } finally {
      setUploadingDoc(false)
    }
  }

  // Non-provider users pass through immediately — no network dependency.
  if (!isProviderUser) return <>{children}</>

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isApproved = providerInfo?.approvalStatus === 'approved' && providerInfo?.canSubmitClaims
  const isRejected = providerInfo?.approvalStatus === 'rejected'
  const isReturned = providerInfo?.approvalStatus === 'returned_for_correction' || providerInfo?.status === 'returned_for_correction'

  // Approved → let them use the app.
  // If providerInfo couldn't be fetched we fail CLOSED (block) — never let an
  // unknown-state provider into the app, because the default for a newly
  // registered account is pending_approval, not approved.
  if (isApproved) return <>{children}</>

  // Rejected gate
  if (isRejected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="w-full max-w-lg text-center space-y-6">
          <div className="mx-auto w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
            <XCircle className="h-9 w-9 text-red-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Registration declined</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your account for <strong className="text-foreground">{providerInfo.name}</strong> was
              not approved. Please review the reason below, correct the issue, and re-upload your
              proof document.
            </p>
          </div>
          {providerInfo.rejectionReason && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">Reason</p>
              <p className="text-sm">{providerInfo.rejectionReason}</p>
            </div>
          )}
          {isProviderAdmin && (
            <div className="rounded-xl border bg-card p-5 text-left space-y-3">
              <p className="text-sm font-semibold">Upload updated document</p>
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={e => setUploadDocFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 hover:bg-primary/10 px-4 py-2.5 transition-colors text-sm text-primary font-medium">
                  <FileUp className="h-4 w-4" />
                  {uploadDocFile ? uploadDocFile.name : 'Choose file…'}
                </div>
              </label>
              {uploadDocFile && (
                <Button size="sm" disabled={uploadingDoc} onClick={handleUploadProofDoc}>
                  {uploadingDoc
                    ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    : <><Upload className="mr-2 h-3.5 w-3.5" /> Submit for re-review</>
                  }
                </Button>
              )}
              {uploadDocError && <p className="text-xs text-destructive">{uploadDocError}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Contact <a href="mailto:claims@cic.co.ke" className="underline">claims@cic.co.ke</a> for help.
          </p>
        </div>
      </div>
    )
  }

  // Pending — render full onboarding packet form (the 6-section checklist).
  // If we were returned for correction, surface that as a prominent banner
  // above the onboarding form so the provider immediately sees the reviewer's
  // note and knows the next step is to update + re-submit.
  return (
    <>
      {isReturned && (
        <div className="mx-auto mt-4 max-w-4xl px-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300">
            <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold">CIC returned your application for correction.</p>
              {providerInfo?.approvalComment && (
                <p className="mt-1 text-sm italic opacity-90">"{providerInfo.approvalComment}"</p>
              )}
              <p className="mt-1 text-xs opacity-80">
                Update what they flagged in the sections below, then click "Submit for review" at the bottom to send it back.
              </p>
            </div>
          </div>
        </div>
      )}
      <ProviderOnboarding onApproved={fetchStatus} />
    </>
  )
}
