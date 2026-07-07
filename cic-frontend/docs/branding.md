# Branding

ClaimsFlow is the medical claims automation platform of **CIC Insurance Group PLC**.
The UI carries the CIC Group corporate identity: the official logo and the
maroon / gold palette taken directly from the CIC Group logo.

## Corporate palette

| Role | Hex | Source |
|---|---|---|
| Primary (maroon) | `#AC202D` | Dominant colour of the CIC Group logo |
| Accent (gold) | `#F9BF13` | The dot of the "i" in the logo mark |

### Where the colours live

There are three layers; change them together when rebranding:

1. **Semantic tokens** — `src/index.css`. `--primary`, `--ring`, `--chart-*`
   are HSL triplets consumed by the shadcn/ui components (`bg-primary`,
   `ring-ring`, …). Light mode uses `354 69% 40%` (`#AC202D`); dark mode lifts
   it to `354 65% 52%` for contrast on dark surfaces.
2. **Tailwind ramps** — `tailwind.config.js`. `brand.50–950` is the maroon
   ramp (`brand-600` = `#AC202D`); `cta.50–900` is the gold ramp
   (`cta-500` = `#F9BF13`). Utility classes (`bg-brand-600`,
   `text-brand-400`, gradients) are used throughout the app for buttons,
   links, focus rings and decorative gradients.
3. **Metadata / assets** — `index.html` (`theme-color`),
   `public/manifest.json` (`theme_color`), `public/favicon.svg`.

Status colours are unchanged and deliberately not brand-mapped:
red = error/rejected, amber = warning/pending, emerald = success/approved,
violet = AI-assisted features.

## Logo

- `public/cic-logo.png` — official CIC Group logo (mark + wordmark).
  Rendered inside a white rounded tile (`bg-white p-1 ring-1`) so it keeps
  contrast on dark panels (login hero, dark mode).
- `public/favicon.svg` — simplified flat rendition of the CIC emblem
  (maroon tile, white stadium ring and "i" stem, gold dot) that stays legible
  at 16 px. Also referenced by the PWA manifest.

Logo placements: `src/components/Sidebar.tsx` (app shell), all auth pages
(`Login`, `Register`, `ForgotPassword`, `ResetPassword`, `VerifyEmail`,
`UserRegister`, `ProviderRegister`) and the landing page header + footer
(`src/pages/Landing.tsx`).

## Accessibility notes

- `#AC202D` on white is ≈ 7.3:1 — passes WCAG AA/AAA for text and UI.
- Gold (`cta-500`) must be paired with dark text (`text-brand-950` or
  `text-slate-900`), never white.
- Dark-mode primary is lightened (see tokens above) so focus rings and
  primary buttons stay visible against `--background`.

## Buttons

Primary action buttons use the **gold** ramp, not maroon: the shared
`Button` default variant (`src/components/ui/button.tsx`) is
`bg-cta-500 text-brand-950 hover:bg-cta-400`, and the auth submit CTAs
use a `from-cta-500 to-cta-600` gradient with `text-brand-950`. Maroon
remains the identity colour for links, focus rings, nav states and
decorative accents.

## Imagery

The marketing surfaces (landing + login) lead with human photography in the
same visual language as [ke.cicinsurancegroup.com](https://ke.cicinsurancegroup.com/)
— families, care teams and members, under the "We keep our word" /
"Walking with you" promise.

- All photos live in `public/images/` as optimised WebP (24–200 KB,
  pre-cropped to their display aspect ratios).
- Hero, solutions-strip, mobile and trust images are referenced directly in
  `src/pages/Landing.tsx`; the people cards and persona quotes are data-driven
  via `PEOPLE` and `TESTIMONIALS` in `src/pages/landing/data.ts`.
- To re-theme, replace the files in `public/images/` (keeping the same
  aspect ratios) and adjust the alt text in `landing/data.ts` — no layout
  changes needed.
- Legibility over photos always comes from a maroon/slate gradient scrim
  (`from-brand-950/70+`), never from darkening the source asset.
- The quotes in `TESTIMONIALS` are representative personas for the demo
  surface; replace them with sourced customer quotes before production
  marketing use (see the note in `landing/data.ts`).

| File | Subject | Used in |
|------|---------|---------|
| `hero-family.webp` | Young family laughing in a park | Landing hero |
| `team-claims.webp` | Claims operations team | Solutions strip |
| `hero-care-team.webp` | Clinicians reviewing scans | Solutions strip |
| `provider-pharmacists.webp` | Pharmacist at his dispensary counter | People card · Login panel |
| `members-family.webp` | Family on a sofa with a tablet | People card |
| `life-stages.webp` | Grandmother laughing with her grandson | People card |
| `portrait-nurse.webp` / `portrait-doctor.webp` | Persona portraits | Testimonial avatars |
| `doctor-mobile.webp` | Clinician on a phone | Mobile section backdrop |
| `member-care.webp` | Nurse in scrubs at a clinic | Trust band |
| `nairobi-skyline.webp` | Nairobi at dusk | Final CTA backdrop |

Curation bar: prefer candid, editorial-style photographs of African subjects
in natural light over posed studio stock — the surfaces should feel like
Kenya, not like a photo shoot.
