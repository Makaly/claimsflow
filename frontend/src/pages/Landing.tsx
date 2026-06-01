import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Smartphone,
  Camera,
  Fingerprint,
  Bell,
  ScanLine,
  WifiOff,
  Workflow,
  Zap,
  Clock,
  Users,
  Lock,
  FileCheck2,
  Globe,
  Apple,
  Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// Benefit-led stats — every claim here is defensible against the real platform
// (see Login.tsx HIGHLIGHTS and the claimsflow/ mobile docs).
const STATS: Array<{ value: string; label: string; caption: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: '< 1 min', label: 'Claim routing', caption: 'AI-assisted triage routes every claim in under a minute.', icon: Zap },
  { value: '100%', label: 'Audit coverage', caption: 'Maker-checker workflow with a full, tamper-evident trail.', icon: FileCheck2 },
  { value: '7 roles', label: 'One platform', caption: 'Providers, members, officers, fraud, finance & admin — unified.', icon: Users },
  { value: 'Real-time', label: 'Reimbursements', caption: 'Live status the moment a decision is made.', icon: Clock },
]

const FEATURES: Array<{ title: string; body: string; icon: React.ComponentType<{ className?: string }> }> = [
  { title: 'AI-assisted triage', body: 'Sub-minute routing with line-item extraction and confidence scoring on every invoice.', icon: Sparkles },
  { title: 'Maker-checker workflow', body: 'Two-line approvals with a complete audit trail — nothing is decided in the dark.', icon: Workflow },
  { title: 'Scan with your camera', body: 'Photograph a sheaf of invoices, auto-detect blur, and combine pages into a clean PDF.', icon: Camera },
  { title: 'Works offline', body: 'Submissions queue on spotty connections and replay automatically — no claim is ever lost.', icon: WifiOff },
  { title: 'Biometric sign-in', body: 'Fingerprint or face unlock on mobile. Sign in once, resume securely in a tap.', icon: Fingerprint },
  { title: 'Real-time alerts', body: 'Push notifications and a live notification centre the instant a claim status changes.', icon: Bell },
]

const TRUST_CHIPS = [
  { label: 'Full audit trail', icon: FileCheck2 },
  { label: 'Two-factor authentication', icon: Lock },
  { label: 'GDPR-aligned controls', icon: ShieldCheck },
  { label: 'Encryption at rest', icon: Lock },
  { label: 'Swahili & English', icon: Globe },
]

export default function Landing() {
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notified, setNotified] = useState(false)
  const year = new Date().getFullYear()

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: POST { email: notifyEmail } to a mobile-launch waitlist endpoint once
    // the backend route exists. Presentational confirmation only for now.
    if (notifyEmail.trim()) setNotified(true)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Ambient background — self-contained, renders instantly on first paint */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[460px] w-[460px] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:32px_32px]" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 -mx-6 mb-4 flex items-center justify-between gap-4 border-b border-white/5 bg-slate-950/70 px-6 py-4 backdrop-blur-xl lg:-mx-10 lg:px-10">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-wide text-slate-100">ClaimsFlow</p>
              <p className="text-[11px] text-slate-400">Medical Claims Automation</p>
            </div>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#mobile" className="transition-colors hover:text-white">Mobile</a>
            <a href="#trust" className="transition-colors hover:text-white">Trust</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:text-white"
            >
              Sign in
            </Link>
            <Link to="/register">
              <Button className="group h-10 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40">
                Get started
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-blue-400" />
              Now with a mobile app for the field
            </div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl xl:text-6xl">
              Settle medical claims
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                in minutes, not weeks.
              </span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-400">
              ClaimsFlow gives insurers, providers and members one intelligent platform — AI-assisted
              triage, airtight maker-checker approvals, and a real-time view of every shilling. Now your
              team can work from anywhere with the ClaimsFlow mobile app.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/login">
                <Button className="group h-12 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40">
                  Sign in to your workspace
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="#mobile">
                <Button
                  variant="outline"
                  className="h-12 px-6 border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08] hover:text-white"
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  Get the app
                </Button>
              </a>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-2">
              {['No paperwork backlog', 'Audit-ready by default', 'Built for Kenya'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Hero illustration — inline SVG "claim dashboard" glass motif */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-blue-600/20 to-indigo-600/10 blur-2xl" />
            <HeroArt />
          </div>
        </section>

        {/* ── Stats infographic band ──────────────────────────────────────── */}
        <section id="platform" className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map(({ value, label, caption, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl backdrop-blur-xl transition-colors hover:border-blue-500/30"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
              <p className="mt-1 text-sm font-medium text-slate-200">{label}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{caption}</p>
            </div>
          ))}
        </section>

        {/* ── Feature grid ────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">The platform</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Everything a modern claims team needs
            </h2>
            <p className="mt-4 text-base text-slate-400">
              From the first scan to the final payout — one connected workflow, on the desk and in the field.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, body, icon: Icon }) => (
              <div
                key={title}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-lg backdrop-blur-xl transition-all hover:border-blue-500/30 hover:bg-white/[0.05]"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 text-blue-300 transition-colors group-hover:text-blue-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Mobile-app section ──────────────────────────────────────────── */}
        <section
          id="mobile"
          className="my-8 grid grid-cols-1 items-center gap-12 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-8 shadow-2xl backdrop-blur-xl lg:grid-cols-2 lg:p-14"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <Smartphone className="h-3.5 w-3.5 text-blue-400" />
              ClaimsFlow Mobile · Android &amp; iOS
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Process claims from the clinic floor
            </h2>
            <p className="max-w-lg text-base leading-relaxed text-slate-400">
              A provider&rsquo;s billing clerk can scan a stack of invoices before lunch. A maker-checker can
              clear their queue on the train to Nairobi. A fraud officer can flag a suspicious claim on the
              spot — every action hitting the same backend as the web app, with no second source of truth.
            </p>
            <ul className="space-y-3">
              {[
                { icon: ScanLine, text: 'Scan & batch-upload invoices with on-device OCR' },
                { icon: WifiOff, text: 'Offline-safe submissions that replay when you reconnect' },
                { icon: Fingerprint, text: 'Biometric sign-in and two-factor security' },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm text-slate-300">
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>

            {/* "Coming soon" store badges — app is not yet published */}
            <div className="flex flex-wrap gap-3 pt-2">
              <StoreBadge platform="apple" line1="Coming soon to the" line2="App Store" icon={Apple} />
              <StoreBadge platform="google" line1="Coming soon on" line2="Google Play" icon={Play} />
            </div>

            {/* Waitlist — presentational only for now */}
            <form onSubmit={handleNotify} className="flex max-w-md flex-col gap-2 pt-2 sm:flex-row">
              {notified ? (
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Thanks — we&rsquo;ll let you know the moment it launches.
                </p>
              ) : (
                <>
                  <input
                    type="email"
                    required
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="you@company.com"
                    aria-label="Email for launch notification"
                    className="h-11 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                  />
                  <Button
                    type="submit"
                    className="h-11 bg-white/10 text-white hover:bg-white/15"
                  >
                    Notify me
                  </Button>
                </>
              )}
            </form>
          </div>

          {/* Inline SVG phone mockup */}
          <div className="relative flex justify-center">
            <div className="absolute inset-0 rounded-full bg-blue-600/20 blur-3xl" />
            <PhoneMock />
          </div>
        </section>

        {/* ── Trust band ──────────────────────────────────────────────────── */}
        <section id="trust" className="py-20 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Built on trust</p>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Enterprise-grade security, from a name Kenya knows
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
            ClaimsFlow is built by CIC Insurance Group PLC — backed by an independently reviewed security
            and GDPR-alignment programme, so your members&rsquo; data is protected at every step.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {TRUST_CHIPS.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 backdrop-blur"
              >
                <Icon className="h-4 w-4 text-emerald-400" />
                {label}
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="my-8 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-blue-600/20 via-indigo-600/15 to-cyan-500/10 p-10 text-center shadow-2xl backdrop-blur-xl lg:p-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Ready to clear your claims backlog?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
            Sign in to your workspace or create an account in minutes. Healthcare providers can register
            their organisation and start submitting today.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/login">
              <Button className="group h-12 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/40">
                Sign in
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link to="/provider-register">
              <Button
                variant="outline"
                className="h-12 px-6 border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08] hover:text-white"
              >
                Register your organisation
              </Button>
            </Link>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="flex flex-col items-center justify-between gap-4 border-t border-white/5 py-10 text-sm text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <span>© {year} ClaimsFlow · CIC Insurance Group PLC</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/terms" className="transition-colors hover:text-slate-300">Terms</Link>
            <Link to="/privacy" className="transition-colors hover:text-slate-300">Privacy</Link>
            <Link to="/login" className="transition-colors hover:text-slate-300">Sign in</Link>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ── Inline SVG art (self-contained, no external assets) ─────────────────── */

function HeroArt() {
  return (
    <svg
      viewBox="0 0 460 360"
      role="img"
      aria-label="ClaimsFlow dashboard preview"
      className="relative w-full drop-shadow-2xl"
    >
      <defs>
        <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>

      {/* Main glass panel */}
      <rect x="20" y="20" width="420" height="320" rx="20" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.08)" />
      {/* Header row */}
      <rect x="40" y="42" width="120" height="12" rx="6" fill="rgba(255,255,255,0.25)" />
      <rect x="372" y="40" width="48" height="16" rx="8" fill="url(#accentGrad)" />

      {/* KPI chips */}
      <g>
        <rect x="40" y="74" width="120" height="64" rx="12" fill="rgba(59,130,246,0.10)" stroke="rgba(59,130,246,0.25)" />
        <rect x="54" y="90" width="48" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="54" y="108" width="74" height="16" rx="6" fill="#60a5fa" />
        <rect x="170" y="74" width="120" height="64" rx="12" fill="rgba(99,102,241,0.10)" stroke="rgba(99,102,241,0.25)" />
        <rect x="184" y="90" width="40" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="184" y="108" width="60" height="16" rx="6" fill="#818cf8" />
        <rect x="300" y="74" width="120" height="64" rx="12" fill="rgba(34,211,238,0.10)" stroke="rgba(34,211,238,0.25)" />
        <rect x="314" y="90" width="44" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="314" y="108" width="56" height="16" rx="6" fill="#22d3ee" />
      </g>

      {/* Chart area */}
      <rect x="40" y="156" width="250" height="160" rx="14" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" />
      {[
        { x: 64, h: 60 }, { x: 96, h: 90 }, { x: 128, h: 50 },
        { x: 160, h: 110 }, { x: 192, h: 78 }, { x: 224, h: 124 }, { x: 256, h: 96 },
      ].map((b, i) => (
        <rect key={i} x={b.x} y={300 - b.h} width="18" height={b.h} rx="5" fill="url(#barGrad)" opacity={0.85} />
      ))}

      {/* Side list */}
      <g>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(300 ${164 + i * 38})`}>
            <rect width="120" height="28" rx="8" fill="rgba(255,255,255,0.04)" />
            <circle cx="18" cy="14" r="6" fill={['#22c55e', '#f59e0b', '#3b82f6', '#22c55e'][i]} />
            <rect x="34" y="9" width="70" height="10" rx="5" fill="rgba(255,255,255,0.20)" />
          </g>
        ))}
      </g>

      {/* Floating "approved" badge */}
      <g transform="translate(330 26)">
        <rect width="104" height="34" rx="17" fill="#0f172a" stroke="rgba(34,197,94,0.4)" />
        <circle cx="22" cy="17" r="8" fill="rgba(34,197,94,0.2)" />
        <path d="M18 17 l3 3 l6 -6" stroke="#22c55e" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="38" y="12" width="52" height="10" rx="5" fill="rgba(34,197,94,0.55)" />
      </g>
    </svg>
  )
}

function PhoneMock() {
  return (
    <svg
      viewBox="0 0 260 520"
      role="img"
      aria-label="ClaimsFlow mobile app preview"
      className="relative w-[240px] max-w-full drop-shadow-2xl sm:w-[260px]"
    >
      <defs>
        <linearGradient id="phoneHeader" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* Body */}
      <rect x="10" y="10" width="240" height="500" rx="40" fill="#0b1220" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
      <rect x="20" y="20" width="220" height="480" rx="32" fill="#0f172a" />

      {/* Notch */}
      <rect x="100" y="28" width="60" height="10" rx="5" fill="#0b1220" />

      {/* App header */}
      <rect x="20" y="44" width="220" height="92" rx="0" fill="url(#phoneHeader)" />
      <rect x="38" y="66" width="92" height="12" rx="6" fill="rgba(255,255,255,0.9)" />
      <rect x="38" y="86" width="130" height="9" rx="4.5" fill="rgba(255,255,255,0.6)" />
      <circle cx="216" cy="74" r="14" fill="rgba(255,255,255,0.18)" />

      {/* Summary cards */}
      <rect x="38" y="150" width="84" height="56" rx="12" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.3)" />
      <rect x="50" y="162" width="34" height="8" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="50" y="178" width="50" height="14" rx="5" fill="#60a5fa" />
      <rect x="138" y="150" width="84" height="56" rx="12" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.3)" />
      <rect x="150" y="162" width="34" height="8" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="150" y="178" width="50" height="14" rx="5" fill="#22c55e" />

      {/* Claim list rows with status pills */}
      {[
        { y: 226, color: '#22c55e', label: 18 },
        { y: 282, color: '#f59e0b', label: 14 },
        { y: 338, color: '#3b82f6', label: 20 },
        { y: 394, color: '#22c55e', label: 16 },
      ].map((row, i) => (
        <g key={i}>
          <rect x="38" y={row.y} width="184" height="44" rx="12" fill="rgba(255,255,255,0.04)" />
          <circle cx="58" cy={row.y + 22} r="10" fill="rgba(255,255,255,0.08)" />
          <rect x="76" y={row.y + 12} width="80" height="9" rx="4.5" fill="rgba(255,255,255,0.28)" />
          <rect x="76" y={row.y + 26} width={row.label * 2.4} height="7" rx="3.5" fill="rgba(255,255,255,0.16)" />
          <rect x="176" y={row.y + 14} width="34" height="16" rx="8" fill={row.color} opacity="0.25" />
          <circle cx="186" cy={row.y + 22} r="3" fill={row.color} />
        </g>
      ))}

      {/* Bottom tab bar */}
      <rect x="20" y="456" width="220" height="44" rx="0" fill="#0b1220" />
      {[60, 110, 160, 200].map((cx, i) => (
        <circle key={i} cx={cx} cy="478" r="6" fill={i === 0 ? '#60a5fa' : 'rgba(255,255,255,0.25)'} />
      ))}

      {/* Floating action button (camera scan) */}
      <circle cx="216" cy="430" r="22" fill="url(#phoneHeader)" />
      <rect x="206" y="424" width="20" height="14" rx="3" fill="none" stroke="white" strokeWidth="2" />
      <circle cx="216" cy="431" r="3.5" fill="none" stroke="white" strokeWidth="2" />
    </svg>
  )
}

function StoreBadge({
  line1,
  line2,
  icon: Icon,
}: {
  platform: 'apple' | 'google'
  line1: string
  line2: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div
      aria-disabled="true"
      title="Coming soon"
      className="inline-flex cursor-default items-center gap-3 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 opacity-90"
    >
      <Icon className="h-6 w-6 text-slate-200" />
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{line1}</span>
        <span className="text-sm font-semibold text-slate-100">{line2}</span>
      </span>
    </div>
  )
}
