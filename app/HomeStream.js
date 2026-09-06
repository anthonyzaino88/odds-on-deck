import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import PublishedProofStrip from '../components/PublishedProofStrip'
import TodaysBoard from '../components/TodaysBoard'
import { getTodaysGames } from '../lib/todays-games.js'
import { getHomepageBoard, getHomepageProofStats } from '../lib/homepage-hook.js'
import { SportBadge, SPORT_CONFIG } from '../components/ui'

const SPORT_ORDER = ['mlb', 'nfl', 'nhl']
const SPORT_SUB = { mlb: 'Games Today', nfl: 'Games This Week', nhl: 'Games Today' }

function gameLabel(game) {
  const away = game.away?.abbr || game.away?.name || 'Away'
  const home = game.home?.abbr || game.home?.name || 'Home'
  return `${away} @ ${home}`
}

function emptyGames() {
  return { mlb: [], nfl: [], nhl: [] }
}

const getCachedTodaysGames = unstable_cache(
  async () => getTodaysGames().catch(() => null),
  ['homepage-todays-games'],
  { revalidate: 60 },
)

export async function HomeProof() {
  const proof = await getHomepageProofStats()
  return (
    <PublishedProofStrip
      stats={proof?.stats || null}
      yesterday={proof?.yesterday || null}
    />
  )
}

export async function HomeBoard() {
  const board = await getHomepageBoard()
  return <TodaysBoard board={board} />
}

export async function HomeMatchups() {
  const gamesResult = await getCachedTodaysGames()
  const games = gamesResult?.success && gamesResult.data
    ? {
        mlb: gamesResult.data.mlb || [],
        nfl: gamesResult.data.nfl || [],
        nhl: gamesResult.data.nhl || [],
      }
    : emptyGames()

  const total = SPORT_ORDER.reduce((sum, sport) => sum + (games[sport]?.length || 0), 0)

  return (
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
              <Link href={`/${sport}`} className="flex items-center gap-2 mb-2 w-fit group">
                <SportBadge sport={sport} />
                <p className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
                  <span className={`font-semibold tabular-nums font-mono ${cfg.text}`}>{list.length}</span>
                  {' '}{SPORT_SUB[sport]}
                </p>
              </Link>
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
  )
}

export function ProofStripSkeleton() {
  return (
    <section className="mb-8 sm:mb-10" aria-hidden="true">
      <div className="rounded-[4px] border border-white/[0.08] bg-surface overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3">
          <div className="h-3 w-28 bg-elevated rounded-[3px]" />
          <div className="h-3 w-56 bg-elevated/60 rounded-[3px] mt-2" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.06] border-t border-white/[0.06]">
          {['roi', 'units', 'sample', 'odds'].map((key) => (
            <div key={key} className="bg-bg px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="h-3 w-12 bg-elevated/60 rounded-[3px]" />
              <div className="h-7 w-20 bg-elevated rounded-[3px] mt-2" />
            </div>
          ))}
        </div>
        <div className="px-4 sm:px-5 py-3">
          <div className="h-3 w-48 bg-elevated/50 rounded-[3px]" />
        </div>
      </div>
    </section>
  )
}

export function BoardSkeleton() {
  return (
    <section id="todays-board" className="mb-8 sm:mb-10 scroll-mt-16" aria-hidden="true">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-3 w-24 bg-elevated rounded-[3px]" />
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
        {[1, 2, 3, 4, 5].map((key) => (
          <div key={key} className="bg-surface px-3 py-2.5 sm:px-4">
            <div className="h-4 w-40 bg-elevated rounded-[3px]" />
            <div className="h-3 w-28 bg-elevated/60 rounded-[3px] mt-2" />
          </div>
        ))}
      </div>
    </section>
  )
}

export function MatchupsSkeleton() {
  return (
    <section className="mb-8" aria-hidden="true">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-3 w-32 bg-elevated rounded-[3px]" />
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 space-y-4">
        {['mlb', 'nfl', 'nhl'].map((sport) => (
          <div key={sport}>
            <div className="h-4 w-36 bg-elevated rounded-[3px] mb-2" />
            <div className="flex flex-wrap gap-1.5">
              <div className="h-7 w-24 bg-bg border border-white/[0.06] rounded-[3px]" />
              <div className="h-7 w-20 bg-bg border border-white/[0.06] rounded-[3px]" />
              <div className="h-7 w-28 bg-bg border border-white/[0.06] rounded-[3px]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
