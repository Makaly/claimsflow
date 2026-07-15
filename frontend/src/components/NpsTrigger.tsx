import { useEffect, useState } from 'react'
import api from '@/services/api'
import { NPSPrompt } from './NPSPrompt'

interface Props {
  claimId?: string | null
  status?: string | null
  memberId?: string | null
}

// Claim states that warrant asking the member how the experience went.
const FINAL_STATES = ['paid', 'rejected', 'approved']

const seenKey = (claimId: string) => `nps:dismissed:${claimId}`

/**
 * Decides whether to surface the NPS survey for the claim currently in view.
 * Shows the floating prompt exactly once per claim — guarded by a server check
 * (already responded?) and a local "dismissed" flag so it never nags.
 */
export function NpsTrigger({ claimId, status, memberId }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    setShow(false)
    if (!claimId || !status || !FINAL_STATES.includes(status)) return
    if (localStorage.getItem(seenKey(claimId))) return

    let cancelled = false
    api
      .get('/nps/status', { params: { claimId } })
      .then((r) => { if (!cancelled) setShow(!r.data?.responded) })
      .catch(() => { if (!cancelled) setShow(true) }) // fail open — better to ask than miss
    return () => { cancelled = true }
  }, [claimId, status])

  if (!show || !claimId) return null

  const dismiss = () => {
    localStorage.setItem(seenKey(claimId), '1')
    setShow(false)
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <NPSPrompt claimId={claimId} memberId={memberId ?? undefined} onDismiss={dismiss} />
    </div>
  )
}
