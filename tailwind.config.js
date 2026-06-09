/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin')

module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── STYLE.md design tokens ──
        bg: '#020617',
        surface: '#0f172a',
        elevated: '#1e293b',
        'edge-positive': '#22c55e',
        'edge-negative': '#ef4444',
        'quality-high': '#22c55e',
        'quality-mid': '#f59e0b',
        'quality-low': '#475569',
        mlb: '#ef4444',
        nhl: '#3b82f6',
        nfl: '#f59e0b',
        // ── Legacy brand aliases (kept for backwards compat during migration) ──
        'brand-blue': '#1e40af',
        'brand-green': '#059669',
        'brand-red': '#dc2626',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '4px',
        badge: '3px',
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
      })
    }),
  ],
}
