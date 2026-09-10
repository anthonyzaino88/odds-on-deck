# NFL moneyline and totals selection model

Status: **unvalidated research heuristic**. Public NFL sides and totals stay disabled.

Model version: `nfl-selection-v1.0.1`  
Legacy heuristic (do not present as this model): `nfl-nhl-v0.1.0`

## What this model uses

Moneyline research path (only when data eligibility passes):

- Season win-loss record. The Team column `last10Record` is a **season** record from ESPN, not a last-10 window.
- `gamesPlayed`, `season`, `dataThrough`, and `statsCapturedAt`.
- The two-way moneyline quote captured at prediction time.

## What this model does not use

- Venue (home/away) records as a second strength factor (that was the double-count).
- Genuine last-10 game windows (those columns are season averages).
- Quarterbacks, injuries, weather, or efficiency metrics — those inputs do not exist here.
- Point differential (available on the Team row, unused until validated).
- A fitted home-field advantage or logistic scale.

## Eligibility

Missing, stale, mismatched, or insufficient data returns an unavailable result with an explicit reason. It does not emit a qualifying edge.

| Reason | Meaning |
| --- | --- |
| `missing_team_data` | No usable season record / games played |
| `missing_season` | Season id missing on a team or the game |
| `season_mismatch` | Team season ≠ game season |
| `unknown_data_freshness` | No `statsCapturedAt` (column exists; fetch writes it only on a full extract) |
| `stale_team_data` | Captured-at older than 7 days, in the future, or unparseable |
| `missing_data_through` | No data-through date |
| `invalid_data_through` | Data-through is not a real timestamp |
| `data_through_in_future` | Data-through is after evaluation time |
| `stale_data_through` | Data-through is older than 7 days relative to prediction time |
| `data_through_older_than_fetch_window` | A recent fetch timestamp cannot make older statistics current |
| `data_through_season_mismatch` | Data-through is outside the game's NFL season year |
| `early_season_insufficient_sample` | Either team has fewer than 4 season games |
| `missing_validated_scoring_distribution` | NFL totals have no fitted P(total) |
| `unvalidated_heuristic` | Research numbers may exist; public board stays empty |

Moneyline and totals are evaluated independently. Missing moneyline odds do not disable totals.

### Freshness policy

A statistic is eligible only when every check below passes. A later `statsCapturedAt` does **not** refresh an old `dataThrough`.

1. `dataThrough` and `statsCapturedAt` must parse as real timestamps. Invalid strings are rejected (`invalid_data_through` / `stale_team_data`), not ignored.
2. Neither timestamp may be after prediction time.
3. Both must be within 7 days of prediction time (`NFL_STATS_MAX_AGE_MS`). That window is operational, not a fitted parameter.
4. `dataThrough` must fall in the game's NFL season year, or January–February of the next calendar year (regular-season / playoff spillover).
5. If `statsCapturedAt − dataThrough` exceeds 7 days, the row is ineligible (`data_through_older_than_fetch_window`). Fetching yesterday cannot make last month's record current.

### Early-season policy

With n < 4 the maximum-likelihood win percentage lives on `{0, 1/3, 1/2, 2/3, 1}`. That is not a probability model, so we refuse a point estimate. Four games is a mathematical floor, not a slate-clearing sample and not a claim that n ≥ 4 is sufficient. Public recommendations stay off regardless of n because the heuristic is unvalidated.

## Moneyline formulas (research only)

Shrinkage toward 0.5 (safeguard, not a fitted prior):

```
p̂ = (wins + 8) / (games + 16)
```

Two-way home win probability (no estimated NFL tie mass; posted markets are two-way; regular-season ties push):

```
logit = log(p̂_home / (1 - p̂_home)) - log(p̂_away / (1 - p̂_away)) + 0.12
P(home) = 1 / (1 + exp(-logit))
P(away) = 1 - P(home)
P(tie)  = 0
```

`0.12` is a conventional ~53% home-field logit. It is **not** fitted in this repo. It is applied only after both teams clear the data gates, so missing data plus home-field advantage cannot manufacture a ~5.97pp edge.

De-vig: proportional, `lib/implied.js` `removeMlVig`.

Two-way posted markets are conditional on a decisive result. The model-versus-market gap therefore uses:

```
P(win | decisive) = P(win) / (1 − P(push))
gap = P(win | decisive) − fair two-way market
```

If `P(push) = 1`, the decisive mass is zero and the gap is unavailable (`zero_decisive_probability`). The gap is uncapped.

Estimated EV stays on the unconditional probabilities (a refunded push contributes 0):

```
EV = P(win) × (d − 1) − P(loss)
```

Display caps are UI-only and are never stored as the model estimate.

## Totals

A projected point total is not an over/under probability. Production does not supply a fitted scoring distribution, so NFL totals are ineligible (`missing_validated_scoring_distribution`).

The library can evaluate an **injected** Normal approximation (continuity-corrected onto integer scores) for tests:

- Integer line `L`: `P(push) = P(T = L)`
- Half-line: `P(push) = 0`
- `P(over) + P(under) + P(push) = 1`
- Raising the line cannot increase `P(over)`

Do not treat that helper as a validated NFL scoring model. No σ was estimated from historical games.

## Traceability

Each research evaluation carries model version, input snapshot, event, market, line, sportsbook, decimal/American odds, and timestamps. Public output must reuse that prediction and quote. A later Odds row is rejected.

`EdgeSnapshot` stores `edgeMl*` / `edgeTotal*` / `modelRun` plus pairing columns (`payload`, `oddsSnapshotId`, `inputSnapshotId`, `quotedAt`, `eligibleForPublic`). NFL writes `modelRun = nfl-selection-v1.0.1`, **null** edge floats, the selection payload, and the quote used at prediction time. `eligibleForPublic` stays false. Apply the SQL in `scripts/migrations/004_team_freshness_and_edge_traceability.sql` before relying on those columns in a database. See `docs/migrations/004_edge_snapshot_traceability.md`.

## Validation blockers

Read-only chronological studies live under `scripts/research/`:

1. Pass 1 (`nflverse-games-study.js`) — shrinkage moneyline baseline and an empirical totals distribution.
2. Pass 2 (`nflverse-rich-features-study.js`) — season point differential, rest, division, roof/weather, an optional market blend (uses the close), and season-to-date PPG totals with prior-season σ.
3. Plan B cross-book sides (`nfl-cross-book-sides.js`) — model-free price gap on NFL moneyline / totals using the same relative formula as props. Local JSON only.
4. Budgeted historical CLV pilot (`nfl-historical-clv-pilot.js`) — The Odds API historical slate snapshots with a **hard 3000-credit cap**. Research-local files only.

Passes 1–2 use free nflverse / Lee Sharpe `games.csv` and do not call The Odds API. Fitted coefficients use expanding prior seasons only. None of these paths write production Supabase, regrade picks, or merge.

Those studies report sample sizes, probability scores, and a pre-registered 1-unit +EV-at-close ROI. They do **not** flip `eligibleForPublic`. Do not enable live public ML/totals unless an independent candidate honestly beats the close on the pre-registered rule. Production totals still return `missing_validated_scoring_distribution` because study fits are not injected into live selection.

Do not invent additional calibration, CLV, or ROI. The historical CLV pilot is the Odds API book-quote path; nflverse closes remain a separate consensus history. Site-book closing-line comparison can also use the stored quote pairing after the 004 columns are applied.

Ask before adding paid data services. See `docs/research/README.md`.

## Recommendation

**Keep public NFL selections disabled** until:

1. Team freshness / season / data-through columns are applied in the target database and populated by a full ESPN extract (`statsDataThrough` still requires a last completed game in the ESPN payload).
2. A chronological out-of-sample evaluation reports sample size, calibration, probability score vs the market, and a defined staking rule.
3. Totals have a fitted or empirically validated mapping that handles NFL scoring variance and integer pushes.
