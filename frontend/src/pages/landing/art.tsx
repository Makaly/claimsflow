/* Inline SVG art (self-contained, no external assets).
   Rendered as dark "product screenshot" surfaces so they read well on both the
   light and dark page backgrounds. Accents use the brand blue palette (no
   cyan/indigo "AI gradient") plus emerald for success and a single CTA-orange. */

export function HeroArt() {
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
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#60a5fa" />
        </linearGradient>
      </defs>

      {/* Main panel */}
      <rect x="20" y="20" width="420" height="320" rx="20" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.08)" />
      {/* Header row */}
      <rect x="40" y="42" width="120" height="12" rx="6" fill="rgba(255,255,255,0.25)" />
      <rect x="372" y="40" width="48" height="16" rx="8" fill="url(#accentGrad)" />

      {/* KPI chips */}
      <g>
        <rect x="40" y="74" width="120" height="64" rx="12" fill="rgba(37,99,235,0.12)" stroke="rgba(37,99,235,0.30)" />
        <rect x="54" y="90" width="48" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="54" y="108" width="74" height="16" rx="6" fill="#60a5fa" />
        <rect x="170" y="74" width="120" height="64" rx="12" fill="rgba(37,99,235,0.10)" stroke="rgba(37,99,235,0.24)" />
        <rect x="184" y="90" width="40" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="184" y="108" width="60" height="16" rx="6" fill="#3b82f6" />
        <rect x="300" y="74" width="120" height="64" rx="12" fill="rgba(234,88,12,0.12)" stroke="rgba(234,88,12,0.28)" />
        <rect x="314" y="90" width="44" height="10" rx="5" fill="rgba(255,255,255,0.35)" />
        <rect x="314" y="108" width="56" height="16" rx="6" fill="#fb923c" />
      </g>

      {/* Chart area */}
      <rect x="40" y="156" width="250" height="160" rx="14" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" />
      {[
        { x: 64, h: 60 }, { x: 96, h: 90 }, { x: 128, h: 50 },
        { x: 160, h: 110 }, { x: 192, h: 78 }, { x: 224, h: 124 }, { x: 256, h: 96 },
      ].map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={300 - b.h}
          width="18"
          height={b.h}
          rx="5"
          fill="url(#barGrad)"
          opacity={0.9}
          className="animate-grow-bar origin-bottom [transform-box:fill-box]"
          style={{ animationDelay: `${400 + i * 90}ms` }}
        />
      ))}

      {/* Side list */}
      <g>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(300 ${164 + i * 38})`}>
            <rect width="120" height="28" rx="8" fill="rgba(255,255,255,0.04)" />
            <circle cx="18" cy="14" r="6" fill={['#22c55e', '#fb923c', '#3b82f6', '#22c55e'][i]} />
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

export function PhoneMock() {
  return (
    <svg
      viewBox="0 0 260 520"
      role="img"
      aria-label="ClaimsFlow mobile app preview"
      className="relative w-[240px] max-w-full drop-shadow-2xl sm:w-[260px]"
    >
      <defs>
        <linearGradient id="phoneHeader" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#3b82f6" />
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
      <rect x="38" y="150" width="84" height="56" rx="12" fill="rgba(37,99,235,0.14)" stroke="rgba(37,99,235,0.34)" />
      <rect x="50" y="162" width="34" height="8" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="50" y="178" width="50" height="14" rx="5" fill="#60a5fa" />
      <rect x="138" y="150" width="84" height="56" rx="12" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.3)" />
      <rect x="150" y="162" width="34" height="8" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="150" y="178" width="50" height="14" rx="5" fill="#22c55e" />

      {/* Claim list rows with status pills */}
      {[
        { y: 226, color: '#22c55e', label: 18 },
        { y: 282, color: '#fb923c', label: 14 },
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
