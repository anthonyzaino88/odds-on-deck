# Offline research studies

These paths are **research only**. They do not enable the public NFL board, call The Odds API, write production Supabase, regrade picks, or merge.

Public NFL sides and totals stay off (`eligibleForPublic = false`) until Anthony explicitly enables them after a reviewed out-of-sample study. See `docs/nfl-selection-model.md`.

## nflverse / Lee Sharpe games study

Free historical file: [nflverse `games.csv`](https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv) (Lee Sharpe / nflverse).

The script downloads that CSV **or** reads a local path, filters regular season (playoffs optional), walks season-to-date records with no future leakage, fits an empirical game-total distribution, and scores a shrinkage moneyline baseline against nflverse **closing** moneylines.

```bash
# Local file — no network (preferred for CI / air-gapped runs)
node scripts/research/nflverse-games-study.js --input /path/to/games.csv

# Embedded fixture used by Jest
node scripts/research/nflverse-games-study.js \
  --input scripts/research/fixtures/nflverse-games-snippet.csv \
  --report /tmp/nflverse-fixture-report.md

# Optional download of the public nflverse file (not The Odds API)
node scripts/research/nflverse-games-study.js --cache /tmp/nflverse-games.csv

# Include playoffs
node scripts/research/nflverse-games-study.js --input /path/to/games.csv --include-playoffs
```

npm alias:

```bash
npm run research:nflverse -- --input /path/to/games.csv
```

Default report: `docs/research/nflverse-games-study.md`.

### What it computes

- Sample sizes by season (scheduled, completed, closing ML, evaluable ML, total lines, ties)
- Empirical Normal(\(\mu, \sigma^2\)) of completed game totals, plus KS / histogram / integer-line push diagnostics — **labeled empirical from nflverse, not production-validated for betting**
- Chronological totals OOS: fit on seasons \(< S\), score season \(S\)
- Season-to-date win% + production shrinkage / HFA vs nflverse closing moneylines: log-loss, Brier, and a defined 1-unit flat-stake ROI

### What it does not do

- Does not set `eligibleForPublic`
- Does not call The Odds API or burn quota
- Does not write Supabase / Prisma
- Does not regrade production picks
- Does not inject the totals fit into live `calculateNFLSelection` (production totals stay `missing_validated_scoring_distribution`)

Ask before adding any paid data feed.

## Cross-book NFL sides (Plan B)

Model-free moneyline / totals price gap that mirrors props:

`price_gap = (consensus_fair − best_implied) / consensus_fair`

```bash
node scripts/research/nfl-cross-book-sides.js --fixture
npm run research:nfl-cross-book -- --fixture
```

Design: `docs/research/nfl-cross-book-sides.md`. Does not call The Odds API. `eligibleForPublic` stays false.

## Historical CLV pilot (budgeted Odds API)

2024 REG weekly slate snapshots (`us` + `h2h,totals` = 20 credits each). Hard cap **3000**. Default is dry-run.

```bash
node scripts/research/nfl-historical-clv-pilot.js --dry-run
node scripts/research/nfl-historical-clv-pilot.js --fixture
ODDS_API_KEY=your_key node scripts/research/nfl-historical-clv-pilot.js --live --nflverse /path/to/games.csv
```

Design: `docs/research/nfl-historical-clv-pilot.md`. Last run: `docs/research/nfl-historical-clv-pilot-run.md`. Raw pulls stay under `scripts/research/out/` (gitignored). Do not invent results if the key is missing.

### CI

`npm test` runs `__tests__/research/nflverse-games-study.test.js` against `scripts/research/fixtures/nflverse-games-snippet.csv`. That test does not use the network.

## Pass 2: richer free features

Second chronological pass on the same nflverse file. Adds season point differential, rest, division, roof/weather (when present), an optional **market blend** (uses the close; not an independent edge), and a season-to-date PPG totals model with prior-season σ.

```bash
node scripts/research/nflverse-rich-features-study.js --input /path/to/games.csv
npm run research:nflverse:rich -- --input /path/to/games.csv
```

Fixture (no network): `scripts/research/fixtures/nflverse-games-rich-snippet.csv`  
Report: `docs/research/nflverse-rich-features-study.md`

Fitted coefficients for season S use only seasons before S. The pre-registered stake is **1 unit on +EV at the close**. Do not claim a beat unless log-loss **and** Brier beat the de-vig close **and** that +EV ROI is positive. Public NFL selections stay off. Ask before enabling live ML/totals.
