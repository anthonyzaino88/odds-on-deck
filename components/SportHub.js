import Link from 'next/link'
import { getTodaysGames } from '../lib/todays-games.js'
import { getTopProps } from '../lib/top-props.js'
import { getQualityTier } from '../lib/quality-score.js'
import { cn } from '../lib/utils'
import { SportBadge, SPORT_CONFIG, QualityChip, BookBadge } from './ui'

const SPORTS = ['mlb', 'nfl', 'nhl']

export const HUB_COPY = {
  mlb: {
    heading: 'MLB Player Props & Odds Today',
    lede: "Today's MLB slate with current lines and ranked player props from the live market. Informational only — not betting advice.",
    gamesLabel: 'Games Today',
    emptyGames: 'No MLB games on today\'s slate.',
  },
  nfl: {
    heading: 'NFL Player Props & Odds This Week',
    lede: "This week's NFL slate (Thursday through Monday) with current lines and ranked player props. Informational only — not betting advice.",
    gamesLabel: 'Games This Week',
    emptyGames: 'No NFL games on this week\'s slate.',
  },
  nhl: {
    heading: 'NHL Player Props & Odds Today',
    lede: "Today's NHL slate with current lines and ranked player props from the live market. Informational only — not betting advice.",
    gamesLabel: 'Games Today',
    emptyGames: 'No NHL games on today\'s slate. The regular season is out until the fall.',
  },
}

function gameLabel(game) {
  const away = game.away?.abbr || game.away?.name || 'Away'
  const home = game.home?.abbr || game.home?.name || 'Home'
  return `${away} @ ${home}`
}

function parseGameDate(raw) {
  if (!raw) return null
  const dateStr = raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? null : d
}

function gameTimeLabel(game, sport) {
  const d = parseGameDate(game.date)
  if (!d) return ''
  const opts = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }
  if (sport === 'nfl') opts.weekday = 'short'
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

function formatAmerican(decimalOdds) {
  if (decimalOdds == null) return null
  const d = parseFloat(decimalOdds)
  if (!Number.isFinite(d) || d <= 1) return null
  if (d >= 2) return `+${Math.round((d - 1) * 100)}`
  return `${Math.round(-100 / (d - 1))}`
}

function formatPropType(type) {
  return String(type || '').replace(/_/g, ' ')
}

export default async function SportHub({ sport }) {
  const copy = HUB_COPY[sport]
  const cfg = SPORT_CONFIG[sport]

  let games = []
  let props = []

  try {
    const [gamesResult, topProps] = await Promise.all([
      getTodaysGames(),
      getTopProps(sport, { limit: 10 }),
    ])
    if (gamesResult?.success && gamesResult.data) {
      games = gamesResult.data[sport] || []
    }
    props = topProps || []
  } catch {
    games = []
    props = []
  }

  return (
    <div className="pb-8">
      <nav className="flex items-center gap-0.5 bg-surface border border-white/[0.06] rounded-[4px] p-0.5 w-fit mb-6">
        {SPORTS.map((s) => {
          const active = s === sport
          const sCfg = SPORT_CONFIG[s]
          return (
            <Link
              key={s}
              href={`/${s}`}
              className={cn(
                'px-2.5 py-1 rounded-[3px] text-[11px] font-semibold uppercase tracking-wide transition-colors',
                active ? `${sCfg.text} bg-white/[0.06]` : 'text-slate-500 hover:text-slate-200',
              )}
            >
              {sCfg.label}
            </Link>
          )
        })}
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <SportBadge sport={sport} />
          <h1 className="text-xl font-semibold text-slate-100 tracking-tight">
            {copy.heading}
          </h1>
        </div>
        <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
          {copy.lede}
        </p>
      </header>

      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
            {copy.gamesLabel}
          </h2>
          <div className="flex-1 h-px bg-white/[0.04]" />
          <span className={`text-[11px] tabular-nums font-mono ${cfg.text}`}>
            {games.length}
          </span>
        </div>

        <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4">
          {games.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {games.map((game) => {
                const time = gameTimeLabel(game, sport)
                return (
                  <li key={game.id}>
                    <Link
                      href={`/game/${game.id}`}
                      className="inline-flex items-center px-2 py-1 rounded-[3px] text-xs font-medium text-slate-200 bg-bg border border-white/[0.06] hover:bg-elevated hover:border-white/[0.10] transition-colors duration-100 tabular-nums font-mono"
                    >
                      {gameLabel(game)}
                      {time ? <span className="text-slate-500 ml-1.5">{time}</span> : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-xs text-slate-600">{copy.emptyGames}</p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
            Top props
          </h2>
          <div className="flex-1 h-px bg-white/[0.04]" />
          <span className="text-[11px] text-slate-600 tabular-nums font-mono">
            {props.length}
          </span>
        </div>

        {props.length > 0 ? (
          <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.08]">
            {props.map((prop) => {
              const odds = formatAmerican(prop.odds)
              const tier = getQualityTier(prop.qualityScore || 0)
              return (
                <Link
                  key={prop.propId || `${prop.playerName}-${prop.type}-${prop.gameId}`}
                  href={prop.gameId ? `/game/${prop.gameId}` : `/props?sport=${sport}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 bg-surface hover:bg-elevated transition-colors duration-100"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {prop.playerName}
                      </span>
                      {prop.team ? (
                        <span className="text-[11px] text-slate-500 tabular-nums font-mono shrink-0">
                          {prop.team}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide truncate">
                      {prop.pick} {prop.threshold} {formatPropType(prop.type)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {odds ? (
                      <span className="text-[13px] font-medium text-slate-100 tabular-nums font-mono">
                        {odds}
                      </span>
                    ) : null}
                    <BookBadge book={prop.bookmaker} />
                    <QualityChip score={prop.qualityScore} tier={tier.tier} />
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4">
            <p className="text-xs text-slate-600">
              No live {cfg.label} props right now.{' '}
              <Link
                href={`/props?sport=${sport}`}
                className="text-slate-400 hover:text-slate-100 transition-colors"
              >
                All {cfg.label} props &rarr;
              </Link>
            </p>
          </div>
        )}
      </section>

      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/games"
          className="inline-flex items-center text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors"
        >
          Full slate &rarr;
        </Link>
        <Link
          href={`/props?sport=${sport}`}
          className="inline-flex items-center text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors"
        >
          All {cfg.label} props &rarr;
        </Link>
        <Link
          href="/picks"
          className="inline-flex items-center text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors"
        >
          Editor&apos;s Picks &rarr;
        </Link>
      </nav>
    </div>
  )
}
