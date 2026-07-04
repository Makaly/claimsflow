import { CheckCircle, AlertTriangle, ShieldAlert } from 'lucide-react'

export default function ClaimLabelBadge({ label }: { label?: string | null }) {
  if (!label) return null
  const map: Record<string, { icon: any; bg: string; text: string }> = {
    legitimate: { icon: CheckCircle, bg: 'bg-green-100 border-green-200', text: 'text-green-800' },
    suspicious: { icon: AlertTriangle, bg: 'bg-amber-100 border-amber-200', text: 'text-amber-800' },
    fraud: { icon: ShieldAlert, bg: 'bg-red-100 border-red-200', text: 'text-red-800' },
  }
  const info = map[label]
  if (!info) return null
  const Icon = info.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${info.bg} ${info.text}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  )
}
