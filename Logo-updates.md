# Task: Implement Odds on Deck Logo System

You are implementing a new brand logo system across the Odds on Deck Next.js app (App Router). The codebase is plain JavaScript — use `.js` and `.jsx` file extensions only, no TypeScript. Follow @STYLE.md for any design decisions. Do not modify page content, data fetching logic, or routing. Run `npm run build` after completing all steps to verify no errors.

---

## Step 1 — Create public assets

### `public/favicon.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="5" fill="#0f172a"/>
  <rect x="7"  y="19" width="5" height="8"  rx="2.5" fill="#22c55e"/>
  <rect x="14" y="14" width="5" height="13" rx="2.5" fill="#22c55e"/>
  <rect x="21" y="8"  width="5" height="19" rx="2.5" fill="#22c55e"/>
</svg>
```

### `public/logo-icon.svg`
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" rx="32" fill="#0f172a"/>
  <rect x="35"  y="120" width="34" height="50"  rx="17" fill="#22c55e"/>
  <rect x="83"  y="90"  width="34" height="80"  rx="17" fill="#22c55e"/>
  <rect x="131" y="60"  width="34" height="110" rx="17" fill="#22c55e"/>
</svg>
```

---

## Step 2 — Create the logo component

Create `components/ui/OddsOnDeckLogo.jsx`:

```jsx
import { cn } from '@/lib/utils';

const SIZE_CONFIG = {
  sm: { iconPx: 28, iconRadius: 5,  barW: 5,  barGap: 2, barHs: [7,  11, 16], barRx: 2.5, wordSize: 15, wordTrack: '-0.4px', tagSize: 0,  gap: 8  },
  md: { iconPx: 40, iconRadius: 7,  barW: 7,  barGap: 3, barHs: [11, 17, 24], barRx: 3.5, wordSize: 20, wordTrack: '-0.6px', tagSize: 8,  gap: 12 },
  lg: { iconPx: 56, iconRadius: 9,  barW: 10, barGap: 4, barHs: [16, 25, 35], barRx: 5,   wordSize: 28, wordTrack: '-1px',   tagSize: 10, gap: 16 },
};

function LogoIcon({ size = 'md', border = false }) {
  const cfg = SIZE_CONFIG[size];
  const p = cfg.iconPx;
  const totalBarW = cfg.barW * 3 + cfg.barGap * 2;
  const startX = Math.round((p - totalBarW) / 2);
  const bottomY = Math.round(p * 0.85);
  const xs = [
    startX,
    startX + cfg.barW + cfg.barGap,
    startX + (cfg.barW + cfg.barGap) * 2,
  ];

  return (
    <svg
      width={p}
      height={p}
      viewBox={`0 0 ${p} ${p}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect
        width={p}
        height={p}
        rx={cfg.iconRadius}
        fill="#0f172a"
        {...(border ? { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 } : {})}
      />
      {cfg.barHs.map((h, i) => (
        <rect
          key={i}
          x={xs[i]}
          y={bottomY - h}
          width={cfg.barW}
          height={h}
          rx={cfg.barRx}
          fill="#22c55e"
        />
      ))}
    </svg>
  );
}

export function OddsOnDeckLogo({
  size = 'md',
  theme = 'dark',
  showTagline = false,
  iconOnly = false,
  className,
}) {
  const cfg = SIZE_CONFIG[size];
  const textPrimary = theme === 'dark' ? '#f1f5f9' : '#0f172a';
  const textGreen   = theme === 'dark' ? '#22c55e' : '#16a34a';
  const textMuted   = theme === 'dark' ? '#475569' : '#94a3b8';
  const fontBase    = "var(--font-geist-sans, 'Inter', system-ui, sans-serif)";

  return (
    <div
      className={cn('flex items-center', className)}
      style={{ gap: cfg.gap }}
      aria-label="Odds on Deck"
    >
      <LogoIcon size={size} border={theme === 'dark'} />

      {!iconOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: size === 'sm' ? 4 : 5, lineHeight: 1 }}>
            <span style={{ fontFamily: fontBase, fontSize: cfg.wordSize, fontWeight: 800, color: textPrimary, letterSpacing: cfg.wordTrack }}>
              ODDS
            </span>
            <span style={{ fontFamily: fontBase, fontSize: cfg.wordSize, fontWeight: 300, color: textGreen, letterSpacing: '-0.2px' }}>
              ON
            </span>
            <span style={{ fontFamily: fontBase, fontSize: cfg.wordSize, fontWeight: 800, color: textPrimary, letterSpacing: cfg.wordTrack }}>
              DECK
            </span>
          </div>

          {showTagline && cfg.tagSize > 0 && (
            <span style={{ fontFamily: fontBase, fontSize: cfg.tagSize, fontWeight: 500, color: textMuted, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Prop Analytics
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function OddsOnDeckIcon({ size = 'md' }) {
  return <LogoIcon size={size} />;
}

export default OddsOnDeckLogo;
```

---

## Step 3 — Create the OG image

Create `app/opengraph-image.js`:

```js
import { ImageResponse } from 'next/og';

export const runtime     = 'edge';
export const alt         = 'Odds on Deck — Prop Analytics';
export const size        = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  let fontBold, fontLight;

  try {
    // Try local Geist first (present when using next/font with the geist package)
    [fontBold, fontLight] = await Promise.all([
      fetch(new URL('../../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2',  import.meta.url)).then(r => r.arrayBuffer()),
      fetch(new URL('../../node_modules/geist/dist/fonts/geist-sans/Geist-Light.woff2', import.meta.url)).then(r => r.arrayBuffer()),
    ]);
  } catch {
    // Fallback: Inter from Google Fonts static CDN
    [fontBold, fontLight] = await Promise.all([
      fetch('https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZJhiI2B.woff2').then(r => r.arrayBuffer()),
      fetch('https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfAZJhiI2B.woff2').then(r => r.arrayBuffer()),
    ]);
  }

  return new ImageResponse(
    (
      <div style={{ background: '#020617', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', position: 'relative' }}>

        {/* Dot grid */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, #1e293b 1.5px, transparent 1.5px)', backgroundSize: '40px 40px', opacity: 0.5, display: 'flex' }} />

        {/* Logo row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, zIndex: 1 }}>
          {/* Icon mark */}
          <div style={{ width: 96, height: 96, background: '#0f172a', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, padding: '16px 14px' }}>
            <div style={{ width: 18, height: 22, background: '#22c55e', borderRadius: 9 }} />
            <div style={{ width: 18, height: 36, background: '#22c55e', borderRadius: 9 }} />
            <div style={{ width: 18, height: 50, background: '#22c55e', borderRadius: 9 }} />
          </div>

          {/* Wordmark */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily: 'Bold',  fontSize: 72, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-2.5px' }}>ODDS</span>
              <span style={{ fontFamily: 'Light', fontSize: 72, fontWeight: 300, color: '#22c55e', letterSpacing: '-0.5px' }}>ON</span>
              <span style={{ fontFamily: 'Bold',  fontSize: 72, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-2.5px' }}>DECK</span>
            </div>
            <span style={{ fontFamily: 'Bold', fontSize: 18, fontWeight: 500, color: '#334155', letterSpacing: 7 }}>PROP ANALYTICS</span>
          </div>
        </div>

        {/* URL watermark */}
        <span style={{ position: 'absolute', bottom: 44, fontFamily: 'Light', fontSize: 18, color: '#334155', letterSpacing: 1 }}>
          oddsondeck.com
        </span>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Bold',  data: fontBold,  style: 'normal', weight: 800 },
        { name: 'Light', data: fontLight, style: 'normal', weight: 300 },
      ],
    }
  );
}
```

---

## Step 4 — Update layout metadata

Open `app/layout.js`. Add or fully replace the `metadata` export. Do not change the layout JSX or font configuration:

```js
export const metadata = {
  title: {
    default:  'Odds on Deck',
    template: '%s · Odds on Deck',
  },
  description: 'Real-time prop betting analytics. Find edges across sportsbooks before the line moves.',
  metadataBase: new URL('https://oddsondeck.com'),
  openGraph: {
    type:        'website',
    locale:      'en_US',
    url:         'https://oddsondeck.com',
    siteName:    'Odds on Deck',
    title:       'Odds on Deck — Prop Analytics',
    description: 'Real-time prop betting analytics. Find edges across sportsbooks before the line moves.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Odds on Deck' }],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Odds on Deck — Prop Analytics',
    description: 'Real-time prop betting analytics.',
    images:      ['/opengraph-image'],
  },
  icons: {
    icon:  '/favicon.svg',
    apple: '/logo-icon.svg',
  },
};
```

---

## Step 5 — Replace logo in the nav/header

Search the codebase for the existing logo or brand name. Look for:
- Any `<Logo` or `<Brand` component imports
- Hardcoded text like "Odds on Deck" inside nav/header JSX
- Any `logo.svg` or `logo.png` `<Image>` tags in the header

Replace whatever you find with the new component. Add this import:

```js
import { OddsOnDeckLogo } from '@/components/ui/OddsOnDeckLogo';
```

Replace the old logo element with:

```jsx
<OddsOnDeckLogo size="sm" />
```

Do not add extra wrapper divs or change the existing nav layout around it.

---

## Rules

- All new files use `.js` or `.jsx` — no `.ts` or `.tsx`
- No TypeScript syntax: no type annotations, no interfaces, no `satisfies`, no generics
- Follow @STYLE.md for any adjacent design decisions
- Do not modify any route, API, or data-fetching logic
- Do not change any file not mentioned in the steps above
- If `cn` is not at `@/lib/utils`, find the correct import path in the existing codebase first
- If `font-geist-sans` is not the CSS variable name in this project, check `app/layout.js` for the actual `variable` value on the Geist font and update the `fontBase` string in `OddsOnDeckLogo.jsx` accordingly
- After all steps, run `npm run build` and fix any errors before finishing
