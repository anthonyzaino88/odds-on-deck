export const SITE_URL = 'https://oddsondeck.com'
export const SITE_NAME = 'Odds on Deck'

// Static public asset — crawlers (X/Twitter especially) need real PNG bytes.
// The former app/opengraph-image.js ImageResponse route returned HTTP 200
// with Content-Type image/png and a 0-byte body.
export const OG_IMAGE = {
  url: '/og-image.png',
  width: 1376,
  height: 768,
  alt: 'Odds on Deck — Data-Driven Sports Betting Analytics',
  type: 'image/png',
}
