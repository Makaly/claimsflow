import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, formatDate, getInitials, getStatusColor } from './utils'

describe('cn', () => {
  it('merges class names and de-duplicates tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', null, undefined, 'font-bold')).toContain('text-red-500')
  })

  it('joins conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })
})

describe('formatCurrency', () => {
  it('formats KES values with thousand separators', () => {
    const out = formatCurrency(12345)
    // Locale formatting varies slightly across Node ICU builds; check stable parts.
    expect(out).toMatch(/Ksh|KSh|KES/i)
    expect(out).toMatch(/12,345|12 345/)
  })
})

describe('formatDate', () => {
  it('returns em-dash for null/undefined/invalid', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('formats a valid ISO string', () => {
    const out = formatDate('2026-05-12T00:00:00Z')
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/May/)
  })
})

describe('getInitials', () => {
  it('returns the first two initials in uppercase', () => {
    expect(getInitials('Jane Doe')).toBe('JD')
    expect(getInitials('Pablo Diego Jose')).toBe('PD')
  })

  it('handles a single name', () => {
    expect(getInitials('Madonna')).toBe('M')
  })
})

describe('getStatusColor', () => {
  it('returns distinct classes for known statuses', () => {
    expect(getStatusColor('approved')).toMatch(/green/)
    expect(getStatusColor('rejected')).toMatch(/red/)
    expect(getStatusColor('submitted')).toMatch(/blue/)
  })

  it('returns a fallback for unknown statuses without throwing', () => {
    expect(() => getStatusColor('nonsense-status')).not.toThrow()
  })
})
