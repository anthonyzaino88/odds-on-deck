import Link from 'next/link'
import HomeClient from './HomeClient'
import { getTodaysGames } from '../lib/todays-games.js'
import { SportBadge, SPORT_CONFIG } from '../components/ui'

const SITE_URL = 'https://oddsondeck.com'

export const metadata = {
  alternates: {
    canonical: SITE_URL,
  },
}

export const dynamic = 'force-dynamic'

const SPORT_ORDER = ['mlb', 'nfl', 'nhl']
const SPORT_SUB = { mlb: 'Games Today', nfl: 'Games This Week', nhl: 'Games Today' }

function gameLabel(game) {
  const away = game.away?.abbr || game.away?.name || 'Away'
  const home = game.home?.abbr || game.home?.name || 'Home'
  return `${away} @ ${home}`
}

export default async function HomePage() {
  let games = { mlb: [], nfl: [], nhl: [] }
  try {
    const result = await getTodaysGames()
    if (result.success && result.data) {
      games = {
        mlb: result.data.mlb || [],
        nfl: result.data.nfl || [],
        nhl: result.data.nhl || [],
      }
    }
  } catch {
    // Teaser is optional; HomeClient still loads the live widgets
  }

  const total = SPORT_ORDER.reduce((sum, sport) => sum + (games[sport]?.length || 0), 0)

  return (
    <>
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
            Today&apos;s Matchups
          </h2>
          <div className="flex-1 h-px bg-white/[0.04]" />
          <span className="text-[11px] text-slate-600 tabular-nums font-mono">
            {total} games
          </span>
        </div>

        <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 space-y-4">
          {SPORT_ORDER.map((sport) => {
            const list = games[sport] || []
            const cfg = SPORT_CONFIG[sport]
            return (
              <div key={sport}>
                <div className="flex items-center gap-2 mb-2">
                  <SportBadge sport={sport} />
                  <p className="text-xs text-slate-500">
                    <span className={`font-semibold tabular-nums font-mono ${cfg.text}`}>{list.length}</span>
                    {' '}{SPORT_SUB[sport]}
                  </p>
                </div>
                {list.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {list.map((game) => (
                      <li key={game.id}>
                        <Link
                          href={`/game/${game.id}`}
                          className="inline-flex items-center px-2 py-1 rounded-[3px] text-xs font-medium text-slate-200 bg-bg border border-white/[0.06] hover:bg-elevated hover:border-white/[0.10] transition-colors duration-100 tabular-nums font-mono"
                        >
                          {gameLabel(game)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-600">No {cfg.label} games on the slate.</p>
                )}
              </div>
            )
          })}
          <Link
            href="/games"
            className="inline-flex items-center text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors"
          >
            Full slate &rarr;
          </Link>
        </div>
      </section>

      <HomeClient />
    </>
  )
}