import './globals.css'
import DemoBanner from '../components/DemoBanner'
import MobileNav from '../components/MobileNav'

export const metadata = {
  title: 'Odds on Deck - MLB Matchup Analytics',
  description: 'Advanced MLB matchup analytics and betting insights',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white min-h-screen pb-20 sm:pb-0">
        <DemoBanner />
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
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <MobileNav />
      </body>
    </html>
  )
}

