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

## Pick-lock

Pick-lock is the decision time for one game. It is not the close, and it is not `ArchivedGame.archived_at`.

For each game:

1. Scheduled start is `Game.date` (or `ArchivedGame.date` when the live row is gone). If that timestamp does not parse, the game is out of the fold.
2. Candidate quotes are `Odds` and `ClosingOdds` rows for that `game_id` with `market` `h2h` (moneyline) or `totals` (total), `ts` or `snapshot_at` **strictly before** start, and at least **60 minutes** before start.
3. Pick-lock is the latest such quote time. The quote at that time is the lock price. A later pre-start quote is the close candidate, not the decision.
4. If no quote is at least 60 minutes before start, the game is excluded from that market. Do not impute a price.
5. The close is the latest stored quote for the same game, book, and market with timestamp **strictly before** start and **strictly after** pick-lock. Prefer a `clvclose:` row when its `snapshot_at` falls in that interval. Ignore `book=attempted`. A post-start price is never the close. If no close exists, CLV is missing and the game fails the CLV gate for that market (it may still be reported, but it cannot help a market pass).

`Team` columns, `EdgeSnapshot` floats, and archive pitcher/QB/weather fields may be used only when their own write time is at or before pick-lock. A column without a pre-lock timestamp is forbidden, even if the name looks like a pre-game fact.

NFL folds are weekly: one fold per `Game.week` inside a season, or per ET Monday–Sunday week when `week` is null. NHL, MLB, and NBA folds are one ET calendar day. The ET date is `America/New_York`.

## Allowed inputs

An input is allowed only if it is knowable at pick-lock from stored rows. Reconstruct form, rest, and matchup history from **completed games whose start is before pick-lock**. Do not read the current `Team` row for a past slate.

Forbidden for every sport: the opposing team's eventual score, in-game state, a post-start injury or lineup, any `Team` field captured after lock, display edge caps, and the market's own close.

| Input | NFL | NHL | MLB | NBA |
| --- | --- | --- | --- | --- |
| Matchup history | Prior finals between the two teams (scores and dates only). | Same. | Same. | Same, once stored finals exist. They do not in this checkout. |
| Recent form | Last completed games before lock, computed from finals. Not `last10Record` or `avgPointsLast10` off the current `Team` row. | Same. | Same. | Same. |
| Rest | ET days from each team's previous final start to this start. A missing previous game is "unknown", not zero. | Same. | Same. | Same. |
| Injuries | `InjuryReport` with `sport=nfl` and `fetchedAt` ≤ lock. Later snapshots are leakage. Missing snapshot is a missing flag, not "healthy". | `sport=nhl`, same clock. | **Not allowed.** The injury URL helper has no MLB feed. | **Not allowed.** No NBA feed. |
| Starters | QB names only from a row whose write time is ≤ lock. `ArchivedGame.home_qb` / `away_qb` do not qualify. | Goalies from `NhlStartingGoalie` with `fetchedAt` ≤ lock. Unconfirmed stays unconfirmed. | Probable pitchers only from a row whose write time is ≤ lock. Archive pitcher ids do not qualify. | **No starter table.** |

Park factors in `lib/edge.js` (`PARK_FACTORS`) are constants in git. MLB may use the home park constant. That is not a result.

Current production models do not already satisfy this input list. NFL moneyline research uses the season win-loss record, games played, season, data-through, captured-at, and the two-way quote (`NFL_ML_INPUTS_USED`). It does not use quarterbacks, injuries, weather, efficiency, point differential, or a real last-10 window. NHL moneyline uses shrunk goal differential from the team-stat snapshot plus a home-ice logit. MLB requires probable pitchers and uses season-style team rates. The harness must rebuild pre-lock features from finals. It must not treat a current `EdgeSnapshot` as an out-of-sample prediction for an older date.

## Vig removal and edge

Use the proportional two-way removal already in `lib/implied.js`:

- Moneyline: `removeMlVig(homeOdds, awayOdds)`.
- Total: `removeTotalVig(overOdds, underOdds, total)`.

Fair probability of a side is that side's American implied probability divided by the sum of both sides. If the sum is less than or equal to 1, the function's no-vig result stands (`vig = 0`). Do not drop the favorite or the longshot. Do not use a single book's juice as the probability.

Eval edge, for the side the model would bet, is:

```
edge = P_model(side) − P_novig(side at the lock quote)
```

`P_model` is the model's probability of that side at pick-lock. Caps are not the edge. These production caps stay out of the metric: `NFL_DISPLAY_EDGE_CAP` (0.10), NHL `NHL_ML_EDGE_CAP` (0.05) and `NHL_TOTAL_EDGE_CAP` (0.10), MLB `EDGE_CAP` (0.08), and `GAME_LINE_MIN_EDGE` (0.05). A 5% display floor is not a pass gate.

Moneyline prices are two-way. Where the sport can push (NFL tie; integer total):

- If the model emits `P(push)`, then `P(side | decisive) = P(side) / (1 − P(push))` when scoring against a two-way no-vig price, and a push settles as a refund.
- If the model does not emit `P(push)`, pushes are removed from log loss, Brier, and hit rate, and the push count is reported. They are not coded as losses.

NFL `nfl-selection-v1.0.1` sets `P(tie) = 0`. Do not pretend that is a fitted tie rate.

The bet side is the side with positive eval edge. If both sides are non-positive, the game is a no-bet and stays in the probability scores (the model is still graded against the close) but out of ROI, CLV-on-bets, and hit rate.

## Walk-forward

One market is one sport plus one of {moneyline, total}.

- Sort games by scheduled start.
- A fold's training rows are games whose scheduled start is **strictly before** the fold's first start. NFL: previous weeks only. NHL, MLB, NBA: previous ET days only.
- Fit any parameter inside the training rows only. Constants checked into git (`NFL_HFA_LOGIT` 0.12, `NHL_HOME_ICE` 0.14, `NHL_MARKET_BLEND` 0.35, `TEAM_NB_R` 5, park factors) are fixed. Changing one of them is a new model version, not a silent fit on the test week.
- Score the fold, then append it to training. Never shuffle. Never use a game on the same ET day (or the same NFL week) as both train and test.
- The first fold has no training games. Record it as unscored warmup. It does not count toward sample size.
- A game missing a lock quote, a final score, or a pre-lock feature the model claims to require is excluded, not imputed. Report the exclusion reason.

`EdgeSnapshot.modelRun` identifies which formula produced a stored edge. Rows with `nfl-nhl-v0.1.0` are the retired heuristic. Do not mix them into `nfl-selection-v1.0.1` or `nhl-gd-v0.2.0` results.

## Metrics and sample sizes

Report every metric on the walk-forward test folds only, with the game count, the ET or season date of the first and last test game, and the exclusion counts. A sample size below is a **gate**, not a count this audit observed.

| Metric | Definition | Minimum to be eligible for a pass |
| --- | --- | --- |
| CLV vs close | On bet games that have a close: `P_novig(side at lock) − P_novig(side at close)`. Positive means the close moved against the side we bet. Mean CLV must be greater than 0. | **200** bet games with both a lock quote and a close, across at least **4** test folds. |
| Log loss vs no-vig close | On decided games (pushes handled as above), including no-bets. Natural log loss of `P_model` versus the outcome, compared with log loss of the no-vig close probability. The model must be strictly lower. | **200** decided games with a close probability, across at least **4** test folds. |
| Brier vs no-vig close | Mean squared error of `P_model` versus the 0/1 outcome, versus the same error for the no-vig close. The model must be strictly lower. Same games as log loss. | Same 200. |
| ROI | Flat 1 unit at the **lock** American price. Wins pay the lock price. Losses lose 1. Pushes return 0. ROI is profit divided by the number of bets (pushes included in the denominator). | Reported whenever at least 1 bet exists. It is not a standalone pass. A pass still needs ROI greater than 0 on the same bet set as CLV. |
| Hit rate | Wins / (wins + losses). Pushes omitted. | Reported with the win and loss counts. No hit-rate threshold. A high hit rate at a short price is not a pass. |

CLV and probability scores use the close. ROI uses the lock price, because that is the price that was bettable at decision time. Do not mix those two prices in one number.

If the stored history cannot supply 200 qualifying games, the market fails for insufficient sample. Do not lower the gate inside the harness.

## Pass / fail before Published

A market is published only when **all** of the following are true on one frozen walk-forward report:

1. The report lists the model version, the input list, the lock rule, the vig rule, and the fold boundaries.
2. Sample-size rows in the table above are met.
3. Mean CLV greater than 0, ROI greater than 0, log loss strictly better than the no-vig close, and Brier strictly better than the no-vig close.
4. The report was computed from stored rows only. Odds API credits used: 0.
5. A later change to features, vig math, fold definition, or model version voids the pass. The market returns to shadow until a new report passes.

Failing one item fails the market. Totals and moneylines are separate markets. An NFL moneyline pass does not publish NFL totals.

This document does not flip `PUBLISHED_GAME_LINE_SPORTS`, `eligibleForPublic`, or `GAME_LINE_SPORTS`. A pass is a report. A later change, reviewed on its own, is what adds a sport to the public list.

## Shadow-only when a market fails

A failing or unmeasured market:

- Is not added to `PUBLISHED_GAME_LINE_SPORTS`.
- Stays off `selectGameLines` / `isPublicGameLine`. NFL research rows keep `eligibleForPublic` false.
- Is not inserted by `record-game-lines.js`.
- Does not enter the published-pick close job, the public board, or parlays.
- May be written by a future harness to a shadow file or a shadow table that public reads do not query. That write is a later PR. Until it exists, the only record of a failed market is the walk-forward report.
- Legacy rows already stored (`source=game_line` under `nfl-nhl-v0.1.0`, or pending MLB game lines) stay out of the published track. Do not void them from this contract, and do not treat them as evidence the market passed.

NBA moneyline and NBA totals start and stay in this state. NHL moneyline, NHL totals, MLB moneyline, MLB totals, and NFL totals start here as well. NFL moneyline stays here until a report on `nfl-selection-v1.0.1` (or a newer version) passes the gates above. The current model document already says the public board stays empty.

## Recommended order for the walk-forward harness

The next PR should still spend zero Odds API credits.

1. **Read-only inventory.** Count, per sport and per `h2h` / `totals`: games with a final score, games with a quote at least 60 minutes before start, games with a later pre-start close, and the min/max start dates. Sources: `Game`, `ArchivedGame`, `Odds`, `ClosingOdds`, `EdgeSnapshot.modelRun`, `InjuryReport`, `NhlStartingGoalie`. Print the counts. Do not invent a backfill.
2. **NFL moneyline harness.** First market with a versioned selection model, quote-pairing columns, a weekly key, and an existing `clvclose:` path (`--nfl-all`). Rebuild pre-lock form from finals. Do not score totals in this step. Do not set `eligibleForPublic`.
3. **NHL moneyline.** `nhl-gd-v0.2.0` already writes an edge, but there is no public game-line list entry and no game-line close capture. The harness can score only the triples the inventory finds. Goalie rows are optional inputs when `fetchedAt` is before lock.
4. **MLB moneyline, then MLB totals.** `v0.2.0` depends on probable pitchers. Use a pitcher only with a pre-lock timestamp; otherwise run a no-pitcher ablation and keep the market in shadow. Totals use the negative-binomial helper only as a scored hypothesis, not as a published model.
5. **NFL totals.** Blocked in the current model by `missing_validated_scoring_distribution`. Add a totals model only after the inventory shows enough finals and closes, and only inside the harness. A passing totals report is a separate market from step 2.
6. **NBA last.** No fetch, table, or model in this repo. Do not add an Odds API sport key in the harness PR. NBA stays shadow-only until stored games, prices, and scores already exist.
