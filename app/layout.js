import './globals.css'
import DemoBanner from '../components/DemoBanner'

export const metadata = {
  title: 'Odds on Deck - MLB Matchup Analytics',
  description: 'Advanced MLB matchup analytics and betting insights',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <DemoBanner />
        <nav className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-8">
                <h1 className="text-xl font-bold text-gray-900">
                  ⚾ Odds on Deck
                </h1>
                <div className="hidden sm:flex space-x-8">
                  <a
                    href="/"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    Home
                  </a>
                  <a
                    href="/picks"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    Editor's Picks
                  </a>
                  <a
                    href="/props"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    Player Props
                  </a>
                  <a
                    href="/games"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    Today's Slate
                  </a>
                  <a
                    href="/parlays"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    Parlay Generator
                  </a>
                  <a
                    href="/dfs"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                  >
                    DFS
                  </a>
                  <a
                    href="/validation"
                    className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
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
      </body>
    </html>
  )
}

