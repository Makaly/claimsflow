import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface EligibilityBadgeProps {
  status?: string | null
  notes?: string | null
  showTooltip?: boolean
}

function BadgeContent({ status }: { status: string }) {
  switch (status) {
    case 'eligible':
      return (
        <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 w-fit">
          Eligible
        </Badge>
      )
    case 'ineligible':
      return (
        <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 gap-0.5 w-fit">
          <AlertTriangle className="h-2.5 w-2.5" /> Ineligible
        </Badge>
      )
    case 'pending_check':
      return (
        <Badge className="text-[10px] px-1.5 py-0 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 w-fit">
          Manual Check
        </Badge>
      )
    case 'check_failed':
      return (
        <Badge className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 w-fit">
          Check Failed
        </Badge>
      )
    case 'unknown':
      return (
        <Badge className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 w-fit">
          No Member #
        </Badge>
      )
    default:
      return null
  }
}

export function EligibilityBadge({ status, notes, showTooltip = false }: EligibilityBadgeProps) {
  if (!status) return null

  const badge = <BadgeContent status={status} />
  if (!badge) return null

  if (showTooltip && notes) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{badge}</span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs">
            {notes}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return badge
}
