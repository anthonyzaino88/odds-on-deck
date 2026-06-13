import './globals.css'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import MobileNav from '../components/MobileNav'
import { OddsOnDeckLogo } from '../components/ui/OddsOnDeckLogo'
import { Analytics } from '@vercel/analytics/next'

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
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Sports Betting Analytics & Edge Detection`,
    description: SITE_DESCRIPTION,
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
  verification: {
    google: 'lG8-qnKGoesueHq70F1ub-di_QFBUF1aRHgL8i92TrY',
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

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/picks', label: "Editor's Picks" },
  { href: '/props', label: 'Player Props' },
  { href: '/games', label: "Today's Slate" },
  { href: '/parlays', label: 'Parlays' },
  { href: '/validation', label: 'Validation' },
  { href: '/insights', label: 'Insights' },
]

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-J6RZED32JY" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-J6RZED32JY');`,
          }}
        />
      </head>
      <body className="bg-bg text-slate-100 min-h-screen pb-20 sm:pb-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-bg/80 backdrop-blur-md">
          <div className="max-w-screen-xl mx-auto px-4 md:px-6">
            <div className="flex items-center gap-6 h-12">
              <a href="/" className="flex items-center shrink-0">
                <OddsOnDeckLogo size="sm" />
              </a>
              <div className="hidden sm:flex items-center gap-1">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="px-2.5 py-1.5 text-[12px] font-medium text-slate-400 hover:text-slate-100 transition-colors duration-100"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-screen-xl mx-auto px-4 md:px-6 pt-4 pb-8 sm:pt-6">
          {children}
        </main>
        <footer className="border-t border-white/[0.06] mt-8">
          <div className="max-w-screen-xl mx-auto px-4 md:px-6 py-6 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
              <OddsOnDeckLogo size="sm" />
              <a href="/privacy" className="text-slate-400 hover:text-slate-100 transition-colors duration-100">Privacy</a>
              <a href="/terms" className="text-slate-400 hover:text-slate-100 transition-colors duration-100">Terms &amp; Disclaimer</a>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-3xl">
              For entertainment and informational purposes only. Not betting or financial advice.
              Projections are estimates and may be inaccurate. You must be of legal age to gamble in
              your jurisdiction (18+/21+). If you have a gambling problem, call 1-800-GAMBLER.
            </p>
          </div>
        </footer>
        <MobileNav />
        <Analytics />
      </body>
    </html>
  )
}

