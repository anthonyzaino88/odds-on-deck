// Static SVG apple icon - avoids the @vercel/og Windows path bug
// with spaces in directory names

export const size = { width: 180, height: 180 }
export const contentType = 'image/svg+xml'

export default function AppleIcon() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
      </defs>
      <rect width="180" height="180" rx="36" fill="url(#bg)"/>
      <text x="90" y="125" text-anchor="middle" font-size="120">⚾</text>
    </svg>`,
    {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    }
  )
}
