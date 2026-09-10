# NFL moneyline and totals selection model

Status: **unvalidated research heuristic**. Public NFL sides and totals stay disabled.

Model version: `nfl-selection-v1.0.0`  
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
| `unknown_data_freshness` | No `statsCapturedAt` (current Team table has no such column) |
| `stale_team_data` | Captured-at older than 7 days or in the future |
| `missing_data_through` | No data-through date |
| `data_through_in_future` | Data-through is after evaluation time |
| `early_season_insufficient_sample` | Either team has fewer than 4 season games |
| `missing_validated_scoring_distribution` | NFL totals have no fitted P(total) |
| `unvalidated_heuristic` | Research numbers may exist; public board stays empty |

Moneyline and totals are evaluated independently. Missing moneyline odds do not disable totals.

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

Model-versus-market gap: `P(win) - fair market probability` (uncapped).

Estimated EV at decimal odds `d`:

```
EV = P(win) × (d − 1) − P(loss)
```

A refunded push contributes 0. Display caps are UI-only and are never stored as the model estimate.

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

`EdgeSnapshot` today stores only `edgeMl*` / `edgeTotal*` / `modelRun`. NFL writes `modelRun = nfl-selection-v1.0.0` and **null** edges so the public board cannot read a phantom gap. A payload JSON column is proposed, not applied (see `docs/migrations/004_edge_snapshot_traceability.md`).

## Validation blockers

No chronological out-of-sample study is in this repo. Do not invent calibration, CLV, or ROI. Closing-line comparison is unavailable (quotes are not stored with the prediction today).

Ask before adding paid data services.

## Recommendation

**Keep public NFL selections disabled** until:

1. Team freshness / season / data-through columns exist and are populated.
2. A chronological out-of-sample evaluation reports sample size, calibration, probability score vs the market, and a defined staking rule.
3. Totals have a fitted or empirically validated mapping that handles NFL scoring variance and integer pushes.
