# Projection-model proposal (player props)

Status: **proposal only**. No code in this PR. Public Quality Score,
Published recording, and the ROI card stay as they are until a later
implementation PR is reviewed.

This is the fourth item from the October 2026 profitability review.
Companion PRs (independent, merge in any order after reading):

- Honest Published record (legacy NFL filter)
- MLB lineup-window recording
- S1 closing-price capture + CLV (`docs/migrations/007_published_close_odds.md`
  on that branch)

## What we have today is not a projection

`scripts/fetch-live-odds.js` `buildLineShoppingEdges` does this:

1. Collect every book’s Over/Under price for the same player / market / line.
2. De-vig each book’s two-way pair (or apply a flat ~4.5% haircut when
   the pair is missing).
3. Average those vig-free probabilities → “consensus.”
4. Take the **best** decimal on our side.
5. `edge = (consensus − bestImplied) / consensus`.

`lib/quality-score.js` then scores:

```
QS = 100 × (0.50 × probability + 0.20 × book-count confidence + 0.30 × capped edge)
```

`PlayerPropCache.projection` exists on the schema and is unused as a
model output. Probability is the vig-free consensus, not P(stat >
line) from a player model.

That is **line shopping**: we are asking whether one book is off the
other books. It can be a real, small edge when a book is stale or
soft. It is not a statement about the player. The October review’s
honest Published sample (DNP voids + legacy NFL removed) sat near
breakeven. That is what a shopper of consensus prices should look
like after juice.

## Why beating prop markets is hard

Player-prop books are sharper than they were five years ago, and the
Published band (−200 to +250) is exactly where the juice is efficient.

- **Small samples.** A starter gets ~4 PA. Hits, total bases, and
  pitcher outs are high-variance counts. A well-calibrated 54% pick
  still loses a lot of days.
- **The close is the judge.** If we cannot beat the last price before
  first pitch on average, we do not have information. ROI over a few
  hundred picks has a standard error of several ROI points (the review
  quoted ~3.9% on 740). A +1.7% ROI after DNP voids is not
  distinguishable from zero.
- **Leakage is easy.** Fitting on the same `PropValidation` rows we
  later “backtest,” or using post-game box scores as if they were
  known at record time, will invent an edge. Random train/test splits
  leak future form into the past.
- **Selection bias.** We only recorded props that already cleared
  QS ≥ 40 and edge > 0. A model trained only on that subset learns
  “which shopped lines we liked,” not “what the player does.”
- **DNP / lineup risk** is not model edge. Recording before lineups
  (the MLB morning-ops problem) manufactured losses that looked like
  bad projections. Fix that operationally first (lineup-window PR).
- **Paid feed temptation.** We will not add a new paid API to “get a
  model.” ESPN, MLB Stats API, and the existing Odds API budget are
  the ceiling until the owner says otherwise.

A realistic bar: after a season of honest CLV capture, average CLV
slightly positive on a pre-registered slate, then ROI. Most amateur
prop models never clear the first bar.

## Stage 0 — measure (depends on S1, no model)

Do not fit anything until we can score against the close.

1. Apply `007_published_close_odds.sql` and run
   `scripts/capture-published-closes.js` hourly at :16 ET.
2. Read `scripts/report-published-clv.js` weekly. Lock the definitions:
   - `clvProb = implied(close) − implied(recorded)`
   - beat-close = recorded decimal > close decimal
   - same-line vs line-moved reported separately
3. Keep the line-shopper running. It is the **baseline**, not the
   opponent. A new model must beat *its* CLV and *its* log-loss, not
   a coin flip.

Success for Stage 0: a few hundred Published rows with non-null
`closeOdds`. Failure: we skip this and start fitting. That is how
fake edges get shipped.

## Stage 1 — MLB counting props (first sport)

Start here because we already grade from the MLB Stats API box score
(`lib/mlb-stat-grade.js`, `lib/db.js` `fetchMlbBoxScore`) and we
already archive those boxes to laptop JSONL
(`research/archive/box-scores/`, written from
`scripts/validate-pending-props.js`). The Published card is MLB-heavy.

### Markets in scope

| Market | Why first |
| --- | --- |
| `batter_hits` / 0.5 and 1.5 | Highest Published volume; Poisson-like; DNP now voided |
| `pitcher_strikeouts` | Starter-only once the lineup window confirms the probable/starting pitcher |
| `batter_total_bases` | Same PA process as hits; slightly noisier |

Leave home runs, steals, and pitcher outs for Stage 1b after hits/Ks
show positive CLV.

### Features we already collect (no new paid API)

Build a **pre-game feature snapshot** from data already in the repo
or pulled from the same free vendors morning/hourly ops already hit.

From `Game` / `Team` / `Player` / `Lineup`:

- Confirmed batting-order slot and side (lineup-window PR).
- Probable / confirmed starter (`probableHomePitcherId`,
  `probableAwayPitcherId`, Stats API `probablePitcher`).
- Park factor (`Team.parkFactor`) — use as a covariate, not as a
  2% edge by itself.
- Handedness (`Player.bats`, `Player.throws`).
- Home/away.

From box-score archives + Stats API game logs (same host we grade
with, `statsapi.mlb.com`):

- Batter: PA, AB, H, TB, BB, K, HBP, vs RHP / vs LHP over the last
  N games **strictly before** the target first pitch.
- Pitcher: TBF, K, BB, H, IP over the last N starts, plus season
  K/TBF.
- Opponent starter identity, so the batter’s vs-R/L split matches
  the actual pitcher, not the season blend.

From `SplitStat` / `PitchMix` (schema already exists): only if the
rows are populated at predict time. If they are stale or empty, the
feature is missing — same honesty rule as
`docs/nfl-selection-model.md` (`missing_team_data`, not a made-up
average).

From the Odds API **once**, at record time (already paid for by
morning or the close-capture call): the posted line and best price.
The model must emit P(over) **before** looking at edge. Edge is
`P_model − implied(best price)`, never the reverse.

### Model (keep it small)

First implementation: **independent Poisson / negative-binomial rate
for the counting stat**, with a log-link linear predictor.

```
λ_hits = exp(β0 + β_form·log(recent_H/PA) + β_opp·log(pitcher_H/TBF)
             + β_park + β_hand + β_home + β_order)
P(H > L) = 1 − F_pois(⌊L⌋; λ × expected_PA)
```

Expected PA from lineup slot (leadoff ~ 4.7, 9-hole ~ 3.7) × game
environment, not from “he usually gets 4.” Pitcher Ks use TBF
instead of PA.

Do **not** start with gradient boosting, player embeddings, or a
neural net. With a few thousand honest game-logs and a few hundred
Published labels we will overfit immediately.

Refuse to emit a pick when any required feature is missing, the
lineup is unconfirmed, or the game has started. Same spirit as the
NFL sides model: ineligible ≠ 50%.

## Stage 2 — NHL shots / SOG

Second because we already grade NHL SOG (`lib/nhl-stat-grade.js`)
from ESPN box scores, and `lib/nhl-matchups.js` already pulls team
shot rates from those summaries. Published still excludes NHL from
the public card; the research track can score NHL internally without
changing `PUBLISHED_SPORTS`.

Features (already fetched or fetchable from ESPN, no new API):

- Player SOG per 60 and TOI over last N games (from archived /
  ESPN summaries).
- Team shot rate and opponent shots-against.
- Home/away, expected starter (if ESPN has it), rest days.

Same Poisson/NB + chronological backtest. Do not promote NHL onto
the Published card until Stage 0 CLV exists for MLB *and* the NHL
research book is positive CLV on its own.

NFL receiving/rushing props wait. The independent NFL box archive
(`scripts/archive-nfl-box-scores.js`, ESPN public summaries) is the
right feature store, but the honest Published NFL sample after the
legacy filter is small and the market is sharper. Revisit after MLB
Stage 1 clears its CLV bar.

## Honest out-of-sample backtest

Use the graded `PropValidation` history as the **label store**, not
the training matrix.

### Labels

- Result: `correct` / `incorrect` / `void` (DNP voids stay voids;
  do not recode them as losses to “teach” the model about lineups).
- Actual: `actualValue` when present.
- Price: recorded `odds` for ROI; `closeOdds` for CLV once S1 has
  run long enough. Until then, CLV backtests are **unavailable** —
  do not invent a close from `PlayerPropCache` or
  `snapshot-closing-lines.js` (that script snapshots the `Odds`
  table, not a true pre-start prop close).

### Features must be as-of

For each graded row, rebuild features from box scores and team stats
with `game.date < target.date` only. A 2026-07-15 pick may not see
the 2026-07-14 box if that file was written after first pitch of
the 15th — if `fetched_at` is after `target.date`, drop the game
from the trailing window.

Do not train on `edge`, `qualityScore`, `probability`, or
`notes = cohort:published`. Those are outputs of the shopper.

### Split

Walk-forward, chronological:

1. Train on games through date T.
2. Predict games in (T, T + 14 days].
3. Step T forward two weeks.
4. Never shuffle. Never k-fold across seasons as if games were i.i.d.

Hold out the most recent 3–4 weeks entirely until the model is
frozen. Report that holdout last.

### Metrics (pre-register these)

| Metric | Why |
| --- | --- |
| Mean CLV (`clvProb`) and % beat-close | First hurdle. No CLV → stop. |
| Log-loss vs the recorded implied probability | Is P_model better calibrated than the shopper? |
| Brier vs the same | Same question, squared. |
| ROI at 1u, Published band only | Last hurdle. Noisy. Needs the holdout, not the train window. |
| Calibration buckets | 10 bins of P_model. A 60% bucket that hits 48% is a fail. |

Publish sample size, date range, sport, and the exact filter
(`isPublishedPick` after the legacy rule, or “all graded MLB hits
overs”). A backtest that only keeps winners is not a backtest.

Compare three books on the **same** holdout:

1. Line-shopper (today’s production).
2. Projection model, take when `EV > 0` and QS_ev ≥ 40.
3. Projection model **plus** line-shop (require both EV > 0 and
   shopper edge > 0). (3) is allowed as a production candidate; (2)
   is the scientific test.

## Replace Quality Score with EV

Today QS rewards consensus probability and book count — the shopper’s
self-confidence. An EV score should be:

```
EV_u = P_model × (decimal − 1) − (1 − P_model)     # push mass = 0 on half-lines
QS_ev = 100 × clip( (EV_u / 0.15) × 0.70 + 0.30 × size_penalty , 0, 1)
```

- `P_model` is the projection, **not** the vig-free consensus.
- `decimal` is the best available book at record time (already what
  we store).
- `size_penalty` shrinks QS when trailing PA/TBF or game-log n is
  below a floor (e.g. < 40 PA or < 4 starts). Small n cannot print
  Elite.
- Book count may remain as a **tie-break** or a “price is real”
  check (numBooks ≥ 2). It does not get 20% of the score.

Production switch (later PR, not this one):

1. Compute both QS_old and QS_ev. Log both on the persist payload
   (notes or a new nullable column — additive SQL, not a rewrite).
2. Record to Published only when the **old** rule would have, until
   Stage 1 holdout CLV is positive. Dual-write, single-publish.
3. Flip the recording gate to QS_ev in its own PR after the holdout
   is posted.

Do not silently change `calculateQualityScore` in place. The public
card and the 740-pick history are defined on the current formula.

## What success looks like

**Gate A — CLV (required):** on the frozen holdout, mean `clvProb` >
0 and % beat-close > 50% with a 95% CI that does not sit entirely
below 50%, sample ≥ 200 Published-band picks. If S1 has not produced
200 closes yet, wait.

**Gate B — probability skill:** holdout log-loss strictly better than
the line-shopper on the same picks.

**Gate C — ROI (only after A and B):** holdout 1u ROI > 0. Treat
anything under ~2× the review’s SE as “interesting, keep running,”
not “ship a bigger unit size.”

If A fails, the model does not go to production. If A passes and C
fails, we may still record for research (shadow Published) because
CLV is the leading indicator; ROI can lag.

Failure modes to write down in the first implementation PR:

- Positive train CLV, negative holdout CLV → leaked features or
  overfit. Delete the fit.
- Positive CLV, terrible calibration → we are getting lucky on price
  movement, not predicting the stat. Do not raise units.
- Model only beats the shopper on juice-trap unders → we already
  banned those. Do not relax `isJuiceTrap`.

## Implementation sketch (later PRs, not this file)

1. `lib/prop-projection.js` — pure feature assembly + Poisson/NB CDF.
   No Supabase, no Odds API.
2. `scripts/backtest-prop-projection.js` — read-only, laptop,
   `createScriptSupabaseClient`, dry-run default. Prints the three
   books and the metric table. Never writes `PropValidation`.
3. Laptop feature store: join `research/archive/box-scores/*.jsonl`
   with `Game` dates. Do not copy the JSONL into Supabase (disk
   pressure is why Path B exists).
4. Persist a `modelRun` string (see `docs/nfl-selection-model.md` /
   EdgeSnapshot) when we dual-write QS_ev.
5. Tests: CDF identities, as-of date cuts, missing-feature refusal,
   “would not emit after first pitch,” and a tiny fixture of 3–5
   rebuilt rows whose λ is hand-checked.

Ask before adding paid Statcast, SportsDataIO, or a second odds
vendor. The Odds API budget stays on morning ops + S1 close capture.

## Candid timeline of difficulty

Building the Stage 1 *code* is a bounded change: one lib, one
backtest script, tests, no production gate flip. Getting Gate A to
pass is the hard part and may not happen this season. Prop markets
on hits and pitcher Ks are well shopped; our advantage, if any, is
fresher lineup/PA information and refusing bad spots, not a secret
hit-rate. If the holdout is flat, the right product decision is to
keep the shopper, keep S1 CLV, and keep DNP/lineup hygiene — not to
add more features until they hurt.
