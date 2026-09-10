# NFL historical CLV pilot (research only)

**Not a public-board switch. `eligibleForPublic` stays false.**

This artifact is a budgeted Odds API historical pull plus a model-free cross-book price-gap evaluator. It does **not** write production Supabase, regrade picks, merge, or enable live NFL moneyline / totals.

| Constraint | Value |
| --- | --- |
| `eligibleForPublic` | `false` |
| Production DB writes | `false` |
| Regrade picks | `false` |
| Merge | `false` |
| Hard credit cap | `3000` |
| Mode | `live` |

Generated at: `2026-09-10T02:40:51.171Z`

## Credit spend

| Field | Value |
| --- | --- |
| Spent | `0` |
| Remaining (API) | `500` |
| Hard cap | `3000` |
| Calls | `2` |
| Aborted | `false` |
| Abort reason | none |
| Planned snapshots | `2` |
| Planned cost | `40` |

If mode is `dry-run` or `fixture`, spent is 0 and no Odds API historical credits were used.

## Live attempt

ODDS_API_KEY was present. `GET /v4/sports` succeeded (0 credits). Remaining credits: **500**.

Historical odds returned **401** `HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`.
The usage quota was **not** charged (`x-requests-last` = 0). No further snapshots were requested.

**Credit spend: 0.** CLV / S1 metrics below are empty on purpose — not invented.
Re-run `--live` locally on a paid Odds API plan. Fixture math is in `__tests__/research/nfl-historical-clv-pilot.test.js`.


## Pre-registered rule S1

1 unit on the early best-book side when price_gap >= 3% and numBooks >= 3, graded vs nflverse result, using early best decimal odds.

- Minimum relative price gap: **0.03**
- Minimum books: **3**
- Stake: **1 unit**
- Profit: win = decimalOdds - 1; loss = -1; push = 0

Do not retune the threshold after seeing results. This is not a predictive model.

## Sample

| Count | n |
| --- | --- |
| Snapshots evaluated | 0 |
| Quote rows | 0 |
| Side rows | 0 |
| Paired early/late sides | 0 |
| Early-only sides (no Sunday close) | 0 |
| S1 selections | 0 |
| S1 graded vs nflverse | 0 |
| Rows joined to nflverse | 0 |

## CLV (early best price vs closing fair)

CLV relative = `(late_consensus_fair − early_best_implied) / late_consensus_fair`. Same shape as the prop price-gap formula, with the close standing in for consensus.

| Set | n | Mean CLV (relative) | Mean CLV (pp) |
| --- | --- | --- | --- |
| All paired sides | 0 | n/a | n/a |
| Rule S1 | 0 | n/a | n/a |

## Rule S1 ROI

| Metric | Value |
| --- | --- |
| n | 0 |
| Wins | 0 |
| Losses | 0 |
| Pushes | 0 |
| Profit (units) | 0.000 |
| ROI | n/a |

## Cross-book gap persistence

Among paired sides whose **early** price gap was positive, the fraction that were still positive at the late snapshot.

| Metric | Value |
| --- | --- |
| Early +gap sides | 0 |
| Still +gap at close | 0 |
| Persistence fraction | n/a |
| Mean gap change (late − early) | n/a |

## What this is not

- Not a public NFL board enable.
- Not a claim that price gaps are +EV.
- Not the nfl-selection-v1.0.1 model (that path stays dark and separate).
- Not MLB / NHL / props production behavior.

Ask before enabling live ML/totals. Stay dark unless an independent candidate honestly beats the close on a pre-registered rule with a real sample.

## How this run was produced

```bash
# 0 credits
node scripts/research/nfl-historical-clv-pilot.js --dry-run
node scripts/research/nfl-historical-clv-pilot.js --fixture

# Live (hard cap 3000)
ODDS_API_KEY=your_key node scripts/research/nfl-historical-clv-pilot.js --live --nflverse /path/to/games.csv
```

Early = Tuesday 18:00 UTC; late = Sunday 16:55 UTC. Region `us`, markets `h2h,totals`, 20 credits per slate snapshot. See `docs/research/nfl-cross-book-sides.md` for the price-gap formula.
