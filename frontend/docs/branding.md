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
