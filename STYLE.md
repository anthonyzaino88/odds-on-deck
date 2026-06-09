# Odds on Deck — Design System & Style Guide

> **Read this file before writing any component or UI code.**
> This is the canonical design language for Odds on Deck. Do not deviate from these tokens, patterns, or rules without a specific reason stated in the prompt.

---

## 🎯 Design Philosophy

**Direction**: Bloomberg Terminal meets a sharp sportsbook. Data-dense, analytically serious, dark-first. Every element earns its place by serving comprehension speed. No decorative noise. No rounded blobs. No gratuitous gradients.

This product is used by people scanning dozens of prop lines quickly and making real decisions. **Speed of comprehension > visual flair.** That said, we are not plain — we are precise.

**One-sentence test**: If it looks like a SaaS marketing page or a default shadcn demo, it's wrong.

---

## 🎨 Color Tokens

Add these to your `globals.css`. **Never hardcode hex values in components.**

```css
:root {
  /* ── Surfaces ── */
  --color-bg:             #020617;  /* slate-950 — page background */
  --color-surface:        #0f172a;  /* slate-900 — card, panel, table row */
  --color-elevated:       #1e293b;  /* slate-800 — hover row, active state */
  --color-border:         rgba(255, 255, 255, 0.06);
  --color-border-strong:  rgba(255, 255, 255, 0.12);

  /* ── Text ── */
  --color-text-primary:   #f1f5f9;  /* slate-100 */
  --color-text-secondary: #94a3b8;  /* slate-400 */
  --color-text-muted:     #475569;  /* slate-600 */

  /* ── Edge — positive ── */
  --color-edge-positive:        #22c55e;
  --color-edge-positive-bg:     rgba(34, 197, 94, 0.08);
  --color-edge-positive-border: rgba(34, 197, 94, 0.20);

  /* ── Edge — weak positive ── */
  --color-edge-weak:    rgba(34, 197, 94, 0.45);

  /* ── Edge — negative ── */
  --color-edge-negative:    #ef4444;
  --color-edge-negative-bg: rgba(239, 68, 68, 0.08);

  /* ── Quality score tiers ── */
  --color-quality-high: #22c55e;   /* score 7–10 */
  --color-quality-mid:  #f59e0b;   /* score 4–6  */
  --color-quality-low:  #475569;   /* score 0–3  */

  /* ── Sports ── */
  --color-mlb:    #ef4444;
  --color-mlb-bg: rgba(239, 68, 68, 0.10);
  --color-nhl:    #3b82f6;
  --color-nhl-bg: rgba(59, 130, 246, 0.10);
  --color-nfl:    #f59e0b;
  --color-nfl-bg: rgba(245, 158, 11, 0.10);

  /* ── Spacing ── */
  --row-height:         44px;
  --row-height-compact: 36px;
  --card-radius:        4px;
  --badge-radius:       3px;
}
```

---

## ✏️ Typography

### Font Stack

```css
/* In your layout or globals.css */
font-family: 'Geist', 'Inter', system-ui, sans-serif;

/* Numbers, odds, percentages — always */
font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
```

Install Geist via `next/font/google` or `@vercel/font`.

### Tabular Numbers — Required for All Numeric Columns

```css
/* Apply to every element displaying odds, %, or counts */
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum";
```

Add this Tailwind utility to `tailwind.config.js`:

```js
theme: {
  extend: {
    fontFamily: {
      mono: ['Geist Mono', 'JetBrains Mono', 'ui-monospace'],
    },
  },
},
plugins: [
  plugin(({ addUtilities }) => {
    addUtilities({
      '.tabular-nums': {
        'font-variant-numeric': 'tabular-nums',
        'font-feature-settings': '"tnum"',
      },
    });
  }),
],
```

### Text Scale

| Element              | Size  | Weight | Color                  | Notes                     |
|----------------------|-------|--------|------------------------|---------------------------|
| Page title           | 20px  | 600    | `text-slate-100`       |                           |
| Section heading      | 11px  | 600    | `text-slate-500`       | uppercase, tracking-widest |
| Table header         | 11px  | 500    | `text-slate-500`       | uppercase, tracking-wider  |
| Body / row text      | 14px  | 400    | `text-slate-100`       |                           |
| Odds value           | 15px  | 500    | `text-slate-100`       | tabular-nums, mono font    |
| Badge / pill label   | 10px  | 600    | varies by type         | uppercase                  |
| Muted meta           | 12px  | 400    | `text-slate-500`       |                           |
| Headline stat        | 24px  | 600    | `text-slate-100`       | tabular-nums               |

---

## 📐 Layout & Spacing

- **Max content width**: `max-w-screen-xl mx-auto px-4 md:px-6`
- **Page padding top**: `pt-6` desktop, `pt-4` mobile
- **Card padding**: `p-4` standard, `p-3` compact
- **Card gap**: `gap-3` within a group, `gap-6` between sections
- **Table cell**: `px-3 py-2.5` standard · `px-3 py-1.5` compact
- **Border radius**: 4px on cards/panels · 3px on badges · 6px on buttons only · `rounded-none` on table rows

---

## 🧩 Component Patterns

### Prop Card

```tsx
// PropCard.tsx
export function PropCard({ playerName, team, sport, propType, line, bestBook, bestOdds, edge }) {
  return (
    <div className="
      bg-[#0f172a] border border-white/[0.06] rounded-[4px] p-4
      hover:bg-[#1e293b] hover:border-white/[0.10]
      transition-colors duration-150 cursor-pointer
    ">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-100 truncate block">{playerName}</span>
          <span className="text-xs text-slate-500">{team}</span>
        </div>
        <SportBadge sport={sport} />
      </div>

      {/* Prop type + line */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
          {propType}
        </span>
        <span className="text-base font-semibold text-slate-100 tabular-nums font-mono">
          {line}
        </span>
      </div>

      {/* Best book + edge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookBadge book={bestBook} />
          <span className="text-[15px] font-medium text-slate-100 tabular-nums font-mono">
            {bestOdds > 0 ? `+${bestOdds}` : bestOdds}
          </span>
        </div>
        <EdgeBadge edge={edge} />
      </div>
    </div>
  );
}
```

---

### EdgeBadge

```tsx
import { cn } from '@/lib/utils';

export function EdgeBadge({ edge }: { edge: number }) {
  const isPositive = edge > 0;
  const isStrong   = edge >= 3;

  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold tabular-nums font-mono',
      isStrong  && 'bg-green-500/10 text-green-400 border border-green-500/20',
      isPositive && !isStrong && 'text-green-500/60',
      !isPositive && 'text-slate-500',
    )}>
      {isPositive ? '+' : ''}{edge.toFixed(1)}%
    </span>
  );
}
```

---

### SportBadge

```tsx
const SPORT_CONFIG = {
  MLB: { text: 'text-red-400',   bg: 'bg-red-500/10',   border: 'border-red-500/20',   label: 'MLB' },
  NHL: { text: 'text-blue-400',  bg: 'bg-blue-500/10',  border: 'border-blue-500/20',  label: 'NHL' },
  NFL: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'NFL' },
} as const;

export function SportBadge({ sport }: { sport: keyof typeof SPORT_CONFIG }) {
  const cfg = SPORT_CONFIG[sport];
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border',
      cfg.text, cfg.bg, cfg.border,
    )}>
      {cfg.label}
    </span>
  );
}
```

---

### BookBadge

```tsx
// Short book name label — not a logo, just a text chip
export function BookBadge({ book }: { book: string }) {
  return (
    <span className="
      inline-flex items-center px-1.5 py-0.5 rounded-[3px]
      text-[10px] font-medium uppercase tracking-wide
      bg-white/[0.05] text-slate-400
    ">
      {book}
    </span>
  );
}
```

---

### QualityScore

```tsx
export function QualityScore({ score }: { score: number }) {
  const [color, bg] =
    score >= 7 ? ['text-green-400', 'bg-green-500/10'] :
    score >= 4 ? ['text-amber-400', 'bg-amber-500/10'] :
                 ['text-slate-500', 'bg-white/[0.04]'];

  return (
    <span className={cn(
      'inline-flex items-center justify-center w-8 h-5 rounded-[3px]',
      'text-[11px] font-semibold tabular-nums font-mono',
      color, bg,
    )}>
      {score.toFixed(1)}
    </span>
  );
}
```

---

### Stat Card (win rate, hit rate, record)

```tsx
export function StatCard({
  label, value, sublabel, trend,
}: {
  label: string;
  value: string;
  sublabel?: string;
  trend?: number;
}) {
  return (
    <div className="bg-[#0f172a] border border-white/[0.06] rounded-[4px] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-slate-100 tabular-nums font-mono">
        {value}
      </p>
      {sublabel && (
        <p className="text-xs text-slate-500 mt-0.5">{sublabel}</p>
      )}
      {trend !== undefined && (
        <p className={cn('text-xs mt-1 tabular-nums', trend > 0 ? 'text-green-400' : 'text-slate-500')}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </p>
      )}
    </div>
  );
}
```

---

### Sport Filter (segmented control, not pills)

```tsx
export function SportFilter({
  options, active, onChange,
}: {
  options: string[];
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-[#0f172a] border border-white/[0.06] rounded-[4px] p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-[3px] transition-colors duration-100',
            active === opt
              ? 'bg-[#1e293b] text-slate-100'
              : 'text-slate-500 hover:text-slate-300',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
```

---

### Section Heading

```tsx
export function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
        {title}
      </h2>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  );
}
```

---

### Sticky Nav

```tsx
<nav className="
  sticky top-0 z-50
  border-b border-white/[0.06]
  bg-[#020617]/80 backdrop-blur-md
  px-4 md:px-6 h-12
  flex items-center justify-between
">
  {/* logo left, nav links center/right */}
</nav>
```

---

### Props Table Shell

```tsx
// Wrap table in this container — never put rounded on the table itself
<div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
  <table className="w-full text-sm">
    <thead className="bg-[#020617] border-b border-white/[0.06]">
      <tr>
        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Player
        </th>
        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Prop
        </th>
        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Line
        </th>
        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Best Odds
        </th>
        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Edge
        </th>
        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Score
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-white/[0.04]">
      {rows.map((row) => (
        <tr
          key={row.id}
          className="hover:bg-[#1e293b] transition-colors duration-100 h-[44px]"
        >
          {/* left-align: player, prop — right-align: line, odds, edge, score */}
          <td className="px-3 py-2.5 text-sm font-medium text-slate-100 sticky left-0 bg-[#0f172a]">
            {row.player}
          </td>
          <td className="px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wide">
            {row.propType}
          </td>
          <td className="px-3 py-2.5 text-right tabular-nums font-mono text-slate-100 font-medium">
            {row.line}
          </td>
          <td className="px-3 py-2.5 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <BookBadge book={row.bestBook} />
              <span className="tabular-nums font-mono font-medium text-slate-100">
                {row.bestOdds > 0 ? `+${row.bestOdds}` : row.bestOdds}
              </span>
            </div>
          </td>
          <td className="px-3 py-2.5 text-right">
            <EdgeBadge edge={row.edge} />
          </td>
          <td className="px-3 py-2.5 text-right">
            <QualityScore score={row.qualityScore} />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

---

## ⚡ Animation Rules (Framer Motion)

Use motion **only** for these cases:

```tsx
// 1. Odds flash when a line updates
<motion.span
  key={odds}                          // re-mounts on value change
  initial={{ color: '#22c55e' }}
  animate={{ color: '#f1f5f9' }}
  transition={{ duration: 1.4, ease: 'easeOut' }}
  className="tabular-nums font-mono"
>
  {formatOdds(odds)}
</motion.span>

// 2. Prop list stagger on load
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};
const item = {
  hidden: { opacity: 0, y: 8 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.12, ease: 'easeOut' } },
};

// 3. New prop appearing in list
<AnimatePresence>
  {items.map((item) => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
    />
  ))}
</AnimatePresence>
```

**Do not animate**: filter toggles, badge color changes, modal overlays (use Radix built-in), pagination, table sort.

---

## 🚫 Hard Rules — Banned Patterns

If you're about to write any of the following, stop and use the alternative.

| ❌ Banned | ✅ Use instead |
|-----------|----------------|
| `rounded-xl`, `rounded-2xl` on cards/panels | `rounded-[4px]` |
| `rounded-full` on filter chips | `rounded-[3px]` |
| `shadow-lg`, `shadow-xl`, `drop-shadow-*` | `border border-white/[0.06]` |
| `bg-gradient-to-*` on cards | flat `bg-[#0f172a]` |
| `text-purple-*` as accent | sport colors or `text-green-400` for edge |
| Default shadcn `<Badge>` | `EdgeBadge`, `SportBadge`, `BookBadge` above |
| `p-6` or `p-8` inside cards | `p-4` max |
| Centered layout on data pages | left-aligned, full-width |
| Alternating table row stripes | hover state only |
| Empty state with an SVG illustration | plain text message, `text-slate-500 text-sm` |
| `font-bold` on table headers | `font-medium` |
| `text-white` | `text-slate-100` |
| Inline `style={{ color: 'green' }}` | Tailwind class |
| Icon + label on every stat | label only unless icon adds meaning |
| `<form>` elements | React controlled state with `onChange` |

---

## 🛠 Cursor Prompt Snippets

Paste these into Cursor when generating new components:

**General preamble (add to every prompt):**
```
Follow STYLE.md. Dark surfaces #020617 / #0f172a / #1e293b. 
Border: rgba(255,255,255,0.06). Border-radius: 4px on cards, 3px on badges.
No shadows. No gradients on cards. tabular-nums + Geist Mono on all numeric values.
```

**Props table:**
```
Dense data table. 44px row height. Sticky thead bg-[#020617].
Left-align: player name, prop type. Right-align: line, odds, edge, score.
tabular-nums on all numbers. hover:bg-[#1e293b]. divide-y divide-white/[0.04].
```

**Edge indicator:**
```
EdgeBadge: strong positive (≥3%) = green-400 text, green-500/10 bg, green-500/20 border.
Weak positive = green-500/60 text, no bg. Zero/negative = slate-500 text, no bg.
```

**Stat summary card:**
```
StatCard: 11px uppercase tracking-widest label in slate-500.
24px semibold tabular-nums Geist Mono value in slate-100.
No icon. No shadow. Flat bg-[#0f172a] surface.
```

**Sport filter:**
```
Segmented control (not pills). bg-[#0f172a] container with p-0.5.
Active = bg-[#1e293b] text-slate-100. Inactive = text-slate-500.
MLB red-400, NHL blue-400, NFL amber-400. Text 11px uppercase tracking-wide.
```

**Odds flash (live update):**
```
Wrap updating odds value in Framer Motion span. key={oddsValue} to force remount.
initial color green-500, animate to slate-100, duration 1.4s easeOut.
```

---

## ✅ Stack Reference

| Layer | Library |
|-------|---------|
| Framework | Next.js 14+ (App Router) |
| Styling | Tailwind CSS v3 |
| Component primitives | shadcn/ui — **restyled, never default variants** |
| Tables | TanStack Table v8 |
| Animation | Framer Motion — selective use only |
| Charts | Recharts |
| Icons | Lucide React |
| Body font | Geist (via `next/font` or `@vercel/font`) |
| Number font | Geist Mono |
| Utilities | `clsx` + `tailwind-merge` via `cn()` |

---

*Odds on Deck · Design System v1 · June 2026*
*Place this file in your project root and reference it with `@STYLE.md` in Cursor prompts.*
