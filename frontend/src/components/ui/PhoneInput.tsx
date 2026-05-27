import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { COUNTRY_BY_ISO, DEFAULT_COUNTRY_ISO, splitPhone } from '@/lib/countries'
import { cn } from '@/lib/utils'

interface Props {
  /** Full E.164-style value, e.g. "+254712345678". */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  inputId?: string
}

/**
 * Composite phone input: dial-code picker on the left, local number on the
 * right. We store the combined "<dial><local>" string in the parent so the
 * backend keeps receiving a single phone string (no schema change needed).
 *
 * The dial code and local number are kept in component-local state and
 * re-synced from `value` only when the parent supplies a wholly different
 * string (e.g. after a form reset) — otherwise typing in the local input
 * would race with the prop sync and lose characters.
 */
export function PhoneInput({
  value, onChange, placeholder = 'Phone number', className, disabled, inputId,
}: Props) {
  const initial = splitPhone(value)
  const [iso2, setIso2] = useState<string>(initial.iso2 || DEFAULT_COUNTRY_ISO)
  const [local, setLocal] = useState<string>(initial.local)

  // Re-sync from parent only if the *composed* string differs — protects
  // local typing from being overwritten by the controlled-input round-trip.
  useEffect(() => {
    const composed = (COUNTRY_BY_ISO[iso2]?.dial ?? '') + local
    if (composed !== value) {
      const next = splitPhone(value)
      setIso2(next.iso2 || DEFAULT_COUNTRY_ISO)
      setLocal(next.local)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const emit = (nextIso: string, nextLocal: string) => {
    const dial = COUNTRY_BY_ISO[nextIso]?.dial ?? ''
    // Keep only digits + whitespace in the local part so the composed
    // string is a sane phone number.
    const clean = nextLocal.replace(/[^\d\s]/g, '')
    onChange(clean ? `${dial}${clean.startsWith(' ') ? '' : ' '}${clean.trimStart()}` : '')
  }

  return (
    <div className={cn('flex gap-2', className)}>
      <CountryCombobox
        value={iso2}
        onChange={(v) => { setIso2(v); emit(v, local) }}
        mode="dial"
        disabled={disabled}
        buttonClassName="w-[110px] shrink-0"
      />
      <Input
        id={inputId}
        type="tel"
        value={local}
        onChange={(e) => { setLocal(e.target.value); emit(iso2, e.target.value) }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1"
        inputMode="tel"
        autoComplete="tel-national"
      />
    </div>
  )
}
