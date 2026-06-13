import { cn } from '../../lib/utils'

const SIZE_CONFIG = {
  sm: { iconPx: 28, iconRadius: 5, barW: 5, barGap: 2, barHs: [7, 11, 16], barRx: 2.5, wordSize: 15, wordTrack: '-0.4px', tagSize: 0, gap: 8 },
  md: { iconPx: 40, iconRadius: 7, barW: 7, barGap: 3, barHs: [11, 17, 24], barRx: 3.5, wordSize: 20, wordTrack: '-0.6px', tagSize: 8, gap: 12 },
  lg: { iconPx: 56, iconRadius: 9, barW: 10, barGap: 4, barHs: [16, 25, 35], barRx: 5, wordSize: 28, wordTrack: '-1px', tagSize: 10, gap: 16 },
}

function LogoIcon({ size = 'md', border = false }) {
  const cfg = SIZE_CONFIG[size]
  const p = cfg.iconPx
  const totalBarW = cfg.barW * 3 + cfg.barGap * 2
  const startX = Math.round((p - totalBarW) / 2)
  const bottomY = Math.round(p * 0.85)
  const xs = [
    startX,
    startX + cfg.barW + cfg.barGap,
    startX + (cfg.barW + cfg.barGap) * 2,
  ]

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
  )
}

export function OddsOnDeckLogo({
  size = 'md',
  theme = 'dark',
  showTagline = false,
  iconOnly = false,
  className,
}) {
  const cfg = SIZE_CONFIG[size]
  const textPrimary = theme === 'dark' ? '#f1f5f9' : '#0f172a'
  const textGreen = theme === 'dark' ? '#22c55e' : '#16a34a'
  const textMuted = theme === 'dark' ? '#475569' : '#94a3b8'
  const fontBase = "var(--font-geist-sans, 'Inter', system-ui, sans-serif)"

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
  )
}

export function OddsOnDeckIcon({ size = 'md' }) {
  return <LogoIcon size={size} />
}

export default OddsOnDeckLogo
