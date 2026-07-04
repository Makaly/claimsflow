import { useMemo, useState } from 'react'
import { ChevronsUpDown, Check, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { COUNTRIES, COUNTRY_BY_ISO, type Country } from '@/lib/countries'
import { cn } from '@/lib/utils'

interface Props {
  value?: string                 // ISO2
  onChange: (iso2: string) => void
  /** What to render inside the trigger button. Defaults to flag + name. */
  mode?: 'name' | 'dial'
  className?: string
  buttonClassName?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * Searchable country picker. Filters by country name (case-insensitive prefix
 * or substring), ISO2, or dial code so the user can type "+254" / "ke" /
 * "kenya" and land on the same row. Keyboard-navigable: ArrowDown / ArrowUp
 * to move, Enter to commit, Esc to close.
 */
export function CountryCombobox({
  value, onChange, mode = 'name', className, buttonClassName, placeholder, disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.iso2.toLowerCase().includes(q) ||
      c.dial.includes(q.startsWith('+') ? q : '+' + q),
    )
  }, [query])

  const selected: Country | undefined = value ? COUNTRY_BY_ISO[value] : undefined

  const commit = (c: Country) => {
    onChange(c.iso2)
    setOpen(false)
    setQuery('')
    setHighlight(0)
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQuery(''); setHighlight(0) } }}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn(
            'h-10 justify-between gap-2 px-3 font-normal',
            !selected && 'text-muted-foreground',
            buttonClassName,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span aria-hidden className="text-base leading-none">{selected.flag}</span>
              {mode === 'dial'
                ? <span className="tabular-nums">{selected.dial}</span>
                : <span className="truncate">{selected.name}</span>}
            </span>
          ) : (
            <span>{placeholder ?? 'Select country'}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-72 p-0', className)} align="start" sideOffset={4}>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(filtered.length - 1, h + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)) }
                else if (e.key === 'Enter' && filtered[highlight]) { e.preventDefault(); commit(filtered[highlight]) }
                else if (e.key === 'Escape') { setOpen(false) }
              }}
              placeholder="Search country or dial code…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="max-h-[280px]">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</p>
          ) : (
            <ul className="p-1">
              {filtered.map((c, i) => (
                <li key={c.iso2}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(c)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    <span aria-hidden className="text-base leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{c.dial}</span>
                    {c.iso2 === value && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
