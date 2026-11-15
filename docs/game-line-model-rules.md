# Game-line model rules

Status: **research contract**. Nothing in this document publishes a pick.

These rules apply to NFL, NHL, and MLB moneyline, spread, and game total
(over/under). They sit next to `docs/game-lines-eval-contract.md` (the
scoring math) and `docs/nfl-selection-model.md` (the NFL formulas).

Anthony's standing rule: **no moneyline or game over/under goes public
until a walk-forward backtest shows it would have beaten the closing
line.** Spreads use the same bar. A model that has not cleared this
document stays `eligibleForPublic=false`.

Current research NFL model: `nfl-selection-v1.1.0`  
Previous NFL heuristic (still scoreable, never public): `nfl-selection-v1.0.1`  
NHL: `nhl-gd-v0.2.0` (unchanged in this work)  
MLB: `v0.2.0` (unchanged in this work)

---

## Allowed pre-game inputs

An input is allowed only when it was knowable at that game's **pick-lock**.
Every feature carries two clocks:

- `observedAt` — when we stored the row
- `dataThrough` — the start of the last game included in the statistic

Both must be at or before pick-lock. A missing clock drops the feature.
It is not imputed.

| Input | What it is | What it is not |
| --- | --- | --- |
| **Matchup history** | Prior finals between these two teams whose result was already written before lock. | A current `Team` row, or `NFLMatchupHistory` with no pre-lock write time. |
| **Recent form** | Last completed games for each team whose result was written before lock. Rebuilt from `Game` / `ArchivedGame` scores. | ESPN `last10Record` / `avgPointsLast10` as a trailing 10-game window. Those columns are **season** totals. Season W-L and season points-for/against may be used as season strength when `statsDataThrough` and `statsCapturedAt` are both ≤ lock. |
| **Rest / travel** | ET days from each team's previous final start to this frozen start, using only a previous final whose result was available before lock. Unknown stays unknown. | Assuming a bye because the previous game is missing. |
| **Injuries** | `InjuryReport` rows from `scripts/fetch-injuries.js` (ESPN). `fetchedAt` is `observedAt`, `asOfDate` is `dataThrough`. Both ≤ lock. For each player, only the **latest** status at lock counts, so a later Active report replaces an older Out. | A snapshot fetched after lock. ORing every historical Out row. A missing snapshot stays missing. |
| **Starters / QB** | NFL: `Game.homeStartingQB` / `awayStartingQB` only when that row was written before lock. NHL: `NhlStartingGoalie` with `fetchedAt` ≤ lock; unconfirmed stays unconfirmed. MLB: probable pitchers only with a pre-lock write time. | Archive QB / pitcher fields with no pre-lock timestamp. |
| **Home / away** | The scheduled home team at the frozen start. One home-field term, not a second copy of home/away records. | Double-counting venue records on top of overall W-L. |

Weather is stored on some game rows but is **not** in the allowed list
until it has a pre-lock write time and a walk-forward of its own.

Live feeds, in-play odds, and the closing line itself are never model
inputs. The close is only a **score**.

---

## Lock time (no look-ahead)

Pick-lock is the decision clock for one event and one market.

**Default lock:** the latest eligible quote capture that is at least
**60 minutes** before the frozen scheduled start. If capture times tie,
use the later quote time (`quotedAt`), then the smallest capture id.

A book is eligible at a capture only when:

1. Both sides are present on that capture (home/away, over/under, or
   spread favorite/dog).
2. Totals and spreads quote one numeric line on both sides.
3. `quotedAt` is present, is at or before capture time (`Odds.ts` /
   `ClosingOdds.snapshot_at`), is before the frozen start, and is no
   older than 6 hours before the capture. A missing quote time is not
   treated as fresh. A quote after the capture is a clock error.

**Frozen start** is the scheduled `Game.date` known at lock. A later
postpone that moves the game does not slide the event into a later week.

**No input may be timestamped after this lock.** That includes:

- a final whose score was written after lock
- an injury or goalie row fetched after lock
- `Team.statsDataThrough` or `statsCapturedAt` after lock
- an odds row with `quotedAt` after lock
- the closing line (`clvclose:` rows, late `OddsSnapshot`, or a T−35
  `ClosingOdds` copy)

The close is loaded only after the model probability is frozen.

Walk-forward folds: NFL is one `Game.week` (or the ET Monday–Sunday of
the frozen start). NHL and MLB are one ET date. Training labels (season
W-L, form, matchup history, points) need a 24-hour embargo before the
test lock. Rest still uses the previous final whose result was already
written, even if that score is inside the embargo. The first fold is
warmup and does not count toward sample size. The next four folds are
development. Publish bars use the holdout after that.

---

## Publish bars

Working target: **about 200 games per sport per market**. Concrete
gates:

| Bar | Threshold | Why this number |
| --- | --- | --- |
| **Sample** | ≥ **200** decided games on the holdout, across ≥ **4** holdout folds (NFL weeks or NHL/MLB dates), with ≥ **4** development folds left before that holdout. | NFL plays 272 regular-season games. 200 is most of one season after bye/warmup weeks. A 200-game CLV average has a standard error around 0.3–0.4pp; smaller samples cannot tell +1pp from noise. NHL and MLB reach 200 faster; we do not lower the bar for them. |
| **Closing-line value** | Mean `clvProb` ≥ **+1.0 percentage point**, **and** at least **52%** of same-line bets beat the close. | Anthony's rule is "beat the close." `clvProb` is `implied(close) − implied(posted)`, vig still inside both, same as production. +1.0pp is a real gap after juice. 52% beat-close share is better than a coin flip with room for one cold week. Line-moved totals **and spreads** (lock line ≠ close line) are reported separately and excluded from this average. |
| **Accuracy** | Hit rate is **reported** (wins / (wins + losses); pushes out). No hard hit-rate floor. | Efficient markets can have a 51% hit rate at plus money and still be +EV. A 55% floor would reject honest favorites. |
| **Calibration** | Brier and log-loss of the model's lock-time probability **both beat** the no-vig closing probability on the same decided games. | If the close is a better probability than the model, we have no business publishing. Pushes are omitted from Brier/log-loss. No-bets stay in. Log-loss clips probabilities to `[0.001, 0.999]`. |

ROI at a flat 1 unit is reported. It is **not** a publish gate on its
own (variance is huge at 200 games). A negative ROI with a pass on CLV
and calibration still fails a human review, but the coded bars above
are CLV, beat-close share, Brier, log-loss, and sample.

If the holdout cannot supply 200 games, the market **fails for sample
size**. The harness does not lower the gate. The report must print
`SAMPLE_TOO_SMALL` in that case.

---

## How a model graduates to `eligibleForPublic`

Graduation is a **separate, reviewed change**. This repo never flips
the flag from a passing printout.

1. **Freeze the candidate.** Name the model version, the feature list,
   the lock rule, and the close rule *before* scoring the holdout.
   `nfl-selection-v1.1.0` is the current NFL research candidate.
   Changing a constant (home-field logit, market blend, scoring SD)
   is a new version.
2. **Run the walk-forward** (`node scripts/backtest-game-lines.js --summary`).
   Zero Odds API credits. Read-only. Replay each game using only rows
   timestamped before that game's lock. Score against the saved close
   (`quotedAt` on `Odds`, `ClosingOdds` ids starting `clvclose:`,
   `OddsSnapshot`, and `EdgeSnapshot` payloads).
3. **Pass every bar** in the table above on that frozen holdout, by
   sport **and** market. A moneyline pass does not publish totals.
   A totals pass does not publish spreads.
4. **Open a later PR** that sets `eligibleForPublic` only for that
   version and market, after a human reads the report. Production
   insert paths (`toNflEdgeSnapshotInsert`, `record-game-lines.js`)
   stay public-ineligible until that PR. Do not edit publish/record
   gating in the same change that adds a research model.

Until step 4, the public board stays empty. An honest empty board is
the intended product state.

---

## NFL research model `nfl-selection-v1.1.0`

Still **unvalidated**. Production writes `eligibleForPublic=false`.

- Moneyline: shrunk season W-L, shrunk point differential, home field,
  optional pre-lock form / rest / injuries / starting QB, then **blend
  35% of the model–market gap** and **clamp the remainder to 8pp**
  (12pp only when a starting QB is out). This is what stops 25-point
  win-probability gaps on big underdogs.
- Spreads: convert the blended win probability to an expected margin
  (unvalidated σ = 13.5) and score the posted home spread the same way,
  then blend/clamp toward the spread market.
- Totals: season points-for and points-against as a Normal mean,
  unvalidated σ = 13.5, continuity-corrected onto integer scores, then
  blend/clamp toward the totals market. This is the first totals path;
  it replaces `missing_validated_scoring_distribution` only when both
  teams have scoring averages **and** pass the same lock-time freshness
  gates as moneyline (season, captured-at, data-through, four-game
  sample). An injected scoring distribution does not skip those gates.

None of those σ values or blend weights are fitted on a holdout. They
are safeguards so the research numbers cannot run away from the market
without evidence.

---

## NHL notes (behavior unchanged)

`nhl-gd-v0.2.0` is left as-is. The backtest will score it when lock +
close + final triples exist.

Known behavior, not changed here:

- Moneyline skip guards (equal strength, min GP, missing GD, 25/75
  clamp, 8pp model–market gap) **return before** the totals heuristic,
  so those games also get a null total. That is documented in
  `lib/edge-nfl-nhl.js` as intended since PR #59.
- NHL totals still convert a point difference to a 3%-per-goal edge
  capped at 12%, **without** blending to the market over/under
  probability. That is the same class of bug the retired NFL heuristic
  had. Flag it in the backtest report; do not silently rewrite NHL.
- Split home/away records are ignored (ESPN no longer sends them).

If the walk-forward later shows a clear look-ahead in NHL, that is a
separate fix. Using the **current** `Team` row to score an old game
*would* leak the future; the harness rebuilds W-L and GF/GA from
finals whose results were available before lock, and does not feed
today's Team snapshot into a historical fold.

---

## MLB notes (behavior unchanged)

`v0.2.0` still requires probable pitchers. The harness may score it
only with pitcher ids whose write time is ≤ lock. No new public MLB
game lines.

---

## How to run the backtest

```bash
node scripts/backtest-game-lines.js --summary
```

Read-only. Zero Odds API credits. Prints counts, metrics by sport /
market / model version, and `SAMPLE_TOO_SMALL` when the holdout is
under 200 games. `--dry-run` is the same compact report without a
per-game dump. `--verbose` prints one line per scored game.

See `lib/game-line-backtest.js` and `lib/game-line-model-rules.js`.
