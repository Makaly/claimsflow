# Landing page & design system

The public landing page (`frontend/src/pages/Landing.tsx`) is the unauthenticated
marketing surface, rendered at `/` when there is no live session (see
`frontend/src/App.tsx`). It follows an **Enterprise Gateway** pattern — a
trust-oriented, role-first layout aimed at insurers, healthcare providers, and
members.

This document records the design decisions so the page stays consistent as it
evolves.

## Structure

| Order | Section | Purpose |
|-------|---------|---------|
| 1 | Sticky nav | Brand, anchor links, **theme toggle**, `Sign in` (secondary) + `Get started` (primary). |
| 2 | Hero | Mission headline + dual CTA, plus an **"I am a…"** role path-selection (Provider → `/provider-register`, Member → `/register`, Insurer → `/login`) and a product visual. |
| 3 | Proof band | Benefit-led stats (`STATS`). |
| 4 | Solutions by role | What each role gets — providers, members, claims officers, fraud & finance (`SOLUTIONS`). |
| 5 | Capabilities bento | Platform features in a varied bento grid (`FEATURES`). |
| 6 | Mobile | The ClaimsFlow mobile app, store badges (coming soon), waitlist. |
| 7 | Trust band | Security/compliance signals (`TRUST_CHIPS`) + CIC parentage. |
| 8 | Final CTA | Single focused call to action. |
| 9 | Footer | Legal links. |

Section data and the inline SVG art live in `frontend/src/pages/landing/`
(`data.ts`, `art.tsx`) so the page file stays focused on layout.

> **Content integrity:** every stat and claim must be defensible against the
> real platform (cross-check `frontend/src/pages/Login.tsx` `HIGHLIGHTS`). Do
> **not** add fabricated client logos, customer names, or testimonials — the
> trust band uses real security/compliance signals instead.

## Design system

Recommended via the *Trust & Authority* style for healthcare/insurance SaaS.

### Type

- **Headings:** Figtree · **Body:** Noto Sans.
- Loaded in `frontend/index.html` with `preconnect` + `display=swap`.
- Exposed as Tailwind utilities `font-heading` / `font-body`
  (`frontend/tailwind.config.js`). Applied on the landing surface only — the
  rest of the app keeps the default sans stack.

### Colour

- **`brand`** (blue, anchored on `#2563EB`) — the identity colour: links,
  accents, icon chips, the hero emphasis line.
- **`cta`** (orange, anchored on `#EA580C`) — reserved for the **single primary
  action per section**.
- Both are **scoped Tailwind token scales** added under `theme.extend.colors`;
  they deliberately do **not** touch the app-wide semantic tokens
  (`--primary`, etc. in `index.css`), so the blast radius is the landing page.
- Avoid the purple/indigo/cyan "AI gradient" look — keep accents within the
  blue family plus the orange CTA.

### Theming (light + dark)

- Every surface is authored light-default with `dark:` variants.
- The nav **theme toggle** (`ThemeToggle` in `Landing.tsx`) calls
  `toggleTheme()` from `frontend/src/store/themeStore.ts`, which persists to
  `localStorage` and toggles `.dark` on `document.documentElement`. No new theme
  mechanism was introduced.
- The hero/phone SVGs (`landing/art.tsx`) are intentionally dark "product
  screenshots" that read well on both light and dark page backgrounds.

## Animation

Lightweight and dependency-free (no `framer-motion`):

- **`Reveal`** (`frontend/src/components/Reveal.tsx`) + **`useReveal`**
  (`frontend/src/hooks/useReveal.ts`) — an `IntersectionObserver` reveal-once
  wrapper. Add `delay` (ms) to stagger items in a group.
- Tailwind keyframes: `fade-up`, `fade-in`, `float`, `float-slow`,
  `gradient-x`, `pulse-glow`, `grow-bar` (`tailwind.config.js`).
- **Reduced motion:** a global `@media (prefers-reduced-motion: reduce)` block
  in `frontend/src/index.css` neutralises decorative animation/transition and
  forces `.reveal` content visible.

## Accessibility checklist

- One primary CTA per section; `cta` orange reserved for primary actions.
- Contrast verified in **both** themes (body ≥ 4.5:1, large/UI glyphs ≥ 3:1).
- Visible focus states; all interactive elements keyboard-reachable.
- Decorative SVGs carry `role="img"` + `aria-label`; the theme toggle has an
  `aria-label`.
- `prefers-reduced-motion` respected.
- Responsive at 375 / 768 / 1024 / 1440 — no horizontal scroll.

## Verifying changes

```bash
cd frontend
npx tsc --noEmit        # type-check
npx vite build          # production build
npm run dev             # http://localhost:3000
```

When checking visually, exercise the nav theme toggle (light ⇄ dark), confirm
the hero role cards link to the right routes, and test at 375px and with OS
reduced-motion enabled.
