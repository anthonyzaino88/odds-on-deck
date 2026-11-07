# Game-line evaluation contract

Status: **contract only**. This document does not change models, allowlists, or jobs.

Markets in scope: **moneyline** and **game total** for NFL, NHL, NBA, and MLB. Spreads are out of scope even where a `spreads` quote is stored.

No step in this contract may call The Odds API. Training, scoring, and any later harness read rows already in Supabase or in the operator's local archive. If a required row is missing, the game is excluded. It is not filled with a live fetch.

## Audit (this checkout, `9467bed`)

Production row counts and date ranges are **not in the repository**. This checkout has no `.env.local`, so Supabase was not queried. `research/archive/` contains only `README.md` and `.gitkeep` files (prop-line JSONL, MLB box-score JSONL, and NFL box scores are gitignored and are not present here). `.local/` has no game, odds, or score dump. Numbers below are from code, SQL, and fixtures. Anything not listed was not found.

### What is already modeled

| Sport | Game-line model | Public today | Totals |
| --- | --- | --- | --- |
| NFL | `nfl-selection-v1.0.1` (`lib/nfl-selection-model.js`). Legacy heuristic `nfl-nhl-v0.1.0` must not be scored as this model. | `PUBLISHED_GAME_LINE_SPORTS` is `['nfl']`, but `nflGameLineMeetsPublicGates` requires `eligibleForPublic === true`. Production does not set that flag (`docs/nfl-selection-model.md`). | Ineligible: `missing_validated_scoring_distribution`. No fitted scoring distribution in the repo. |
| NHL | `nhl-gd-v0.2.0` (`lib/edge-nfl-nhl.js`). Legacy `nfl-nhl-v0.1.0`. Cutover instant used only for unversioned `source=game_line` rows: `2026-10-27T15:02:00.000Z`. | Not in `GAME_LINE_SPORTS` or `PUBLISHED_GAME_LINE_SPORTS`. | Heuristic runs only when the moneyline path does not skip. A moneyline skip nulls the total. |
| MLB | `v0.2.0` (`lib/edge.js`). Skips the game when either probable pitcher is missing. | In `GAME_LINE_SPORTS` (tracked, still graded if a row exists). Not in `PUBLISHED_GAME_LINE_SPORTS`. `record-game-lines.js` does not insert new MLB rows. | Negative-binomial run model. Variance constant `TEAM_NB_R = 5` is not fitted on stored finals. |
| NBA | None. | None. `Game.sport` comment and `fetch-fresh-games.js` are `mlb`, `nfl`, `nhl` only. | None. |

`GAME_LINE_TYPES` is `moneyline` and `total`. `GAME_LINE_MIN_EDGE` is `0.05`. `GAME_LINE_CAP` is `8`. `GAME_LINE_SOURCE` is `game_line`.

`npm run record:game-lines` (`scripts/record-game-lines.js`) reads `EdgeSnapshot`, `Odds`, and `Game` only. It does not call The Odds API. It records only sports in `PUBLISHED_GAME_LINE_SPORTS` after `selectGameLines`. Homepage and `/api/picks` do not insert game-line rows.

### Stored tables the harness may read

These schemas exist. This checkout does not contain their row counts.

| Table | What it holds | Limit for a walk-forward |
| --- | --- | --- |
| `Game` | Schedule, status, scores, MLB probable pitcher ids, NFL `homeStartingQB` / `awayStartingQB`, weather, `week`, `season`. | `scripts/cleanup-old-games.js` deletes MLB and NHL games outside the local calendar day and NFL games outside the current week, after copying a row to `ArchivedGame`. The live `Game` table is not a history. |
| `ArchivedGame` | One row per cleaned-up game: teams, scores, status, weather, pitcher ids, QB names, vendor ids, `archived_at`. | Scores and schedule can be history. `archived_at` is cleanup time, not pick-lock time. Pitcher, QB, and weather on this row are not proof they were known at lock. |
| `Odds` | `h2h`, `spreads`, `totals` (fetchers request all three for mlb, nfl, nhl). American prices, line, `ts`. | Cleanup deletes `Odds` for removed games after keeping the latest row per game, book, and market. |
| `ClosingOdds` | Same markets. Cleanup copies that latest `Odds` row. Close capture writes `id LIKE 'clvclose:%'` inside the pre-start window. | A cleanup copy is the last stored quote at delete time, not automatically a close. `book=attempted` is a missed fetch, not a price (`research/archive/README.md`). |
| `EdgeSnapshot` | `edgeMl*` / `edgeTotal*`, `modelRun`, `ts`. NFL also writes `payload`, `oddsSnapshotId`, `inputSnapshotId`, `quotedAt`, `eligibleForPublic`. | MLB and NHL omit the pairing columns. `cleanup-old-games.js` deletes these rows with the game. Current `Team` stats on a snapshot are a latest fetch, not a point-in-time history. |
| `PropValidation` | `source=game_line`, `propType` moneyline or total, plus nullable `closeOdds`, `closeLine`, `closeBook`, `closeNumBooks`, `closeCapturedAt` (SQL 007). | Close columns are captured for published picks going forward. SQL 007 does not backfill. |
| `OddsSnapshot` | One informational row per published pick per capture (`midday`, `pregame`; the snapshot script does not write `close`). SQL 011. | Not a game-line history. Not applied by this repo's jobs; an operator applies SQL by hand. |
| `InjuryReport` | ESPN injury rows with `sport`, `asOfDate`, `fetchedAt`. SQL 009. | Fetcher URLs are NFL and NHL only (`lib/espn-injuries.js`). A non-NHL sport uses the NFL URL. No MLB or NBA injury feed in that function. |
| `NhlStartingGoalie` | Starter name, `confirmed`, `asOfDate`, `fetchedAt`. | Timestamped. Usable only when `fetchedAt` is at or before pick-lock. The injury filter flags an NHL game line `starter:unconfirmed`; it does not supply a model feature. |
| `NFLMatchupHistory` | Per-game offense/defense box fields. | Schema only in this audit. No writer or row count was found. Do not assume it is populated. |
| `Team` | `last10Record`, `avgPointsLast10`, `avgPointsAllowedLast10`, `gamesPlayed`, `season`, `statsCapturedAt`, `statsDataThrough`. | ESPN writes a **season** record into `last10Record` and season per-game averages into the "last 10" columns (`statsKind` `last10` is not written today). The row is the latest fetch. Using it to score an older game leaks the future. |

Odds API sport keys in `scripts/fetch-odds-for-all-games.js`: `icehockey_nhl`, `americanfootball_nfl`, `baseball_mlb`. No NBA key.

Close capture of game lines (`lib/closing-line.js`) merges `h2h` / `spreads` / `totals` onto an event only for the opt-in `--nfl-all` NFL job. NHL, MLB, and NBA game lines do not have that path.

### Fixtures (not a sample)

| File | What it is |
| --- | --- |
| `__tests__/fixtures/espn-nfl-boxscore.fixture.js` | One completed ESPN event, `401547353`, kickoff `2025-09-05T00:20:00.000Z`, season year 2025 week 1, PHI 21 at KC 24. Comment: not live data. |
| `__tests__/fixtures/mlb-schedule-linescore.fixture.js` | Three MLB Stats API games captured `2026-09-24` for official date `2026-09-23`: gamePk `824785` (TOR at BAL, final 2–4), `824868`, `824951`. No odds. |
| `__tests__/fixtures/mlb-boxscore.fixture.js` | A trimmed box score for grading tests. No game date and no odds. |

No fixture in this checkout is a moneyline or total price history.

### Which sports and markets have enough stored data

**None can be shown to, from this checkout.** There is no count of lock-time quote + later close + final score triples for any sport or market. Local archives that might hold NFL box scores or prop lines are not in this checkout, and those archives are not game-line prices.

Until a read-only inventory (no Odds API) reports those triples, every market in this workstream stays shadow-only. NBA has no game, odds, score, injury, or starter pipeline here, so it cannot clear a sample-size gate.

## Two clocks

Every price row has two times, and the harness keeps them apart.

| Clock | Columns | Role |
| --- | --- | --- |
| Quote time | `last_update` / `lastUpdate` on the book or market | Age of the price. Lock eligibility, stale exclusion, and the close window use this clock. |
| Capture time | `Odds.ts`, `ClosingOdds.snapshot_at`, `PropValidation.closeCapturedAt` | When this database stored the row. |

A capture time does not stand in for a missing quote time. `book=attempted` is a missed fetch, not a price. A quote time at or after the frozen start is in-play and is excluded (`shouldSkipLiveCloseOverwrite` in `lib/closing-line.js`).

## Frozen start

Fold assignment uses one frozen start per event.

- Freeze the earliest stored scheduled start whose write time is at or before pick-lock (`Game.date` when that write is pre-lock).
- A later edit that moves a postponed, delayed, or resumed game onto another date does not move the event into a later fold.
- Postponed, cancelled, suspended, and not-final rows stay unresolved. They are purged from training labels and from scored test metrics. They are not losses.
- If the only stored start was written after lock, or the timestamp does not parse, the event is out of the fold.

The ET calendar is `America/New_York`. NFL folds are one `Game.week` inside a season, or the ET Monday–Sunday week of the frozen start when `week` is null. NHL, MLB, and NBA folds are one ET date of the frozen start.

## Pick-lock and the posted price

Pick-lock is the decision capture for one event and one market (`h2h` or `totals`). It is chosen without looking at later closes or at the result.

A book is eligible at a capture when all of the following hold:

- Both sides are present on that same capture: home and away for `h2h`, over and under for `totals`. One-sided rows are out.
- Totals: both sides quote the same numeric total.
- Both sides share one quote time (synchronized).
- That quote time is present, is before the frozen start, and is no older than `LINE_SHOP_STALE_AFTER_MS` (6 hours) before the capture time. Missing quote time is stale (`isQuoteStale` in `lib/line-shopping.js`).

Entry book, at one capture: among eligible books, take the first name in `CLOSE_QUOTE_BOOK_ORDER` (`pinnacle`, `circa`, `circa sports`, `fanduel`, `draftkings`, `betmgm`, `caesars`, `betrivers`, `fanatics`). Any other book sorts after that list, then by `localeCompare` of the book name. The sort keys are the book name only. The rule does not prefer the book that later posts the close, and it does not read the final score.

Pick-lock is the latest capture that is at least 60 minutes before the frozen start and that has an eligible entry book. The posted price is that book's American (or stored decimal) price on the side, vig included. A later capture is a close candidate. If no capture qualifies, the event is excluded from that market. The harness does not impute a price.

`Game` / `Odds` rows that store `ts` or `snapshot_at` and no `last_update` fail this rule. The inventory must count them separately. They are not silently treated as fresh.

## Consensus close

Production CLV compares the posted price with the **consensus** close, not with the entry book's own later price (`lib/closing-line.js`: `consensusClosingQuote`, `clvFromOdds`).

Consensus membership at a close capture uses the same eligible-book rule as the lock (fresh, synchronized, two-sided, and for totals the locked total). A close needs at least two member books. One book is not a consensus.

The consensus quote is the median decimal on that exact side and, for totals, the exact locked total (`consensusClosingQuote`). An even count takes the earlier book in `CLOSE_QUOTE_BOOK_ORDER` among the two middle quotes, then `localeCompare`. The highest price is not the consensus.

Totals: a close whose total differs from the locked total is `lineMoved`. It is reported on its own and is excluded from `clvProb`, from the CLV pass sample, and from 2-way log loss and Brier. That matches `summarizePublishedClv`, which averages `clvProb` on same-line rows only.

Close selection, in order:

1. Preferred: a `clvclose:` capture whose member quote times sit after `frozen start − CLOSE_CAPTURE_WINDOW_MINUTES` (35) and at or before `frozen start − CLOSE_CAPTURE_MIN_LEAD_MINUTES` (1). The capture time must also be before the frozen start.
2. Fallback, only when no preferred capture qualifies: the latest pre-start capture that meets the same quote-time window and the same two-book membership rule. The fallback max age is that 35-minute window. A quote older than 35 minutes before start is not a fallback close. Capture time alone cannot put a row inside the window.
3. If neither exists, CLV is missing for that event. The event stays out of the CLV pass sample.

## Allowed inputs

An input is allowed only when it is knowable at that event's pick-lock. Each feature carries two timestamps:

- `observedAt`: when the stored row was written.
- `dataThrough`: the start time of the last event included in the statistic.

Both must be at or before pick-lock. A missing timestamp drops the feature. A current `Team` row is the latest fetch (`statsCapturedAt`, `statsDataThrough`) and is not a history of past slates.

Form, rest, and matchup history are rebuilt from completed games whose **result-available time** is before this event's pick-lock. Result-available time is the earliest stored write of a final score (`Game.lastUpdate` on a final row, otherwise `ArchivedGame.archived_at`). Kickoff before this event's kickoff is not enough.

| Input | NFL | NHL | MLB | NBA |
| --- | --- | --- | --- | --- |
| Matchup history | Prior finals between the two teams, scores and dates, result available before lock. | Same. | Same. | Same, once stored finals exist. They do not in this checkout. |
| Recent form | Last finals with result available before lock. `last10Record` and `avgPointsLast10` on the current `Team` row are a season snapshot, so they are not this feature. | Same. | Same. | Same. |
| Rest | ET days from each team's previous final start to this frozen start, using only a previous final whose result was available before lock. Unknown stays unknown. | Same. | Same. | Same. |
| Injuries | `InjuryReport` `sport=nfl` with `fetchedAt` as `observedAt` and `asOfDate` as `dataThrough`, both ≤ lock. A missing snapshot stays missing. | `sport=nhl`, same clocks. | No MLB feed in `espnInjuriesUrl`. | No NBA feed. |
| Starters | QB names only from a row with `observedAt` ≤ lock. `ArchivedGame.home_qb` / `away_qb` have no pre-lock write time. | `NhlStartingGoalie.fetchedAt` ≤ lock. Unconfirmed stays unconfirmed. | Probable pitchers only from a row with `observedAt` ≤ lock. Archive pitcher ids have no pre-lock write time. | No starter table. |

Park factors in `lib/edge.js` (`PARK_FACTORS`) are constants in git. MLB may use the home park constant.

Current production models do not already satisfy this input list. NFL moneyline research uses the season win-loss record, games played, season, data-through, captured-at, and the two-way quote (`NFL_ML_INPUTS_USED`). It does not use quarterbacks, injuries, weather, efficiency, point differential, or a real last-10 window. NHL moneyline uses shrunk goal differential from the team-stat snapshot plus a home-ice logit. MLB requires probable pitchers and uses season-style team rates. The harness rebuilds features from finals that were already resulted. A current `EdgeSnapshot` is not an out-of-sample prediction for an older date.

## Markets, vig, and edge

Stored markets in this contract are 2-way only.

- NFL `h2h` is the two-way price on a decisive result. A final tie pushes (refund). Regulation home/away/draw prices are out of scope. `nfl-selection-v1.0.1` sets `P(tie) = 0`; that is not a fitted tie rate.
- NHL `h2h` is the full game, including overtime and the shootout. The winner of the shootout is the moneyline winner. A regulation-only or draw market is out of scope.
- MLB `h2h` is the full game, including extra innings. There is no draw. A suspended game with no final is unresolved and is purged.
- NBA `h2h`, if stored rows ever exist, is the full game including overtime. There is no draw.
- Totals are over/under at one number. The book must post both over and under at that same total. An integer landing on the number pushes.

Pushes are refunds. They are excluded from 2-way log loss, 2-way Brier, and the hit-rate denominator, and they are counted in the report. They are not coded as losses, and log loss does not use `P(side | decisive)`.

Eval edge decides the bet. It is not CLV.

```
edge = P_model(side) − P_novig(side | entry book's paired lock prices)
```

`P_model` is the model's probability of that side at pick-lock, in `[0, 1]`. A probability outside `[0, 1]` fails the candidate. Caps are not the edge. These production caps stay out of the metric: `NFL_DISPLAY_EDGE_CAP` (0.10), `NHL_ML_EDGE_CAP` (0.05), `NHL_TOTAL_EDGE_CAP` (0.10), MLB `EDGE_CAP` (0.08), and `GAME_LINE_MIN_EDGE` (0.05).

`P_novig` uses both posted sides. Let `q_side` and `q_other` be the raw implied probabilities (`impliedProbabilityFromOdds`, vig still inside). The contract normalizes whenever `q_side + q_other` is finite and positive, including an underround (`sum ≤ 1`):

```
P_novig(side) = q_side / (q_side + q_other)
```

`removeMlVig` and `removeTotalVig` leave the raw implied probabilities in place when the sum is `≤ 1` (`vig = 0`). Probability scores and `novigMove` use the always-normalize rule above instead, and the report counts underround pairs. An unpaired price is excluded. `LINE_SHOP_UNPAIRED_VIG` (0.955) is not applied.

The bet side is the side with positive eval edge. If both sides are non-positive, the event is a no-bet: it stays in the probability scores and stays out of ROI, CLV, and hit rate.

## Production CLV

CLV is the production definition in `clvFromOdds`:

```
clvProb = implied(consensus close) − implied(posted price)
```

Both implied values are raw `impliedProbabilityFromOdds` of the posted numbers. Vig stays inside both. Positive `clvProb` means the consensus close implied a higher probability for our side than the posted price did: the market moved toward our side, and the posted price paid more than the close (`beatClose` is `recordedDecimal > closeDecimal`).

The posted price is the entry book's lock price. The close is the consensus quote on the same side and, for totals, the same locked line. Same-book close movement is not `clvProb`.

`novigMove` is a separate report column, not a CLV synonym and not a pass gate:

```
novigMove = P_novig(side at the consensus close) − P_novig(side at the entry book's lock pair)
```

Same subtraction order as `clvProb` (close minus posted), after the always-normalize rule. The pass gate uses `clvProb` only.

## Walk-forward, purge, and embargo

One candidate is one pre-registered model version on one sport and one of {moneyline, total}.

- Order folds by frozen start. NFL: previous weeks only. NHL, MLB, NBA: previous ET days only.
- A training row's result-available time must be at or before `earliest test pick-lock − EMBARGO`. `EMBARGO` is 24 hours. A game that kicks off before the test slate and whose score is written inside that window, or after the test lock, is purged from that fold's training set.
- Unresolved and overlapping labels are purged: not-final statuses, duplicate event ids (keep the row that owns the frozen start), and any training game whose result interval overlaps the test lock. Same-week NFL games and same-ET-day games are out of that fold's training set.
- Fit any free parameter on the surviving training rows only. Constants in git (`NFL_HFA_LOGIT` 0.12, `NHL_HOME_ICE` 0.14, `NHL_MARKET_BLEND` 0.35, `TEAM_NB_R` 5, park factors) stay fixed. Changing one is a new model version and a new pre-registered candidate.
- Score the fold, then move forward. Never shuffle.
- The first fold has no training rows. It is warmup. It does not count toward sample size and it is not holdout.
- A game missing a lock quote, a paired price, a final, or a required pre-lock feature is excluded and the reason is counted. It is not imputed.

`EdgeSnapshot.modelRun` names the formula that wrote a stored edge. `nfl-nhl-v0.1.0` stays the retired heuristic and is not pooled into `nfl-selection-v1.0.1` or `nhl-gd-v0.2.0`.

## Metrics

The pass sample is the untouched holdout defined below. Development folds are reported and cannot pass a market. Every metric is reported overall and clustered by fold (NFL week or ET date). A pooled number without the by-fold table is not a pass report.

Sample sizes below are gates. This audit did not observe them.

| Metric | Definition | Holdout gate |
| --- | --- | --- |
| `clvProb` | Mean of production `clvProb` on bets with a same-line consensus close. | At least **200** such bets across at least **4** holdout folds. Mean ≥ `CLV_MIN_EFFECT` (0.01). Cluster 95% CI lower bound > 0. |
| Log loss | Mean log loss of clipped `P_model` vs the 0/1 outcome, against the same loss for `P_novig` of the consensus close. Pushes omitted. No-bets included. Totals need the paired over/under at the locked total. | At least **200** such decided games across at least **4** holdout folds. Model loss lower, and the cluster 95% CI for (close loss − model loss) has lower bound > 0. |
| Brier | Mean squared error of unclipped `P_model` in `[0, 1]`, against `P_novig` of the consensus close. Same games and the same push rule as log loss. | Same 200 games. Model score lower, and the cluster 95% CI for (close score − model score) has lower bound > 0. |
| ROI | Flat 1 unit at the posted lock price. Wins pay that price. Losses lose 1. Pushes return 0 and stay in the denominator. | Point estimate > 0 on the same bets as `clvProb`, and the cluster 95% CI lower bound > 0. |
| Hit rate | Wins / (wins + losses). Pushes omitted. | Reported with the counts, by fold. No hit-rate threshold. |

Log loss clips `P_model` and the close probability to `[LOG_LOSS_CLIP, 1 − LOG_LOSS_CLIP]` with `LOG_LOSS_CLIP = 0.001` before the log. Brier uses the unclipped `[0, 1]` probabilities.

Dependence: the interval is a cluster-robust sandwich or a cluster bootstrap, with the fold id as the cluster. An iid standard error does not satisfy the gate. The report names the method and the cluster count.

`clvProb` and ROI use the posted lock price and the consensus close. Log loss and Brier use `P_model` and `P_novig`. `novigMove` is reported beside them and is not substituted for `clvProb`.

If the holdout cannot supply 200 qualifying games, the market fails for sample size. The harness does not lower the gate.

## Pass / fail before Published

Pre-register the candidate list before scoring any test fold. The list for this workstream is:

| Candidate | Market |
| --- | --- |
| `nfl-selection-v1.0.1` | NFL moneyline |
| `nfl-selection-v1.0.1` totals path | NFL total (research only; production totals stay ineligible until a scoring distribution exists) |
| `nhl-gd-v0.2.0` | NHL moneyline |
| `nhl-gd-v0.2.0` | NHL total |
| MLB `v0.2.0` | MLB moneyline |
| MLB `v0.2.0` | MLB total |
| MLB no-pitcher ablation | MLB moneyline |
| none | NBA moneyline |
| none | NBA total |

`K` is the size of that frozen list. A candidate dropped after seeing metrics still counts in `K`. Adding a version, a feature, or a market after seeing test results voids every pass.

The last 20% of scored folds by frozen start, and at least two folds, are the untouched holdout. They are not used to pick features, constants, or which candidate to publish. Development folds may be inspected. The pass numbers are computed on the holdout only. Fewer than six scored folds means the holdout cannot be formed, and every candidate fails closed.

A candidate passes only when all of the following hold on one frozen holdout report:

1. The report names the model version, the feature list with `observedAt` and `dataThrough` rules, the entry-book rule, the consensus-close rule, the vig rule, the embargo, and the fold boundaries.
2. The holdout sample sizes in the table above are met.
3. `clvProb`, ROI, log loss, and Brier each clear their cluster interval and, for `clvProb`, the minimum effect.
4. The `clvProb` one-sided cluster test is compared with `0.05 / K` (Bonferroni across the frozen list). A candidate chosen because it was the best of `K` does not get alpha `0.05`.
5. The report used stored rows only. Odds API credits used: 0.

Failing one item fails that candidate. A moneyline pass does not publish the total. This document does not flip `PUBLISHED_GAME_LINE_SPORTS`, `eligibleForPublic`, or `GAME_LINE_SPORTS`. A later change, reviewed on its own, is what adds a sport to the public list. A later change to features, vig math, fold definition, embargo, or model version voids the pass.

## Shadow-only when a market fails

A failing or unmeasured candidate:

- Is not added to `PUBLISHED_GAME_LINE_SPORTS`.
- Stays off `selectGameLines` / `isPublicGameLine`. NFL research rows keep `eligibleForPublic` false.
- Is not inserted by `record-game-lines.js`.
- Does not enter the published-pick close job, the public board, or parlays.
- May be written by a future harness to a shadow file or a shadow table that public reads do not query. That write is a later PR. Until it exists, the only record of a failed market is the walk-forward report.
- Legacy rows already stored (`source=game_line` under `nfl-nhl-v0.1.0`, or pending MLB game lines) stay out of the published track. Do not void them from this contract, and do not treat them as evidence the market passed.

NBA moneyline and NBA totals start and stay in this state. NHL moneyline, NHL totals, MLB moneyline, MLB totals, and NFL totals start here as well. NFL moneyline stays here until a holdout report on `nfl-selection-v1.0.1` passes the gates above. The current model document already says the public board stays empty.

## Recommended order for the walk-forward harness

The next PR should still spend zero Odds API credits.

1. **Read-only inventory.** Per sport and per `h2h` / `totals`, count finals, captures that have a real quote time at least 60 minutes before the frozen start, `clvclose:` rows inside the 35-to-1 minute quote-time window, fallback rows in that same window, same-line totals versus `lineMoved`, and captures that have at least two eligible books. Also count rows that have only a capture time. Sources: `Game`, `ArchivedGame`, `Odds`, `ClosingOdds`, `EdgeSnapshot.modelRun`, `InjuryReport`, `NhlStartingGoalie`. Print the counts. Do not invent a backfill.
2. **NFL moneyline harness.** First candidate with a versioned selection model, quote-pairing columns, a weekly key, and an existing `clvclose:` path (`--nfl-all`). Rebuild form from finals whose results were available before lock, then apply the 24-hour embargo. Do not score totals in this step. Do not set `eligibleForPublic`.
3. **NHL moneyline.** `nhl-gd-v0.2.0` already writes an edge, but there is no public game-line list entry and no game-line close capture. Grade the full game including overtime and the shootout. The harness can score only the triples the inventory finds. Goalie rows are optional inputs when `fetchedAt` is before lock.
4. **MLB moneyline, then MLB totals.** `v0.2.0` depends on probable pitchers. The no-pitcher ablation is already on the pre-registered list. Use a pitcher only with `observedAt` before lock. Totals stay a scored hypothesis.
5. **NFL totals.** Blocked in the current model by `missing_validated_scoring_distribution`. Add a totals candidate only after the inventory shows enough same-line closes, and only inside the harness. A passing totals report is a separate candidate from step 2.
6. **NBA last.** No fetch, table, or model in this repo. Do not add an Odds API sport key in the harness PR. NBA stays shadow-only until stored games, prices, and scores already exist.
