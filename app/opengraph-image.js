import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Odds on Deck — Prop Analytics'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Inter (the brand reference font) from the Google Fonts static CDN. Fetched at
// the edge in production. This route is never executed during a local Windows
// build, which avoids the @vercel/og spaces-in-path bug.
const INTER_BOLD = 'https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZJhiI2B.woff2'
const INTER_LIGHT = 'https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfAZJhiI2B.woff2'

export default async function Image() {
  let fonts
  try {
    const [bold, light] = await Promise.all([
      fetch(INTER_BOLD).then((r) => r.arrayBuffer()),
      fetch(INTER_LIGHT).then((r) => r.arrayBuffer()),
    ])
    fonts = [
      { name: 'Inter', data: bold, style: 'normal', weight: 800 },
      { name: 'Inter', data: light, style: 'normal', weight: 300 },
    ]
  } catch {
    fonts = undefined
  }

  const fontFamily = fonts ? 'Inter' : 'sans-serif'

  return new ImageResponse(
    (
      <div
        style={{
          background: '#020617',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle, #1e293b 1.5px, transparent 1.5px)',
            backgroundSize: '40px 40px',
            opacity: 0.5,
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 32, zIndex: 1 }}>
          <div
            style={{
              width: 96,
              height: 96,
              background: '#0f172a',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: 6,
              padding: '16px 14px',
            }}
          >
            <div style={{ width: 18, height: 22, background: '#22c55e', borderRadius: 9 }} />
            <div style={{ width: 18, height: 36, background: '#22c55e', borderRadius: 9 }} />
            <div style={{ width: 18, height: 50, background: '#22c55e', borderRadius: 9 }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily, fontSize: 72, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-2.5px' }}>ODDS</span>
              <span style={{ fontFamily, fontSize: 72, fontWeight: 300, color: '#22c55e', letterSpacing: '-0.5px' }}>ON</span>
              <span style={{ fontFamily, fontSize: 72, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-2.5px' }}>DECK</span>
            </div>
            <span style={{ fontFamily, fontSize: 18, fontWeight: 500, color: '#334155', letterSpacing: 7 }}>PROP ANALYTICS</span>
          </div>
        </div>

        <span style={{ position: 'absolute', bottom: 44, fontFamily, fontSize: 18, fontWeight: 300, color: '#334155', letterSpacing: 1 }}>
          oddsondeck.com
        </span>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) }
  )
}
