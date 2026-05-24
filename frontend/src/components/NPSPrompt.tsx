import { useState } from 'react'
import { Star, X, Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/services/api'

interface Props {
  claimId: string
  memberId?: string
  onDismiss: () => void
}

export function NPSPrompt({ claimId, memberId, onDismiss }: Props) {
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (score === null) return
    setSubmitting(true)
    try {
      await api.post('/nps', { claimId, memberId, score, comment: comment.trim() || undefined, channel: 'in_app' })
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-4 shadow-lg max-w-sm">
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Thank you for your feedback!</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onDismiss}>Close</Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-lg max-w-sm space-y-3">
      <div className="flex items-start justify-between">
        <p className="text-sm font-semibold">How was your claims experience?</p>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Rate from 0 (not likely) to 10 (very likely)</p>
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            onClick={() => setScore(i)}
            className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
              score === i
                ? i >= 9 ? 'bg-emerald-500 text-white' : i >= 7 ? 'bg-amber-400 text-white' : 'bg-red-400 text-white'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      <textarea
        className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
        rows={2}
        placeholder="Any comments? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={submitting}>Skip</Button>
        <Button size="sm" onClick={submit} disabled={score === null || submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
          Submit
        </Button>
      </div>
    </div>
  )
}
