import type { ComponentType } from 'react'
import {
  Zap,
  FileCheck2,
  Users,
  Clock,
  Sparkles,
  Workflow,
  Camera,
  WifiOff,
  Fingerprint,
  Bell,
  ShieldCheck,
  Lock,
  Globe,
  Stethoscope,
  User,
  Banknote,
  ShieldAlert,
} from 'lucide-react'

export type Icon = ComponentType<{ className?: string }>

/**
 * Benefit-led stats — every claim here is defensible against the real platform
 * (see Login.tsx HIGHLIGHTS and the claimsflow/ mobile docs). Do not inflate.
 */
export const STATS: Array<{ value: string; label: string; caption: string; icon: Icon }> = [
  { value: '< 1 min', label: 'Claim routing', caption: 'AI-assisted triage routes every claim in under a minute.', icon: Zap },
  { value: '100%', label: 'Audit coverage', caption: 'Maker-checker workflow with a full, tamper-evident trail.', icon: FileCheck2 },
  { value: '7 roles', label: 'One platform', caption: 'Providers, members, officers, fraud, finance & admin — unified.', icon: Users },
  { value: 'Real-time', label: 'Reimbursements', caption: 'Live status the moment a decision is made.', icon: Clock },
]

/** Platform capabilities — rendered as a bento grid. `span` drives the layout. */
export const FEATURES: Array<{ title: string; body: string; icon: Icon; span: 'lg' | 'sm' }> = [
  { title: 'AI-assisted triage', body: 'Sub-minute routing with line-item extraction and confidence scoring on every invoice.', icon: Sparkles, span: 'lg' },
  { title: 'Maker-checker workflow', body: 'Two-line approvals with a complete audit trail — nothing is decided in the dark.', icon: Workflow, span: 'sm' },
  { title: 'Scan with your camera', body: 'Photograph a sheaf of invoices, auto-detect blur, and combine pages into a clean PDF.', icon: Camera, span: 'sm' },
  { title: 'Works offline', body: 'Submissions queue on spotty connections and replay automatically — no claim is ever lost.', icon: WifiOff, span: 'sm' },
  { title: 'Biometric sign-in', body: 'Fingerprint or face unlock on mobile. Sign in once, resume securely in a tap.', icon: Fingerprint, span: 'sm' },
  { title: 'Real-time alerts', body: 'Push notifications and a live notification centre the instant a claim status changes.', icon: Bell, span: 'lg' },
]

/** Hero "I am a…" path-selection — routes a visitor straight to the right door. */
export const ROLE_PATHS: Array<{ label: string; blurb: string; to: string; icon: Icon }> = [
  { label: "I'm a Provider", blurb: 'Submit & track claims, scan invoices, watch reimbursements.', to: '/provider-register', icon: Stethoscope },
  { label: "I'm a Member", blurb: 'Check your cover, file a claim, follow it in real time.', to: '/register', icon: User },
  { label: "I'm an Insurer", blurb: 'Triage, approve, flag fraud and reconcile finance.', to: '/login', icon: ShieldCheck },
]

/** Solutions by role — the Enterprise Gateway "who is this for" band. */
export const SOLUTIONS: Array<{ role: string; body: string; points: string[]; icon: Icon }> = [
  {
    role: 'Providers & billing clerks',
    body: 'Get paid faster with less paperwork.',
    points: ['Camera scan & batch upload', 'Auto invoice line-item extraction', 'Live reimbursement status'],
    icon: Stethoscope,
  },
  {
    role: 'Members & insured',
    body: 'Submit and follow a claim from your phone.',
    points: ['File a claim in minutes', 'Real-time status & alerts', 'Biometric, secure sign-in'],
    icon: User,
  },
  {
    role: 'Claims officers',
    body: 'Clear the queue with confidence.',
    points: ['Sub-minute AI triage', 'Two-line maker-checker approvals', 'Complete audit trail'],
    icon: Workflow,
  },
  {
    role: 'Fraud & finance',
    body: 'Catch anomalies, settle accurately.',
    points: ['Anomaly flags & holds', 'Bank reconciliation', 'Real-time payouts'],
    icon: Banknote,
  },
]

/** Security/compliance trust signals — real, defensible (no fabricated logos). */
export const TRUST_CHIPS: Array<{ label: string; icon: Icon }> = [
  { label: 'Full audit trail', icon: FileCheck2 },
  { label: 'Two-factor authentication', icon: Lock },
  { label: 'GDPR-aligned controls', icon: ShieldCheck },
  { label: 'Encryption at rest', icon: Lock },
  { label: 'Fraud monitoring', icon: ShieldAlert },
  { label: 'Swahili & English', icon: Globe },
]

/** Mobile-app selling points. */
export const MOBILE_FEATURES: Array<{ text: string; icon: Icon }> = [
  { text: 'Scan & batch-upload invoices with on-device OCR', icon: Camera },
  { text: 'Offline-safe submissions that replay when you reconnect', icon: WifiOff },
  { text: 'Biometric sign-in and two-factor security', icon: Fingerprint },
]

/**
 * Human imagery — CIC Group's own marketing photography, mirrored locally from
 * ke.cicinsurancegroup.com (the same assets behind "We keep our word" /
 * "Walking with you"). Swap the files in /public/images to re-theme the
 * landing surface without touching layout code.
 */
export const PEOPLE: Array<{ img: string; alt: string; title: string; body: string }> = [
  {
    img: '/images/provider-pharmacists.webp',
    alt: 'A pharmacist in a white coat at his dispensary counter, ready to help',
    title: 'Providers & care teams',
    body: 'Clinics, hospitals and pharmacies submit before the queue clears — and get paid without chasing paper.',
  },
  {
    img: '/images/members-family.webp',
    alt: 'A family relaxing on their sofa, checking a tablet together',
    title: 'Members & families',
    body: 'Members see exactly where a claim stands, in plain language — no phone calls, no guesswork.',
  },
  {
    img: '/images/life-stages.webp',
    alt: 'A grandmother laughing as her grandson hugs her from behind',
    title: 'Every stage of life',
    body: 'From a first payslip to the sunset years — cover that keeps its word when it matters most.',
  },
]

/**
 * Field voices — illustrative quotes for the demo surface, paired with local
 * portrait photography in /public/images. Names are representative personas,
 * not real customers; replace with sourced quotes before production marketing.
 */
export const TESTIMONIALS: Array<{ img: string; alt: string; quote: string; name: string; role: string }> = [
  {
    img: '/images/portrait-nurse.webp',
    alt: 'A smiling nurse in blue scrubs with a stethoscope, arms crossed',
    quote:
      'I photograph a stack of invoices before lunch, and by the time I sit down every line item is already extracted and priced.',
    name: 'Brian O.',
    role: 'Provider billing lead · Kisumu',
  },
  {
    img: '/images/portrait-doctor.webp',
    alt: 'A smiling clinician in a cream suit with a stethoscope, seated',
    quote:
      'The maker-checker queue means nothing slips through — and members stopped calling to ask where their claim is.',
    name: 'Achieng W.',
    role: 'Claims team lead · Nairobi',
  },
]
