/**
 * ClaimPacketViewer
 *
 * Groups extracted claims by membership number and renders a packet-level
 * summary showing which document types are present and the key fields for
 * each type.  Designed as a read-only inspection panel; edit actions remain
 * in the parent BatchUpload.
 */

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import {
  FileText, Receipt, ClipboardList, ActivitySquare,
  ShieldCheck, FlaskConical, Pill, HelpCircle,
  User, Building2, Hash, Calendar, Stethoscope,
  CreditCard, TrendingUp, ChevronRight, AlertCircle,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClaimDoc {
  /** Unique id within the batch (claim.id) */
  id: string
  barcode: string
  fileName: string
  patientName: string
  patientId: string
  memberNumber: string
  providerName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  serviceDate: string
  diagnosis: string
  diagnosisCode: string
  procedureCode: string
  treatment: string
  aiConfidence: number
  pageRange: string
  documentPages?: Array<{
    pageNumber: number
    category: string
    categoryLabel: string
    confidence: number
    summary: string
  }>
}

interface Props {
  claims: ClaimDoc[]
  onSelectClaim?: (id: string) => void
  selectedId?: string
}

// ── Document type metadata ─────────────────────────────────────────────────

const DOC_TYPE_META: Record<string, {
  label: string
  icon: React.FC<{ className?: string }>
  color: string        // tailwind text color
  bg: string           // tailwind bg color
  fields: string[]     // which fields this type contributes
}> = {
  invoice: {
    label: 'Invoice',
    icon: Receipt,
    color: 'text-violet-300',
    bg: 'bg-violet-500/10 border-violet-500/25',
    fields: ['invoiceNumber', 'invoiceDate', 'invoiceAmount'],
  },
  claim_form: {
    label: 'Claim Form',
    icon: ClipboardList,
    color: 'text-sky-300',
    bg: 'bg-sky-500/10 border-sky-500/25',
    fields: ['diagnosis', 'diagnosisCode', 'treatment'],
  },
  inpatient_invoice: {
    label: 'Inpatient Invoice',
    icon: ActivitySquare,
    color: 'text-indigo-300',
    bg: 'bg-indigo-500/10 border-indigo-500/25',
    fields: ['invoiceNumber', 'invoiceAmount', 'serviceDate'],
  },
  discharge_summary: {
    label: 'Discharge Summary',
    icon: FileText,
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/10 border-emerald-500/25',
    fields: ['diagnosis', 'diagnosisCode'],
  },
  authorization_letter: {
    label: 'Authorization',
    icon: ShieldCheck,
    color: 'text-amber-300',
    bg: 'bg-amber-500/10 border-amber-500/25',
    fields: [],
  },
  lab_result: {
    label: 'Lab Result',
    icon: FlaskConical,
    color: 'text-cyan-300',
    bg: 'bg-cyan-500/10 border-cyan-500/25',
    fields: [],
  },
  prescription: {
    label: 'Prescription',
    icon: Pill,
    color: 'text-pink-300',
    bg: 'bg-pink-500/10 border-pink-500/25',
    fields: [],
  },
}

const FALLBACK_DOC_META = {
  label: 'Document',
  icon: HelpCircle as React.FC<{ className?: string }>,
  color: 'text-gray-400',
  bg: 'bg-gray-700/30 border-gray-600/30',
  fields: [] as string[],
}

function getDocMeta(category: string) {
  return DOC_TYPE_META[category] ?? { ...FALLBACK_DOC_META, label: category.replace(/_/g, ' ') }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DocTypeBadge({ category }: { category: string }) {
  const m = getDocMeta(category)
  const Icon = m.icon
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border',
      m.bg, m.color,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {m.label}
    </span>
  )
}

function ConfidencePip({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'
  return (
    <span className={cn('text-[10px] font-mono tabular-nums', color)}>
      {pct}%
    </span>
  )
}

function FieldRow({ icon: Icon, label, value, mono }: {
  icon: React.FC<{ className?: string }>
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 py-1 border-b border-gray-800/60 last:border-0">
      <Icon className="h-3 w-3 text-gray-600 mt-0.5 shrink-0" />
      <span className="text-[10px] text-gray-500 w-20 shrink-0 pt-px">{label}</span>
      <span className={cn('text-xs text-gray-300 leading-tight break-all', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// ── Claim Packet card ─────────────────────────────────────────────────────

function PacketCard({ packet, selected, onSelect }: {
  packet: ClaimDoc[]
  selected: boolean
  onSelect: () => void
}) {
  // Use the first claim in the packet as the "primary" one
  const primary = packet[0]

  // Collect all document types across the packet
  const allDocTypes = new Set<string>()
  for (const c of packet) {
    for (const dp of (c.documentPages || [])) {
      if (dp.category) allDocTypes.add(dp.category)
    }
  }
  // If no documentPages, infer type from category fields
  if (allDocTypes.size === 0) allDocTypes.add('invoice')

  const hasInpatient = allDocTypes.has('inpatient_invoice')
  const hasClaimForm = allDocTypes.has('claim_form')
  const hasDischarge = allDocTypes.has('discharge_summary')
  const hasAuth      = allDocTypes.has('authorization_letter')

  const totalAmount = packet.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
  const avgConfidence = packet.reduce((s, c) => s + c.aiConfidence, 0) / packet.length

  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-xl border transition-all cursor-pointer group',
        selected
          ? 'border-violet-500/50 bg-gray-800/80 shadow-lg shadow-violet-900/20'
          : 'border-gray-700/60 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">
              {primary.patientName || 'Unknown Patient'}
            </span>
            <ConfidencePip value={avgConfidence} />
          </div>
          {primary.memberNumber && (
            <div className="flex items-center gap-1 mt-0.5">
              <CreditCard className="h-2.5 w-2.5 text-gray-600" />
              <span className="text-[10px] font-mono text-gray-500">{primary.memberNumber}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3">
          <span className="text-sm font-bold text-white tabular-nums">
            {formatCurrency(totalAmount)}
          </span>
          <ChevronRight className={cn(
            'h-3.5 w-3.5 transition-colors',
            selected ? 'text-violet-400' : 'text-gray-600 group-hover:text-gray-400',
          )} />
        </div>
      </div>

      {/* Document type badges */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-2">
        {[...allDocTypes].map(dt => <DocTypeBadge key={dt} category={dt} />)}
      </div>

      {/* Completeness indicators */}
      <div className="flex items-center gap-3 px-4 pb-3 border-t border-gray-700/40 pt-2 mt-1">
        {[
          { ok: !!primary.invoiceNumber,   label: 'Invoice #' },
          { ok: !!primary.diagnosis,       label: 'Diagnosis' },
          { ok: !!primary.providerName,    label: 'Provider' },
          { ok: hasClaimForm,              label: 'Form' },
          { ok: hasDischarge || hasInpatient, label: 'Clinical' },
          { ok: hasAuth,                   label: 'Auth' },
        ].map(({ ok, label }) => (
          <div key={label} className="flex items-center gap-0.5">
            <div className={cn('w-1.5 h-1.5 rounded-full', ok ? 'bg-emerald-500' : 'bg-gray-700')} />
            <span className="text-[9px] text-gray-600">{label}</span>
          </div>
        ))}
        {!primary.invoiceNumber && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertCircle className="h-2.5 w-2.5 text-amber-500" />
            <span className="text-[9px] text-amber-500">Incomplete</span>
          </div>
        )}
      </div>

      {/* Expanded detail (when selected) */}
      {selected && (
        <div className="border-t border-gray-700/60 px-4 py-3 space-y-1.5">
          <FieldRow icon={Building2}    label="Provider"   value={primary.providerName} />
          <FieldRow icon={Hash}         label="Invoice #"  value={primary.invoiceNumber} mono />
          <FieldRow icon={Calendar}     label="Service"    value={primary.serviceDate || primary.invoiceDate} mono />
          <FieldRow icon={Stethoscope}  label="Diagnosis"  value={primary.diagnosis} />
          <FieldRow icon={Hash}         label="ICD-10"     value={primary.diagnosisCode} mono />
          <FieldRow icon={TrendingUp}   label="Treatment"  value={primary.treatment} />
          <FieldRow icon={User}         label="Patient ID" value={primary.patientId} mono />
          {primary.pageRange && (
            <FieldRow icon={FileText} label="Pages" value={`pg ${primary.pageRange}`} mono />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ClaimPacketViewer({ claims, onSelectClaim, selectedId }: Props) {
  // Group claims by membership number, then by patient name as fallback
  const packets = useMemo(() => {
    const map = new Map<string, ClaimDoc[]>()
    for (const c of claims) {
      const key = c.memberNumber?.trim()
        ? c.memberNumber.trim().toLowerCase()
        : c.patientName?.trim().toLowerCase() || c.id
      const existing = map.get(key)
      if (existing) existing.push(c)
      else map.set(key, [c])
    }
    return [...map.values()]
  }, [claims])

  if (claims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-600">
        <FileText className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm">No claims extracted yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[11px] text-gray-500">
          <span className="text-white font-semibold">{packets.length}</span> claim packet{packets.length !== 1 ? 's' : ''}
          {' '}·{' '}
          <span className="text-white font-semibold">{claims.length}</span> document{claims.length !== 1 ? 's' : ''}
        </p>
        <p className="text-[11px] text-gray-500 font-mono">
          Total: <span className="text-white font-semibold">
            {formatCurrency(claims.reduce((s, c) => s + c.invoiceAmount, 0))}
          </span>
        </p>
      </div>

      {/* Packet cards */}
      {packets.map((packet, i) => (
        <PacketCard
          key={packet[0].id}
          packet={packet}
          selected={selectedId ? packet.some(c => c.id === selectedId) : false}
          onSelect={() => onSelectClaim?.(packet[0].id)}
        />
      ))}
    </div>
  )
}
