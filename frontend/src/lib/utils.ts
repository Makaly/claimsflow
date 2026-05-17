import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amount)
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

export function formatRelativeDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (weeks < 5) return `${weeks}w ago`
  if (months < 12) return `${months}mo ago`
  return `${years}y ago`
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    under_review: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    fraud_confirmed: 'bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300',
    fraud_hold: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    pending: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    processing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
    paid: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    suspended: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  }
  return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
}

/** Returns "—" when OCR stored a filesystem path or other clearly-invalid value instead of a real name/number. */
export function sanitizeMemberField(value: string | null | undefined): string {
  if (!value) return '—'
  const v = value.trim()
  if (!v) return '—'
  // Absolute OS paths (Unix or Windows) are never valid member fields
  if (/^(\/|~\/|[A-Za-z]:[/\\])/.test(v)) return '—'
  // Leftover OCR noise: bare punctuation, single chars, or known garbage patterns
  if (v.length < 2) return '—'
  return v
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`)
}

export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    urgent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    normal: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    low: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  }
  return colors[priority] || colors.normal
}
