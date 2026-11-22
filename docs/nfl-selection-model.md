# NFL moneyline, spread, and totals selection model

Status: **unvalidated research heuristic**. Public NFL sides, spreads, and totals stay disabled.

Current research model: `nfl-selection-v1.1.0`  
Previous heuristic (still scoreable, never public): `nfl-selection-v1.0.1`  
Legacy heuristic (do not present as this model): `nfl-nhl-v0.1.0`

Publish bars, lock time, and graduation: `docs/game-line-model-rules.md`.
Walk-forward: `node scripts/backtest-game-lines.js --summary`.

## What v1.1.0 uses

Moneyline / spread / totals research path (only when data eligibility passes):

- Season win-loss record. The Team column `last10Record` is a **season** record from ESPN, not a last-10 window.
- Season point differential from `avgPointsLast10` / `avgPointsAllowedLast10` (those columns are season PPG).
- `gamesPlayed`, `season`, `dataThrough`, and `statsCapturedAt`.
- One home-field logit (not venue W-L records).
- Pre-lock recent form, rest, and matchup history when rebuilt from finals whose result was written before pick-lock.
- Pre-lock ESPN injuries and starting QB names when their timestamps are ≤ lock (`scripts/fetch-injuries.js`).
- The two-way quote captured at prediction time. The model then **blends 35% of the model–market gap** and **clamps the rest to 8pp** (12pp only if a starting QB is out). That is what stops 25-point win-probability gaps.

Totals: season points-for/against as a Normal mean, unvalidated σ = 13.5, continuity-corrected onto integer scores, then the same blend/clamp toward the totals market.

Spreads: convert the blended win probability to an expected margin (same unvalidated σ) and score the posted home spread, then blend/clamp.

None of the blend, clamp, or σ values are fitted. They are safeguards. `eligibleForPublic` stays false.

## What this model does not use

- Venue (home/away) records as a second strength factor (that was the double-count).
- Treating `last10Record` as a genuine last-10 window.
- Weather, efficiency / EPA / DVOA.
- The closing line as an input (it is a score only).
- A fitted home-field, blend, or logistic scale.

## Eligibility

Missing, stale, mismatched, or insufficient data returns an unavailable result with an explicit reason. It does not emit a qualifying edge.

| Reason | Meaning |
| --- | --- |
| `missing_team_data` | No usable season record / games played |
| `missing_season` | Season id missing on a team or the game |
| `season_mismatch` | Team season ≠ game season |
| `unknown_data_freshness` | No `statsCapturedAt` (column exists; fetch writes it only on a full extract) |
| `stale_team_data` | ESPN fetch (`Team.statsCapturedAt`) older than 7 days, in the future, or unparseable |
| `missing_data_through` | No data-through date |
| `invalid_data_through` | Data-through is not a real timestamp |
| `data_through_in_future` | Data-through is after evaluation time |
| `stale_data_through` | v1.1.0 with a non-empty completed-game pool: a newer same-season FINAL exists that rebuilt stats missed. Empty pool / v1.0.1 / Team-row only: data-through older than 7 days |
| `data_through_older_than_fetch_window` | Team-row path only: a recent fetch timestamp cannot make older statistics current |
| `data_through_season_mismatch` | Data-through is outside the game's NFL season year |
| `early_season_insufficient_sample` | Either team has fewer than 4 season games |
| `missing_validated_scoring_distribution` | NFL totals have no fitted P(total) |
| `unvalidated_heuristic` | Research numbers may exist; public board stays empty |

Moneyline and totals are evaluated independently. Missing moneyline odds do not disable totals.

### Freshness policy

A statistic is eligible only when every check below passes. Fetch time and last-kickoff time are different clocks.

1. `dataThrough` and `statsCapturedAt` must parse as real timestamps. Invalid strings are rejected (`invalid_data_through` / `stale_team_data`), not ignored.
2. Neither timestamp may be after prediction time.
3. **Fetch freshness:** `Team.statsCapturedAt` (the ESPN refresh) must be within 7 days of prediction time (`NFL_STATS_MAX_AGE_MS`). v1.1.0 does not copy the last final's `Game.lastUpdate` onto this field.
4. `dataThrough` must fall in the game's NFL season year, or January–February of the next calendar year (regular-season / playoff spillover).
5. **Data-through freshness (v1.1.0):** when a non-empty completed-game pool is present, do not use wall-clock age of the last kickoff. A bye or Thursday rest (last final 10–14 days ago, no later final) is eligible. Rebuilt `dataThrough` is stale only if that pool has a newer same-season FINAL for that team that kicked off before the game being evaluated and is not included in the rebuilt stats. An empty pool is not a pool — fall back to the 7-day window. NFL kickoffs before 1 Sep UTC of the season year are preseason and are excluded from both the rebuild and this missing-final check (live and backtest share the rule). `hasMissingNewerFinal` must only receive a lock-filtered pool.
6. **Data-through freshness (v1.0.1 / no completed-game pool):** keep the 7-day window, including `statsCapturedAt − dataThrough` (`data_through_older_than_fetch_window`). Fetching yesterday cannot make last month's Team-row record current.
7. **Backtest fetch clock:** if live `Team.statsCapturedAt` is after the historical lock, the walk-forward uses the lock instant as the fetch time so old locks are not marked `stale_team_data`.

### Early-season policy

With n < 4 the maximum-likelihood win percentage lives on `{0, 1/3, 1/2, 2/3, 1}`. That is not a probability model, so we refuse a point estimate. Four games is a mathematical floor, not a slate-clearing sample and not a claim that n ≥ 4 is sufficient. Public recommendations stay off regardless of n because the heuristic is unvalidated. Preseason finals do not count toward that floor.

New NFL v1.1.0 shadow rows are tagged `features:regular-season-finals`. Existing v1.1.0 shadow picks scored on mixed preseason+regular records stay in a `pre-regular-season-filter` report group until a separate dry-run retag (`operations/preview-nfl-v110-pre-rs-filter.mjs`) is applied. This PR does not write those notes.

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

If `P(push) = 1`, the decisive mass is zero and the gap is unavailable (`zero_decisive_probability`). v1.0.1 left the gap uncapped. v1.1.0 blends 35% of the gap toward the market and clamps the rest to 8pp (12pp with a starting QB out).

Estimated EV stays on the unconditional probabilities (a refunded push contributes 0):

```
EV = P(win) × (d − 1) − P(loss)
```

Display caps are UI-only and are never stored as the model estimate.

## Totals

A projected point total is not an over/under probability. v1.1.0 builds a **research** Normal from season points-for/against (unvalidated σ = 13.5) when those averages pass the **same** lock-time freshness gates as moneyline. That path is still `eligibleForPublic=false`. Without scoring averages the reason remains `missing_validated_scoring_distribution`. A fitted or injected distribution does not skip season / captured-at / data-through / sample checks.

The library can also evaluate an **injected** Normal approximation (continuity-corrected onto integer scores) for tests:

- Integer line `L`: `P(push) = P(T = L)`
- Half-line: `P(push) = 0`
- `P(over) + P(under) + P(push) = 1`
- Raising the line cannot increase `P(over)`

Do not treat σ = 13.5 as a fitted NFL scoring model. No σ was estimated from historical games.

## Spreads

v1.1.0 converts the blended moneyline probability to an expected margin (same unvalidated σ) and scores the posted home spread. Research only. Spreads are stored on the payload and are not a public `GAME_LINE_TYPES` market.

## Traceability

Each research evaluation carries model version, input snapshot, event, market, line, sportsbook, decimal/American odds, and timestamps. Public output must reuse that prediction and quote. A later Odds row is rejected.

`EdgeSnapshot` stores `edgeMl*` / `edgeTotal*` / `modelRun` plus pairing columns (`payload`, `oddsSnapshotId`, `inputSnapshotId`, `quotedAt`, `eligibleForPublic`). NFL writes `modelRun = nfl-selection-v1.1.0`, **null** edge floats, the selection payload (including spreads), and the quote used at prediction time. `eligibleForPublic` stays false. Apply the SQL in `scripts/migrations/004_team_freshness_and_edge_traceability.sql` before relying on those columns in a database. See `docs/migrations/004_edge_snapshot_traceability.md`.

## Validation blockers

The walk-forward harness is `scripts/backtest-game-lines.js`. It does not invent calibration. If the stored sample is under 200 games it prints `SAMPLE_TOO_SMALL`. Closing-line comparison uses saved `Odds.quotedAt`, `ClosingOdds` `clvclose:` rows, `OddsSnapshot`, and `EdgeSnapshot` payloads. Zero Odds API credits.

Ask before adding paid data services.

## Recommendation

**Keep public NFL selections disabled** until:

1. Team freshness / season / data-through columns are applied in the target database and populated by a core ESPN extract (`statsDataThrough` comes from ESPN `previousEvent` when present, otherwise the team's latest same-sport final `Game` on or after the sport's regular-season start, withheld only when DB finals exceed ESPN `gamesPlayed` by more than 2).
2. A chronological out-of-sample evaluation reports sample size, calibration, probability score vs the market, and a defined staking rule.
3. Totals have a walk-forward that beats the close on the same bars as moneyline. The v1.1.0 Normal is a research start, not that study.
