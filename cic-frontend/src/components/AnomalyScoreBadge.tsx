import { useState } from 'react'
import { TrendingUp, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import api from '@/services/api'

interface Props {
  claimId: string
  score?: number | null
  size?: 'sm' | 'md'
}

export default function AnomalyScoreBadge({ claimId, score, size = 'sm' }: Props) {
  const [detail, setDetail] = useState<any | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  if (score == null) {
    return <span className="text-xs text-gray-400">—</span>
  }

  const pct = Math.round(score * 100)
  const level = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low'
  const colors = {
    high: 'bg-red-100 text-red-800 hover:bg-red-200 border-red-200',
    medium: 'bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-200',
    low: 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200',
  }

  const open_ = async () => {
    setOpen(true)
    setLoading(true)
    try {
      const { data } = await api.get(`/claims/${claimId}/anomaly-detail`)
      setDetail(data)
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); open_() }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition ${colors[level]}`}
        title={`Anomaly score: ${pct}% (${level} risk)`}
      >
        <TrendingUp className="h-3 w-3" />
        {pct}%
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-4 w-4" /> Anomaly Score Breakdown — {pct}% ({level})
            </DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="py-8 text-center text-gray-400">Loading…</div>
          ) : detail ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-600">
                This score is computed from statistical deviation against the provider's 90-day baseline,
                member claim velocity, OCR confidence, and existing fraud signals.
              </div>
              {detail.factors.length === 0 ? (
                <div className="text-sm text-gray-400 italic">No risk factors detected.</div>
              ) : (
                <ul className="space-y-2">
                  {detail.factors.map((f: any, i: number) => (
                    <li key={i} className="border-l-2 border-amber-400 pl-3 py-1 bg-amber-50 rounded">
                      <div className="flex justify-between items-start">
                        <div className="font-medium text-sm capitalize">{f.name.replace(/_/g, ' ')}</div>
                        <Badge variant="outline" className="text-xs">+{Math.round(f.contribution * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{f.explanation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
