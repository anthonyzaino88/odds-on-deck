// Static SVG favicon - avoids the @vercel/og Windows path bug
// with spaces in directory names

export const size = { width: 32, height: 32 }
export const contentType = 'image/svg+xml'

export default function Icon() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="#020617"/>
      <text x="16" y="24" text-anchor="middle" font-size="22">⚾</text>
    </svg>`,
    {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    }
  )
}
