import { useQuery } from '@tanstack/react-query'
import { Layers, Check } from 'lucide-react'
import { jobSetupApi, type JobSetup } from '@/services/jobSetupService'
import { cn } from '@/lib/utils'

/**
 * The first step of an upload: the user selects which Job Setup they are
 * indexing against. Drives the custom index fields, lookups and isolated
 * learning for everything that follows.
 */
export function JobSetupPicker({
  selectedId,
  onSelect,
}: {
  selectedId?: string | null
  onSelect: (setup: JobSetup) => void
}) {
  const { data: setups = [], isLoading } = useQuery({
    queryKey: ['job-setups', 'active'],
    queryFn: () => jobSetupApi.list(true),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading job setups…</div>

  if (setups.length === 0)
    return (
      <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
        No active job setups. Ask an administrator to create one under{' '}
        <span className="font-medium">Job Setups</span>.
      </div>
    )

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Select a job setup</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {setups.map((s) => {
          const active = s.id === selectedId
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className={cn(
                'text-left border rounded-lg p-4 transition-colors relative',
                active ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:bg-muted/50',
              )}
              style={{ borderLeftColor: s.color ?? undefined, borderLeftWidth: s.color ? 4 : undefined }}
            >
              {active && (
                <span className="absolute top-2 right-2 text-primary">
                  <Check className="h-4 w-4" />
                </span>
              )}
              <h4 className="font-medium">{s.name}</h4>
              {s.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>}
              <p className="text-[11px] text-muted-foreground mt-2">
                {s.fields.length} index field{s.fields.length !== 1 ? 's' : ''}
                {s.fields.some((f) => f.source === 'lookup') && ' · lookups'}
                {s.learningEnabled && ' · learning'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
