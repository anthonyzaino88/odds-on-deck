// Static SVG favicon - avoids the @vercel/og Windows path bug
// with spaces in directory names

export const size = { width: 32, height: 32 }
export const contentType = 'image/svg+xml'

export default function Icon() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="5" fill="#0f172a"/>
      <rect x="7" y="19" width="5" height="8" rx="2.5" fill="#22c55e"/>
      <rect x="14" y="14" width="5" height="13" rx="2.5" fill="#22c55e"/>
      <rect x="21" y="8" width="5" height="19" rx="2.5" fill="#22c55e"/>
    </svg>`,
    {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    }
  )
}
