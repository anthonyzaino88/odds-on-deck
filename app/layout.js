import './globals.css'
import MobileNav from '../components/MobileNav'

const SITE_URL = 'https://oddsondeck.com'
const SITE_NAME = 'Odds on Deck'
const SITE_DESCRIPTION = 'Data-driven sports betting analytics for MLB, NFL & NHL. Real-time odds tracking, player prop rankings, edge detection, parlay generator, and transparent validation — all powered by math, not gut feelings.'

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Sports Betting Analytics & Edge Detection`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'sports betting analytics', 'player props', 'MLB betting', 'NFL betting', 'NHL betting',
    'betting edge', 'odds comparison', 'parlay generator', 'DFS optimizer',
    'implied probability', 'sports betting tools', 'prop betting', 'betting validation',
    'real-time odds', 'line shopping', 'sports analytics',
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Sports Betting Analytics & Edge Detection`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — Data-driven sports betting analytics`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Sports Betting Analytics & Edge Detection`,
    description: SITE_DESCRIPTION,
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
  alternates: {
    canonical: SITE_URL,
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#020617',
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-J6RZED32JY" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-J6RZED32JY');`,
          }}
        />
      </head>
      <body className="bg-slate-950 text-white min-h-screen pb-20 sm:pb-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <nav className="bg-slate-900 shadow-lg border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-8">
                <h1 className="text-xl font-bold text-white">
                  ⚾ Odds on Deck
                </h1>
                <div className="hidden sm:flex space-x-8">
                  <a
                    href="/"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    Home
                  </a>
                  <a
                    href="/picks"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    Editor's Picks
                  </a>
                  <a
                    href="/props"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    Player Props
                  </a>
                  <a
                    href="/games"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    Today's Slate
                  </a>
                  <a
                    href="/parlays"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    Parlay Generator
                  </a>
                  <a
                    href="/dfs"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    DFS
                  </a>
                  <a
                    href="/validation"
                    className="text-slate-300 hover:text-white px-3 py-2 text-sm font-medium transition"
                  >
                    📊 Validation
                  </a>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8 sm:py-8">
          {children}
        </main>
        <MobileNav />
      </body>
    </html>
  )
}

