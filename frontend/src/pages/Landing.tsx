import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ArrowUpRight,
  Smartphone,
  Sun,
  Moon,
  Apple,
  Play,
  BadgeCheck,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/Reveal'
import { useThemeStore } from '@/store/themeStore'
import { cn } from '@/lib/utils'
import {
  STATS,
  FEATURES,
  ROLE_PATHS,
  SOLUTIONS,
  TRUST_CHIPS,
  MOBILE_FEATURES,
} from './landing/data'
import { HeroArt, PhoneMock } from './landing/art'

/* Shared surface + button recipes — keeps light/dark consistent across sections.
   Brand blue is the identity colour; CTA-orange is reserved for the single
   primary action per section (ui-ux-pro-max "Trust & Authority" guidance). */
const CARD =
  'rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none'
const PRIMARY_CTA =
  'bg-cta-600 text-white shadow-lg shadow-cta-600/25 transition-all duration-300 hover:-translate-y-0.5 hover:bg-cta-500 hover:shadow-xl hover:shadow-cta-500/30'
const OUTLINE_CTA =
  'border-slate-300 bg-white text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 dark:border-white/15 dark:bg-white/[0.03] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:hover:text-white'

const GITHUB_RELEASE_API =
  'https://api.github.com/repos/Makaly/claimsflow-mobile/releases/latest'
const FALLBACK_APK = '/claimsflow-android.apk'

function useLatestApkRelease() {
  const [apkUrl, setApkUrl] = useState<string>(FALLBACK_APK)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(GITHUB_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const tag: string = data?.tag_name ?? ''
        const asset = (data?.assets ?? []).find(
          (a: { name: string; browser_download_url: string }) => a.name.endsWith('.apk'),
        )
        if (asset?.browser_download_url) setApkUrl(asset.browser_download_url)
        if (tag) setVersion(tag.replace(/^v/, ''))
      })
      .catch(() => {
        /* keep fallback values */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { apkUrl, version }
}

export default function Landing() {
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notified, setNotified] = useState(false)
  const year = new Date().getFullYear()
  const { apkUrl, version } = useLatestApkRelease()

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: POST { email } to a mobile-launch waitlist endpoint once the backend
    // route exists. Presentational confirmation only for now.
    if (notifyEmail.trim()) setNotified(true)
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#F8FAFC] font-body text-slate-600 transition-colors dark:bg-slate-950 dark:text-slate-300">
      {/* Ambient background — soft brand tints, stronger in dark, subtle in light */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] animate-pulse-glow rounded-full bg-brand-400/15 blur-3xl dark:bg-brand-600/20" />
        <div className="absolute top-1/3 -right-32 h-[520px] w-[520px] animate-float-slow rounded-full bg-brand-300/10 blur-3xl dark:bg-brand-700/20" />
        <div className="absolute -bottom-40 left-1/4 h-[460px] w-[460px] animate-pulse-glow rounded-full bg-cta-400/5 blur-3xl [animation-delay:2s] dark:bg-cta-600/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.04)_1px,transparent_0)] [background-size:32px_32px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)]" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-10">
        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 -mx-6 mb-4 flex items-center justify-between gap-4 border-b border-slate-200/70 bg-[#F8FAFC]/80 px-6 py-4 backdrop-blur-xl dark:border-white/5 dark:bg-slate-950/70 lg:-mx-10 lg:px-10">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 shadow-lg shadow-brand-600/30">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="font-heading text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">ClaimsFlow</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Medical Claims Automation</p>
            </div>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 dark:text-slate-300 md:flex">
            <a href="#solutions" className="transition-colors hover:text-brand-600 dark:hover:text-white">Solutions</a>
            <a href="#platform" className="transition-colors hover:text-brand-600 dark:hover:text-white">Platform</a>
            <a href="#mobile" className="transition-colors hover:text-brand-600 dark:hover:text-white">Mobile</a>
            <a href="#trust" className="transition-colors hover:text-brand-600 dark:hover:text-white">Trust</a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-brand-600 dark:text-slate-200 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Link to="/register">
              <Button className={cn('group h-10', PRIMARY_CTA)}>
                Get started
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 items-center gap-12 py-14 lg:grid-cols-2 lg:py-20">
          <div className="space-y-7">
            <div className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm [animation-delay:60ms] dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-brand-600 dark:text-brand-400" />
              Now with a mobile app for the field
            </div>
            <h1 className="animate-fade-up font-heading text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 [animation-delay:140ms] dark:text-white sm:text-5xl xl:text-6xl">
              Settle medical claims
              <br />
              <span className="text-brand-600 dark:text-brand-400">in minutes, not weeks.</span>
            </h1>
            <p className="max-w-xl animate-fade-up text-base leading-relaxed text-slate-600 [animation-delay:220ms] dark:text-slate-400">
              ClaimsFlow gives insurers, providers and members one intelligent platform — AI-assisted
              triage, airtight maker-checker approvals, and a real-time view of every shilling. Now your
              team can work from anywhere with the ClaimsFlow mobile app.
            </p>
            <div className="flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:300ms]">
              <Link to="/login">
                <Button className={cn('group h-12 px-6', PRIMARY_CTA)}>
                  Sign in to your workspace
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="#mobile">
                <Button variant="outline" className={cn('h-12 px-6', OUTLINE_CTA)}>
                  <Download className="mr-2 h-4 w-4" />
                  Get the app
                </Button>
              </a>
            </div>

            {/* Role path-selection — "I am a…" sends each visitor to the right door */}
            <div className="grid animate-fade-up grid-cols-1 gap-3 pt-2 [animation-delay:380ms] sm:grid-cols-3">
              {ROLE_PATHS.map(({ label, blurb, to, icon: Icon }) => (
                <Link
                  key={label}
                  to={to}
                  className={cn(
                    CARD,
                    'group/role flex flex-col gap-2 p-4 hover:-translate-y-1 hover:border-brand-300 hover:shadow-md dark:hover:border-brand-500/40',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-slate-400 transition-all group-hover/role:translate-x-0.5 group-hover/role:-translate-y-0.5 group-hover/role:text-brand-600 dark:group-hover/role:text-brand-400" />
                  </div>
                  <p className="font-heading text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{blurb}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Product visual — dark "screenshot" that floats over a breathing glow */}
          <div className="relative animate-fade-in [animation-delay:300ms]">
            <div className="absolute -inset-6 animate-pulse-glow rounded-[2rem] bg-gradient-to-tr from-brand-500/20 to-brand-700/10 blur-2xl" />
            <div className="animate-float">
              <HeroArt />
            </div>
          </div>
        </section>

        {/* ── Proof band (stats) ──────────────────────────────────────────── */}
        <section id="platform" className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map(({ value, label, caption, icon: Icon }, i) => (
            <Reveal
              key={label}
              delay={i * 90}
              className={cn(CARD, 'group p-6 hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg dark:hover:border-brand-500/30')}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-transform duration-300 group-hover:scale-110 dark:bg-brand-500/10 dark:text-brand-400">
                <Icon className="h-5 w-5" />
              </div>
              <p className="font-heading text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
              <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{caption}</p>
            </Reveal>
          ))}
        </section>

        {/* ── Solutions by role ───────────────────────────────────────────── */}
        <section id="solutions" className="py-20">
          <SectionHeading
            eyebrow="Built for every role"
            title="One platform, every seat at the table"
            body="From the clinic floor to the finance desk — each role gets exactly the tools they need, on the same source of truth."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SOLUTIONS.map(({ role, body, points, icon: Icon }, i) => (
              <Reveal
                key={role}
                delay={(i % 4) * 80}
                className={cn(CARD, 'group flex flex-col p-6 hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg dark:hover:border-brand-500/30')}
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-brand-600/5 text-brand-600 transition-transform duration-300 group-hover:scale-110 dark:text-brand-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">{role}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</p>
                <ul className="mt-4 space-y-2">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Platform capabilities (bento) ───────────────────────────────── */}
        <section className="pb-20">
          <SectionHeading
            eyebrow="The platform"
            title="Everything a modern claims team needs"
            body="From the first scan to the final payout — one connected workflow, on the desk and in the field."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ title, body, icon: Icon, span }, i) => (
              <Reveal
                key={title}
                delay={(i % 3) * 90}
                className={cn(
                  CARD,
                  'group p-6 hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg dark:hover:border-brand-500/30',
                  span === 'lg' && 'sm:col-span-2 lg:col-span-2',
                )}
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-brand-600/5 text-brand-600 transition-all duration-300 group-hover:scale-110 dark:text-brand-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Mobile-app section ──────────────────────────────────────────── */}
        <section
          id="mobile"
          className={cn(
            'my-8 grid grid-cols-1 items-center gap-12 rounded-3xl p-8 lg:grid-cols-2 lg:p-14',
            'border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-white/[0.03] dark:shadow-2xl',
          )}
        >
          <Reveal className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <Smartphone className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
              ClaimsFlow Mobile · Android &amp; iOS
            </div>
            <h2 className="font-heading text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Process claims from the clinic floor
            </h2>
            <p className="max-w-lg text-base leading-relaxed text-slate-600 dark:text-slate-400">
              A provider&rsquo;s billing clerk can scan a stack of invoices before lunch. A maker-checker can
              clear their queue on the train to Nairobi. A fraud officer can flag a suspicious claim on the
              spot — every action hitting the same backend as the web app, with no second source of truth.
            </p>
            <ul className="space-y-3">
              {MOBILE_FEATURES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600 dark:text-brand-400" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>

            {/* Store badges — Android is live, iOS is coming soon */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap gap-3">
                <StoreBadge
                  line1="Download for"
                  line2={version ? `Android v${version}` : 'Android'}
                  icon={Play}
                  href={apkUrl}
                />
                <StoreBadge line1="Coming soon to the" line2="App Store" icon={Apple} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-500">
                {version ? `Android v${version}` : 'Android beta'} · enable &ldquo;Install unknown
                apps&rdquo; in Settings before installing
              </p>
            </div>

            {/* iOS waitlist */}
            <form onSubmit={handleNotify} className="flex max-w-md flex-col gap-2 pt-1 sm:flex-row">
              {notified ? (
                <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Thanks — we&rsquo;ll notify you when the iOS app is ready.
                </p>
              ) : (
                <>
                  <input
                    type="email"
                    required
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="you@company.com"
                    aria-label="Email for iOS launch notification"
                    className="h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <Button type="submit" className={cn('h-11', PRIMARY_CTA)}>
                    Notify me for iOS
                  </Button>
                </>
              )}
            </form>
          </Reveal>

          {/* Inline SVG phone mockup — floats above a breathing glow */}
          <div className="relative flex justify-center">
            <div className="absolute inset-0 animate-pulse-glow rounded-full bg-brand-500/20 blur-3xl" />
            <div className="animate-float-slow">
              <PhoneMock />
            </div>
          </div>
        </section>

        {/* ── Trust band ──────────────────────────────────────────────────── */}
        <section id="trust" className="py-20 text-center">
          <Reveal>
            <p className="font-heading text-sm font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">Built on trust</p>
            <h2 className="mx-auto mt-3 max-w-2xl font-heading text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Enterprise-grade security, from a name Kenya knows
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 dark:text-slate-400">
              ClaimsFlow is built by CIC Insurance Group PLC — backed by an independently reviewed security
              and GDPR-alignment programme, so your members&rsquo; data is protected at every step.
            </p>
          </Reveal>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {TRUST_CHIPS.map(({ label, icon: Icon }, i) => (
              <Reveal
                key={label}
                delay={i * 60}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-400/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-emerald-400/30 dark:hover:text-white"
              >
                <Icon className="h-4 w-4 text-emerald-500" />
                {label}
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <Reveal
          as="section"
          className="group relative my-8 overflow-hidden rounded-3xl border border-brand-500/20 bg-gradient-to-br from-brand-600 to-brand-700 p-10 text-center shadow-2xl shadow-brand-600/20 lg:p-16"
        >
          {/* Sheen that sweeps across on hover */}
          <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
          <h2 className="relative mx-auto max-w-2xl font-heading text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to clear your claims backlog?
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-base text-brand-50/90">
            Sign in to your workspace or create an account in minutes. Healthcare providers can register
            their organisation and start submitting today.
          </p>
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/login">
              <Button className={cn('group/btn h-12 px-6', PRIMARY_CTA)}>
                Sign in
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
              </Button>
            </Link>
            <Link to="/provider-register">
              <Button
                variant="outline"
                className="h-12 border-white/40 bg-white/10 px-6 text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/20 hover:text-white"
              >
                Register your organisation
              </Button>
            </Link>
          </div>
        </Reveal>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="flex flex-col items-center justify-between gap-4 border-t border-slate-200 py-10 text-sm text-slate-500 dark:border-white/5 dark:text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-700">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <span>© {year} ClaimsFlow · CIC Insurance Group PLC</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/terms" className="transition-colors hover:text-brand-600 dark:hover:text-slate-300">Terms</Link>
            <Link to="/privacy" className="transition-colors hover:text-brand-600 dark:hover:text-slate-300">Privacy</Link>
            <Link to="/login" className="transition-colors hover:text-brand-600 dark:hover:text-slate-300">Sign in</Link>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ── Local presentational helpers ────────────────────────────────────────── */

function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center">
      <p className="font-heading text-sm font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">{eyebrow}</p>
      <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base text-slate-600 dark:text-slate-400">{body}</p>
    </Reveal>
  )
}

function StoreBadge({
  line1,
  line2,
  icon: Icon,
  href,
}: {
  line1: string
  line2: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
}) {
  const inner = (
    <>
      <Icon className="h-6 w-6 flex-shrink-0 text-slate-700 dark:text-slate-200" />
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{line1}</span>
        <span className="flex items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {line2}
          {href ? (
            <Download className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
          ) : (
            <BadgeCheck className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          )}
        </span>
      </span>
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        download
        className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-brand-400/30 dark:bg-brand-500/10 dark:hover:border-brand-400/50 dark:hover:bg-brand-500/15"
      >
        {inner}
      </a>
    )
  }

  return (
    <div
      aria-disabled="true"
      title="Coming soon"
      className="inline-flex cursor-default items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 opacity-60 dark:border-white/10 dark:bg-white/[0.03]"
    >
      {inner}
    </div>
  )
}
