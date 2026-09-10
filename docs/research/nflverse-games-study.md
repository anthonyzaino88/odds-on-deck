# nflverse offline games study (research only)

**Empirical from nflverse / Lee Sharpe `games.csv`. Not production-validated for betting.**

This artifact is a read-only study. It does **not** enable public NFL selections, call The Odds API, write production Supabase, regrade picks, or merge.

| Constraint | Value |
| --- | --- |
| `eligibleForPublic` | `false` |
| Production DB writes | `false` |
| The Odds API | `false` |
| Regrade picks | `false` |
| Merge | `false` |

Generated at: `2026-09-10T02:05:34.724Z`

## Data

- Source URL: [https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv](https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv)
- Local path: local cache of the nflverse file (not committed; rerun with `--input`)
- SHA-256 of the CSV text: `144b181f03d672870ad25d80834598df8977f58464581f499218d490b8f1559d`
- Parsed rows: **7548**
- Filtered rows: **7239** (regular season only)
- Completed rows: **6967**
- Season window: min available–max available
- Moneyline eligibility floor: both teams have **4** prior same-season games (matches `NFL_MIN_GAMES_FOR_RESEARCH_ML`)

Unplayed games (missing scores) are excluded from totals fits and moneyline scoring. 2026 rows in a live nflverse file are typically scheduled-only.

## Methods

### Filters

1. Keep `game_type = REG`. Playoffs (`WC`, `DIV`, `CON`, `SB`) are off unless `--include-playoffs`.
2. Preseason is not present in this file and is never added.
3. Chronology uses `gameday` then `gametime`. A prior game counts only when it is strictly earlier. Same-day games without both kickoff times do **not** update each other (no same-slate leakage).

### Totals distribution

Completed game totals (home score + away score) are summarized as a Normal(mean, variance) and discretized with the production continuity correction (`nflTotalOutcomeProbabilities`). Integer line L: estimated P(push) = P(T = L). Half-lines have zero push mass.

**This is an empirical nflverse description, not a production-validated betting model.** Production continues to refuse NFL totals (`missing_validated_scoring_distribution`). These parameters are not written into `EdgeSnapshot` and are not injected into live selection.

Chronological OOS: for holdout season S, fit on seasons before S only (n_train >= 30).

### Moneyline baseline

Walk-forward season-to-date win percentage, then the unvalidated production shrinkage and home-field logit:

```
pHat = (wins + 8) / (gamesPlayed + 16)
logit = log(pHat_home / (1 - pHat_home)) - log(pHat_away / (1 - pHat_away)) + 0.12
P(home) = 1 / (1 + exp(-logit))
P(tie)  = 0
```

Ties increment `gamesPlayed` but not wins (same as parsing an ESPN W-L-T string). Closing moneylines are nflverse consensus closes, **not** Odds API quotes. Market probabilities are proportional de-vig (`removeMlVig`).

Log-loss and Brier are computed on **decisive** games only (two-way market is conditional on no tie). Ties are scored as pushes in ROI.

### Flat-stake ROI

Stake is **1 unit** at the nflverse closing American price.

| Rule | Bet | Skip |
| --- | --- | --- |
| Model preferred | Side with model P > 0.5 | Exact 0.5 |
| Model +EV | Side with estimated EV > 0 at the close | Both EV <= 0 |
| Market favorite | Closing favorite by raw implied probability | Even implied |

Profit: win = `decimalOdds - 1`, loss = `-1`, push (tie) = `0`. ROI = total profit / number of bets. These are historical closes, not a live betting system.

## Sample sizes by season

| Season | Scheduled | Completed | REG | Playoffs | With ML | ML evaluable | With total line | Integer line | Ties |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1999 | 248 | 248 | 248 | 0 | 0 | 0 | 248 | 142 | 0 |
| 2000 | 248 | 248 | 248 | 0 | 0 | 0 | 248 | 136 | 0 |
| 2001 | 248 | 248 | 248 | 0 | 0 | 0 | 248 | 139 | 0 |
| 2002 | 256 | 256 | 256 | 0 | 0 | 0 | 256 | 127 | 1 |
| 2003 | 256 | 256 | 256 | 0 | 0 | 0 | 256 | 133 | 0 |
| 2004 | 256 | 256 | 256 | 0 | 0 | 0 | 256 | 160 | 0 |
| 2005 | 256 | 256 | 256 | 0 | 0 | 0 | 256 | 156 | 0 |
| 2006 | 256 | 256 | 256 | 0 | 209 | 188 | 256 | 164 | 0 |
| 2007 | 256 | 256 | 256 | 0 | 255 | 190 | 256 | 142 | 0 |
| 2008 | 256 | 256 | 256 | 0 | 185 | 179 | 256 | 126 | 1 |
| 2009 | 256 | 256 | 256 | 0 | 242 | 189 | 256 | 133 | 0 |
| 2010 | 256 | 256 | 256 | 0 | 256 | 190 | 256 | 111 | 0 |
| 2011 | 256 | 256 | 256 | 0 | 256 | 192 | 256 | 98 | 0 |
| 2012 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 129 | 1 |
| 2013 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 131 | 1 |
| 2014 | 256 | 256 | 256 | 0 | 256 | 190 | 256 | 122 | 1 |
| 2015 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 143 | 0 |
| 2016 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 132 | 2 |
| 2017 | 256 | 256 | 256 | 0 | 255 | 191 | 256 | 139 | 0 |
| 2018 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 138 | 2 |
| 2019 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 160 | 1 |
| 2020 | 256 | 256 | 256 | 0 | 256 | 191 | 256 | 145 | 1 |
| 2021 | 272 | 272 | 272 | 0 | 272 | 208 | 272 | 157 | 1 |
| 2022 | 271 | 271 | 271 | 0 | 271 | 207 | 271 | 143 | 2 |
| 2023 | 272 | 272 | 272 | 0 | 272 | 208 | 272 | 124 | 0 |
| 2024 | 272 | 272 | 272 | 0 | 272 | 208 | 272 | 119 | 0 |
| 2025 | 272 | 272 | 272 | 0 | 272 | 208 | 272 | 0 | 1 |
| 2026 | 272 | 0 | 272 | 0 | 100 | 0 | 100 | 0 | 0 |

ML evaluable = completed + both closing moneylines + both teams have at least 4 prior same-season games.

## Empirical game-total distribution

**Label: empirical from nflverse, not production-validated for betting.**

| Parameter | Value |
| --- | --- |
| n | 6967 |
| mean | 44.163 |
| variance (n−1) | 199.809 |
| sd | 14.135 |
| min / q25 / median / q75 / max | 3.0 / 34.0 / 44.0 / 53.0 / 106.0 |
| skewness | 0.318 |
| excess kurtosis | 0.109 |
| KS vs Normal | 0.0414 |
| Status | `empirical_from_nflverse_not_production_validated` |

### Integer-line push handling

NFL scores are integers, so a posted integer total can push. Half-points cannot.

| Closing-line diagnostic | Value |
| --- | --- |
| Games with a closing total line | 6967 |
| Integer closing lines | 3549 |
| Empirical P(push \| integer line) | 0.0279 |
| Normal continuity-corrected mean P(push) at those lines | 0.0266 |
| Mean game total | 44.16 |
| Mean closing total line | 43.48 |
| MAE(game total, closing line) | 10.62 |

Even-integer slice of P(T = L) vs the fitted Normal (in-sample, descriptive):

| Line L | Empirical P(T=L) | Normal P(T=L) |
| --- | --- | --- |
| 30 | 0.0268 | 0.0171 |
| 32 | 0.0138 | 0.0195 |
| 34 | 0.0253 | 0.0218 |
| 36 | 0.0235 | 0.0239 |
| 38 | 0.0205 | 0.0257 |
| 40 | 0.0326 | 0.0270 |
| 42 | 0.0152 | 0.0279 |
| 44 | 0.0379 | 0.0282 |
| 46 | 0.0202 | 0.0280 |
| 48 | 0.0283 | 0.0272 |
| 50 | 0.0222 | 0.0259 |
| 52 | 0.0205 | 0.0242 |
| 54 | 0.0204 | 0.0222 |
| 56 | 0.0086 | 0.0199 |
| 58 | 0.0198 | 0.0175 |
| 60 | 0.0075 | 0.0151 |

### Chronological out-of-sample totals (fit on earlier seasons only)

| Holdout | n train | n holdout | Train μ | Train σ | Holdout μ | MAE vs train μ | Emp. int. push | Pred. int. push |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2000 | 248 | 248 | 41.63 | 14.36 | 41.35 | 12.56 | 0.0368 | 0.0261 |
| 2001 | 496 | 248 | 41.49 | 14.91 | 40.42 | 11.60 | 0.0288 | 0.0254 |
| 2002 | 744 | 256 | 41.13 | 14.62 | 43.35 | 11.51 | 0.0236 | 0.0260 |
| 2003 | 1000 | 256 | 41.70 | 14.63 | 41.66 | 10.95 | 0.0301 | 0.0261 |
| 2004 | 1256 | 256 | 41.69 | 14.49 | 42.97 | 12.05 | 0.0125 | 0.0253 |
| 2005 | 1512 | 256 | 41.91 | 14.59 | 41.23 | 10.56 | 0.0385 | 0.0259 |
| 2006 | 1768 | 256 | 41.81 | 14.39 | 41.32 | 11.46 | 0.0793 | 0.0265 |
| 2007 | 2024 | 256 | 41.75 | 14.37 | 43.38 | 11.63 | 0.0423 | 0.0264 |
| 2008 | 2280 | 256 | 41.93 | 14.40 | 44.06 | 10.96 | 0.0714 | 0.0267 |
| 2009 | 2536 | 256 | 42.15 | 14.39 | 42.93 | 10.83 | 0.0376 | 0.0267 |
| 2010 | 2792 | 256 | 42.22 | 14.32 | 44.07 | 11.30 | 0.0450 | 0.0269 |
| 2011 | 3048 | 256 | 42.37 | 14.30 | 44.36 | 10.24 | 0.0306 | 0.0263 |
| 2012 | 3304 | 256 | 42.53 | 14.23 | 45.51 | 11.04 | 0.0155 | 0.0265 |
| 2013 | 3560 | 256 | 42.74 | 14.23 | 46.82 | 11.62 | 0.0229 | 0.0265 |
| 2014 | 3816 | 256 | 43.02 | 14.28 | 45.18 | 11.39 | 0.0164 | 0.0264 |
| 2015 | 4072 | 256 | 43.15 | 14.25 | 45.63 | 10.71 | 0.0350 | 0.0271 |
| 2016 | 4328 | 256 | 43.30 | 14.22 | 45.55 | 10.63 | 0.0076 | 0.0268 |
| 2017 | 4584 | 256 | 43.42 | 14.18 | 43.44 | 11.22 | 0.0000 | 0.0270 |
| 2018 | 4840 | 256 | 43.42 | 14.18 | 46.69 | 11.47 | 0.0217 | 0.0260 |
| 2019 | 5096 | 256 | 43.59 | 14.22 | 45.63 | 11.17 | 0.0063 | 0.0270 |
| 2020 | 5352 | 256 | 43.69 | 14.21 | 49.58 | 11.64 | 0.0345 | 0.0260 |
| 2021 | 5608 | 272 | 43.95 | 14.24 | 45.96 | 11.14 | 0.0191 | 0.0266 |
| 2022 | 5880 | 271 | 44.05 | 14.22 | 43.76 | 10.96 | 0.0210 | 0.0270 |
| 2023 | 6151 | 272 | 44.03 | 14.20 | 43.54 | 10.73 | 0.0161 | 0.0265 |
| 2024 | 6423 | 272 | 44.01 | 14.18 | 45.82 | 10.09 | 0.0252 | 0.0271 |
| 2025 | 6695 | 272 | 44.09 | 14.14 | 46.03 | 11.01 | — | — |

## Moneyline baseline vs nflverse closes

Evaluated games: **3885** (decisive **3877**, ties **8**).

| Score | Model | Market (de-vig close) | n |
| --- | --- | --- | --- |
| Log-loss (lower is better) | 0.6435 | 0.6037 | 3877 |
| Brier (lower is better) | 0.2260 | 0.2084 | 3877 |

A higher model log-loss or Brier than the market means this shrinkage baseline is **worse** than the close as a probability. That is an expected result for a season-record heuristic.

### Flat-stake ROI (1 unit at the close)

| Rule | n bets | Profit (u) | ROI |
| --- | --- | --- | --- |
| Model preferred (P > 0.5) | 3885 | -102.23 | -2.63% |
| Model +EV at the close | 3649 | -165.86 | -4.55% |
| Market favorite (comparison) | 3866 | -81.36 | -2.10% |

### Coarse calibration (decisive games, model P(home))

| Bin | n | Mean model P | Mean market P | Home win rate |
| --- | --- | --- | --- | --- |
| [0.00, 0.40) | 498 | 0.346 | 0.311 | 0.305 |
| [0.40, 0.50) | 1130 | 0.457 | 0.469 | 0.452 |
| [0.50, 0.60) | 1248 | 0.552 | 0.603 | 0.579 |
| [0.60, 1.00] | 1001 | 0.662 | 0.744 | 0.756 |

### By season

| Season | n | Decisive | LL model | LL mkt | Brier model | Brier mkt | Pref ROI | Pref n | +EV ROI | +EV n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2006 | 188 | 188 | 0.6651 | 0.6968 | 0.2365 | 0.2505 | -4.77% | 188 | 43.73% | 185 |
| 2007 | 190 | 190 | 0.6322 | 0.5546 | 0.2207 | 0.1881 | -2.99% | 190 | -20.91% | 184 |
| 2008 | 179 | 178 | 0.6298 | 0.5956 | 0.2197 | 0.2065 | 1.64% | 179 | 0.13% | 175 |
| 2009 | 189 | 189 | 0.6470 | 0.5957 | 0.2273 | 0.2040 | -12.31% | 189 | 16.46% | 182 |
| 2010 | 190 | 190 | 0.6507 | 0.6206 | 0.2296 | 0.2148 | 1.36% | 190 | -1.27% | 176 |
| 2011 | 192 | 192 | 0.6397 | 0.5976 | 0.2243 | 0.2060 | 0.90% | 192 | -8.44% | 183 |
| 2012 | 191 | 190 | 0.6450 | 0.5773 | 0.2266 | 0.1977 | -3.37% | 191 | -18.08% | 184 |
| 2013 | 191 | 190 | 0.6479 | 0.5940 | 0.2284 | 0.2031 | -7.42% | 191 | -18.84% | 182 |
| 2014 | 190 | 189 | 0.6318 | 0.5887 | 0.2201 | 0.2017 | 2.74% | 190 | -6.85% | 180 |
| 2015 | 191 | 191 | 0.6549 | 0.6556 | 0.2314 | 0.2315 | -6.04% | 191 | 15.79% | 179 |
| 2016 | 191 | 189 | 0.6307 | 0.6076 | 0.2199 | 0.2103 | 6.87% | 191 | -3.31% | 179 |
| 2017 | 191 | 191 | 0.6346 | 0.5662 | 0.2219 | 0.1903 | -2.60% | 191 | -25.47% | 175 |
| 2018 | 191 | 191 | 0.6526 | 0.5991 | 0.2305 | 0.2068 | -8.71% | 191 | -12.72% | 180 |
| 2019 | 191 | 191 | 0.6418 | 0.6151 | 0.2248 | 0.2128 | 4.70% | 191 | -0.14% | 182 |
| 2020 | 191 | 191 | 0.6361 | 0.5961 | 0.2219 | 0.2043 | -4.18% | 191 | -1.35% | 182 |
| 2021 | 208 | 207 | 0.6686 | 0.6213 | 0.2377 | 0.2161 | -11.39% | 208 | 2.58% | 200 |
| 2022 | 207 | 206 | 0.6430 | 0.5943 | 0.2258 | 0.2043 | -3.50% | 207 | -17.68% | 189 |
| 2023 | 208 | 208 | 0.6678 | 0.6280 | 0.2374 | 0.2190 | -9.02% | 208 | -10.08% | 180 |
| 2024 | 208 | 208 | 0.6121 | 0.5498 | 0.2109 | 0.1831 | 8.10% | 208 | -29.05% | 185 |
| 2025 | 208 | 208 | 0.6362 | 0.6199 | 0.2228 | 0.2173 | -2.06% | 208 | 3.77% | 187 |

## Limitations

- **Not a green light for the public board.** `eligibleForPublic` stays false. This study does not change enable switches.
- Closing moneylines and totals are nflverse / Lee Sharpe consensus history, not the sportsbook quote the site would store from The Odds API. Do not treat these as CLV versus our production books.
- No quarterbacks, injuries, weather, rest beyond what is implicit in W-L, or efficiency metrics.
- Home-field `0.12` logit is conventional, not fitted. Neutral-site games still receive it when playoffs are included.
- Early-season games are dropped until both clubs have 4 prior games. That matches the production floor; it is not a claim that n ≥ 4 is sufficient.
- Moneyline coverage in nflverse is sparse before 2010. Sample-size columns show the holes; they are not filled in.
- The Normal totals fit ignores discrete scoring (3s, 7s, 8s) beyond a continuity correction. KS and push-rate gaps are expected.
- ROI uses closes, so it is not a bettable pre-game edge and includes vig. Honest losing ROIs are reported as-is.
- No paid data was used. **Ask before adding any paid feed.**

## How to rerun

See `docs/research/README.md`. Default path:

```bash
node scripts/research/nflverse-games-study.js --input /path/to/games.csv
```

CI uses `scripts/research/fixtures/nflverse-games-snippet.csv` and does not touch the network.
