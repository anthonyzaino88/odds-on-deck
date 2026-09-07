const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../..')
const ogImagePath = path.join(root, 'public/og-image.png')
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const METADATA_FILES = [
  'app/layout.js',
  'app/page.js',
  'app/picks/layout.js',
  'app/props/layout.js',
  'app/games/layout.js',
  'app/parlays/layout.js',
  'app/insights/page.js',
  'app/dfs/page.js',
  'app/validation/page.js',
]

describe('Open Graph / Twitter card image', () => {
  test('public/og-image.png is a non-empty PNG', () => {
    expect(fs.existsSync(ogImagePath)).toBe(true)
    const bytes = fs.readFileSync(ogImagePath)
    expect(bytes.length).toBeGreaterThan(10_000)
    expect(bytes.subarray(0, 8).equals(pngSignature)).toBe(true)
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    expect(width).toBeGreaterThanOrEqual(1200)
    expect(height).toBeGreaterThanOrEqual(630)
  })

  test('does not register a Next.js ImageResponse opengraph-image route', () => {
    expect(fs.existsSync(path.join(root, 'app/opengraph-image.js'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app/opengraph-image.jsx'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app/opengraph-image.ts'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app/opengraph-image.tsx'))).toBe(false)
  })

  test('route metadata points at the static public OG image', () => {
    for (const rel of METADATA_FILES) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src).toMatch(/OG_IMAGE/)
      expect(src).toMatch(/images:\s*\[OG_IMAGE\]/)
    }
  })

  test('homepage twitter title matches the public-track-record value prop', () => {
    const src = fs.readFileSync(path.join(root, 'app/page.js'), 'utf8')
    expect(src).toMatch(/twitter:\s*\{/)
    expect(src).toMatch(/Sports props with a public track record \| Odds on Deck/)
    expect(src).not.toMatch(/Sports Betting Analytics & Edge Detection/)
  })
})
