// Static SVG apple icon - avoids the @vercel/og Windows path bug
// with spaces in directory names

export const size = { width: 180, height: 180 }
export const contentType = 'image/svg+xml'

export default function AppleIcon() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" rx="29" fill="#0f172a"/>
      <rect x="31" y="108" width="31" height="45" rx="15.5" fill="#22c55e"/>
      <rect x="74" y="81" width="31" height="72" rx="15.5" fill="#22c55e"/>
      <rect x="118" y="54" width="31" height="99" rx="15.5" fill="#22c55e"/>
    </svg>`,
    {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    }
  )
}
