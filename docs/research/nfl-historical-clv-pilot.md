# NFL historical CLV pilot (research only)

**Not a public-board switch. `eligibleForPublic` stays false.**

Budgeted The Odds API historical pull for 2024 regular-season moneyline and totals, plus the model-free cross-book price gap. This is the design doc. The last CLI run writes `docs/research/nfl-historical-clv-pilot-run.md`. It does **not** write production Supabase, regrade picks, merge, or enable live NFL sides.

| Constraint | Value |
| --- | --- |
| `eligibleForPublic` | `false` |
| Production DB writes | `false` |
| Regrade picks | `false` |
| Merge | `false` |
| Hard credit cap | `3000` |

## Pilot design (pre-registered)

### API shape

| Item | Value |
| --- | --- |
| Sport | `americanfootball_nfl` |
| Region | `us` only |
| Markets | `h2h,totals` |
| Endpoint | `GET /v4/historical/sports/americanfootball_nfl/odds` |
| Cost | **20 credits per snapshot** (10 × 1 region × 2 markets) |
| Odds format | American |
| Max snapshots | `floor(3000/20) = 150`, plan **≤ 140**, default **36** |

Weekly **slate** snapshots, not per-event historical odds. One call covers every upcoming game on the board at that timestamp.

### Timestamps (2024 REG, weeks 1–18)

Week 1 Sunday = `2024-09-08`. Each week:

| Phase | Clock | Purpose |
| --- | --- | --- |
| `early` | Tuesday `18:00:00Z` | After MNF, before TNF — full week slate |
| `late` | Sunday `16:55:00Z` (12:55 PM ET) | Near the main Sunday kickoff / close |

Thursday and Saturday games often **disappear** from the Sunday slate (the historical odds endpoint returns live/upcoming events). Those games contribute early quotes only. That is expected, not a bug.

Expected spend at the default 36 snapshots: **720 credits**, well under 3000.

### Credit guard (hard stop)

`lib/research/odds-api-credit-guard.js`:

- Refuse any `hardCap` above 3000.
- Before every call: abort if `spent + expectedCost > cap` or `expectedCost > remaining`.
- After every call: record `x-requests-last`, `x-requests-remaining`, `x-requests-used`.
- A free `GET /v4/sports` probe runs first on `--live` to read remaining credits.
- `--live` is required to spend. Default is `--dry-run`.
- Resume skips raw files already on disk (0 extra credits).

### Outcomes

Odds API historical **scores** would cost more credits. Outcomes are joined from a **local** nflverse / Lee Sharpe `games.csv` via `--nflverse` (free). No join → CLV still computes; ROI is `n/a`.

### Pre-registered rule S1

Stake **1 unit** on the early best-book side when:

- `price_gap >= 0.03` (relative formula in `docs/research/nfl-cross-book-sides.md`)
- `numBooks >= 3`
- the event/market/side also has a late snapshot (so CLV is defined)

Profit: win = `decimalOdds − 1`, loss = `−1`, push (tie or exact total) = `0`.  
ROI = total profit / n.

CLV (price, not outcome):

```
clv = (late_consensus_fair − early_best_implied) / late_consensus_fair
```

Gap persistence: among paired sides with early `price_gap > 0`, the fraction still positive at the late snapshot.

Do not retune 3% / 3 books after seeing results.

## Commands

```bash
# Plan only — 0 credits
node scripts/research/nfl-historical-clv-pilot.js --dry-run

# Bundled fixture — 0 credits, no key
node scripts/research/nfl-historical-clv-pilot.js --fixture

# Optional outcomes from a local nflverse file
node scripts/research/nfl-historical-clv-pilot.js --fixture \
  --nflverse scripts/research/fixtures/nfl-historical-clv-nflverse.csv

# Live pull (Anthony / agent VM). HARD STOP at 3000.
# Writes raw JSON + tidy CSV under scripts/research/out/ (gitignored).
ODDS_API_KEY=your_key node scripts/research/nfl-historical-clv-pilot.js --live \
  --nflverse /path/to/games.csv

# Smaller live smoke (still guarded)
ODDS_API_KEY=your_key node scripts/research/nfl-historical-clv-pilot.js --live \
  --weeks 1 --max-snapshots 2 --max-credits 60
```

npm aliases:

```bash
npm run research:nfl-clv -- --dry-run
npm run research:nfl-clv -- --fixture
```

If `ODDS_API_KEY` is missing, `--live` exits without inventing metrics.

## Outputs

| Path | What |
| --- | --- |
| `docs/research/nfl-historical-clv-pilot.md` | This design doc |
| `docs/research/nfl-historical-clv-pilot-run.md` | Last dry-run / fixture / live report |
| `scripts/research/out/nfl-historical-clv-pilot/plan.json` | Snapshot schedule + expected cost |
| `scripts/research/out/nfl-historical-clv-pilot/raw/*.json` | Raw Odds API bodies (local only) |
| `scripts/research/out/nfl-historical-clv-pilot/quotes.csv` | Tidy book-level quotes |
| `scripts/research/out/nfl-historical-clv-pilot/sides.csv` | Consensus / best / gap per side |
| `scripts/research/out/nfl-historical-clv-pilot/pairs.csv` | Early vs late + CLV |
| `scripts/research/out/nfl-historical-clv-pilot/credit-guard.json` | Spend ledger |

## Credit spend

Record honest header totals from `--live` in the run report. If the key is missing or historical odds are not on the plan, spent is 0 — do not invent CLV.

| Field | Value |
| --- | --- |
| Planned snapshots | `36` |
| Planned cost | `720` |
| Hard cap | `3000` |
| Agent VM `--live` (2026-09-10) | Key present. `GET /v4/sports` remaining **500**. Historical `h2h,totals` **401** `HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`. **Spent 0.** |

## Recommendation

**Stay dark.** This pilot measures whether early cross-book gaps have closing-line value. It is not permission to flip `eligibleForPublic`. Continue only if a live pull finishes under the cap with an honest n; ask before enabling public NFL ML/totals.

## Tests

`__tests__/research/odds-api-credit-guard.test.js` — mock fetch, abort before exceeding the cap.  
`__tests__/research/nfl-historical-clv-pilot.test.js` — fixture CLV / S1 / dry-run.  
No production jobs.
