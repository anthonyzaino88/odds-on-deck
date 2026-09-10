# nflverse rich-features study (research only, pass 2)

**Empirical from nflverse / Lee Sharpe `games.csv`. Not production-validated for betting.**

This is a second chronological pass on free nflverse fields. It does **not** enable public NFL selections, call The Odds API, write production Supabase, regrade picks, or merge.

| Constraint | Value |
| --- | --- |
| `eligibleForPublic` | `false` |
| Production DB writes | `false` |
| The Odds API | `false` |
| Regrade picks | `false` |
| Merge | `false` |

Generated at: `2026-09-10T02:28:51.033Z`

## Data

- Source URL: — (local file only)
- Local path: local cache of the nflverse file (not committed; rerun with `--input`)
- SHA-256: `144b181f03d672870ad25d80834598df8977f58464581f499218d490b8f1559d`
- Parsed / filtered / completed: **7548** / **7239** / **6967**
- Fit protocol: **expanding_prior_seasons** (coefficients for season S use only seasons < S)
- Minimum prior games per team: **4**
- Minimum train games before fitting extra coefficients: **200**

## Pre-registered stake rule

Declared before holdout ROI is inspected:

- Stake **1 unit** at the nflverse closing American price
- Bet the side with estimated EV > 0 at that close
- Skip if both sides have EV <= 0
- Ties / integer-total pushes refund (profit 0)
- Model-favorite betting is **secondary** and is not the claim

A candidate **beats the close** on this sample only if it has lower log-loss **and** lower Brier than the de-vig close **and** primary +EV ROI > 0. Market blends cannot beat the market by this definition.

## Methods

### Moneyline candidates

1. `shrunk_winpct` — pass-1 baseline: season-to-date win% with `(wins+8)/(games+16)` and HFA logit 0.12. No fitted coefficients.
2. `winpct_pd` — logistic on `[intercept, winpct_logit, pd_pg_diff]`. `pd_pg_diff` is season-to-date point differential per game (home minus away) from earlier same-season games only.
3. `winpct_pd_context` — same plus rest difference, division game, indoor roof (dome/closed), and weather when present (`temp`, `wind`; zeros plus a present flag when missing).
4. `market_blend` — `0.5 * P_market + 0.5 * P_winpct_pd_context`. **Uses the closing moneyline. Documented as a blend, not an independent edge.**

Rest, division, roof, and weather are taken from the current nflverse row (known before kickoff). Scoring features never include the game being predicted or a later game.

### Totals

Season-to-date offense/defense PPG, shrunk with k=4 toward prior-season league PPG (mean game total / 2):

`projected = (home_off + away_def + away_off + home_def) / 2`

σ is the prior season's completed-game-total standard deviation (fallback 14 only when season S-1 is missing). Integer-line pushes use the production Normal continuity correction. An expanding OLS (`a + b * projected`) calibrates the mean when enough prior rows exist.

Production still does **not** receive this distribution. `eligibleForPublic` stays false.

## Sample sizes by season

| Season | Scheduled | Completed | With ML | ML rows | With O/U odds | With weather |
| --- | --- | --- | --- | --- | --- | --- |
| 1999 | 248 | 248 | 0 | 184 | 0 | 192 |
| 2000 | 248 | 248 | 0 | 183 | 0 | 198 |
| 2001 | 248 | 248 | 0 | 184 | 0 | 200 |
| 2002 | 256 | 256 | 0 | 188 | 0 | 200 |
| 2003 | 256 | 256 | 0 | 189 | 0 | 200 |
| 2004 | 256 | 256 | 0 | 189 | 0 | 200 |
| 2005 | 256 | 256 | 0 | 190 | 0 | 205 |
| 2006 | 256 | 256 | 209 | 189 | 207 | 192 |
| 2007 | 256 | 256 | 255 | 190 | 255 | 192 |
| 2008 | 256 | 256 | 185 | 190 | 185 | 192 |
| 2009 | 256 | 256 | 242 | 190 | 242 | 183 |
| 2010 | 256 | 256 | 256 | 190 | 256 | 184 |
| 2011 | 256 | 256 | 256 | 192 | 256 | 183 |
| 2012 | 256 | 256 | 256 | 191 | 256 | 184 |
| 2013 | 256 | 256 | 256 | 191 | 256 | 184 |
| 2014 | 256 | 256 | 256 | 190 | 256 | 192 |
| 2015 | 256 | 256 | 256 | 191 | 256 | 192 |
| 2016 | 256 | 256 | 256 | 191 | 256 | 192 |
| 2017 | 256 | 256 | 255 | 191 | 255 | 192 |
| 2018 | 256 | 256 | 256 | 191 | 256 | 191 |
| 2019 | 256 | 256 | 256 | 191 | 256 | 190 |
| 2020 | 256 | 256 | 256 | 191 | 256 | 165 |
| 2021 | 272 | 272 | 272 | 208 | 272 | 182 |
| 2022 | 271 | 271 | 271 | 207 | 271 | 96 |
| 2023 | 272 | 272 | 272 | 208 | 272 | 150 |
| 2024 | 272 | 272 | 272 | 208 | 272 | 173 |
| 2025 | 272 | 272 | 272 | 208 | 272 | 177 |
| 2026 | 272 | 0 | 100 | 0 | 100 | 0 |

## Moneyline vs nflverse closes

No independent candidate beat the close on the pre-registered rule (lower log-loss **and** lower Brier **and** +EV ROI > 0). The market blend is excluded from that claim because it uses the close as an input.

| Candidate | Uses close? | n | Decisive | LL | LL mkt | Brier | Brier mkt | +EV ROI | +EV n | Beats close? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shrunk_winpct | no | 3885 | 3877 | 0.6435 | 0.6037 | 0.2260 | 0.2084 | -4.55% | 3649 | no (worse_or_equal_probability_scores) |
| winpct_pd | no | 3885 | 3877 | 0.6302 | 0.6037 | 0.2202 | 0.2084 | -5.08% | 3480 | no (worse_or_equal_probability_scores) |
| winpct_pd_context | no | 3885 | 3877 | 0.6307 | 0.6037 | 0.2206 | 0.2084 | -4.94% | 3463 | no (worse_or_equal_probability_scores) |
| market_blend | yes (uses close) | 3885 | 3877 | 0.6114 | 0.6037 | 0.2118 | 0.2084 | -3.88% | 3065 | no (uses_closing_market_as_input) |

### Expanding-fit coefficients (last holdout season with a fit)

- `shrunk_winpct`: no fitted season (insufficient prior games or unfitted baseline).
- `winpct_pd` (fit for 2025 on earlier seasons): intercept=0.248, winpct_logit=0.505, pd_pg_diff=0.055
- `winpct_pd_context` (fit for 2025 on earlier seasons): intercept=0.264, winpct_logit=0.506, pd_pg_diff=0.055, rest_diff=0.021, div_game=-0.141, is_indoor=-0.001, weather_present=0.053, wind_10=-0.016, temp_60_20=-0.070

## Totals vs closing total_line

Overall: n=5205, MAE vs model mean 10.90, MAE vs closing line 10.61, log-loss 0.7103 vs market 0.6932, Brier 0.2581 vs market 0.2500, primary +EV ROI -2.17% (n=3397).

Beats close on the pooled sample? **no (worse_or_equal_probability_scores)**

Single-season "yes" cells below are not a public-board enable. The pre-registered claim is the pooled row.

| Season | n | MAE | LL | LL mkt | +EV ROI | +EV n | Calib | Beats? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1999 | 184 | 11.83 | 0.6977 | — | — | 0 | identity_fallback | no |
| 2000 | 183 | 11.41 | 0.7082 | — | — | 0 | identity_fallback | no |
| 2001 | 184 | 11.35 | 0.7239 | — | — | 0 | expanding_prior_seasons | no |
| 2002 | 188 | 10.83 | 0.7271 | — | — | 0 | expanding_prior_seasons | no |
| 2003 | 189 | 11.14 | 0.7169 | — | — | 0 | expanding_prior_seasons | no |
| 2004 | 189 | 11.85 | 0.7206 | — | — | 0 | expanding_prior_seasons | no |
| 2005 | 190 | 10.59 | 0.7077 | — | — | 0 | expanding_prior_seasons | no |
| 2006 | 189 | 11.00 | 0.6916 | 0.6952 | 7.09% | 172 | expanding_prior_seasons | yes |
| 2007 | 190 | 11.63 | 0.7021 | 0.6943 | 5.25% | 172 | expanding_prior_seasons | no |
| 2008 | 190 | 10.64 | 0.7111 | 0.6945 | 4.39% | 166 | expanding_prior_seasons | no |
| 2009 | 190 | 10.48 | 0.6931 | 0.6944 | 9.62% | 167 | expanding_prior_seasons | yes |
| 2010 | 190 | 11.06 | 0.6900 | 0.6900 | -6.20% | 171 | expanding_prior_seasons | no |
| 2011 | 192 | 9.64 | 0.7114 | 0.6949 | -5.03% | 168 | expanding_prior_seasons | no |
| 2012 | 191 | 10.75 | 0.7187 | 0.6936 | -4.93% | 165 | expanding_prior_seasons | no |
| 2013 | 191 | 10.94 | 0.6814 | 0.6938 | 10.89% | 174 | expanding_prior_seasons | yes |
| 2014 | 190 | 12.02 | 0.7302 | 0.6934 | -21.22% | 162 | expanding_prior_seasons | no |
| 2015 | 191 | 10.60 | 0.7080 | 0.6929 | -11.95% | 171 | expanding_prior_seasons | no |
| 2016 | 191 | 9.50 | 0.7018 | 0.6936 | 3.90% | 168 | expanding_prior_seasons | no |
| 2017 | 191 | 11.21 | 0.7169 | 0.6926 | -6.28% | 175 | expanding_prior_seasons | no |
| 2018 | 191 | 10.87 | 0.7074 | 0.6936 | 1.82% | 173 | expanding_prior_seasons | no |
| 2019 | 191 | 10.53 | 0.6913 | 0.6913 | 8.07% | 160 | expanding_prior_seasons | no |
| 2020 | 191 | 10.83 | 0.7259 | 0.6951 | -12.28% | 161 | expanding_prior_seasons | no |
| 2021 | 208 | 11.40 | 0.7188 | 0.6897 | -6.28% | 184 | expanding_prior_seasons | no |
| 2022 | 207 | 10.92 | 0.7353 | 0.6925 | -13.77% | 183 | expanding_prior_seasons | no |
| 2023 | 208 | 10.80 | 0.7163 | 0.6934 | -5.60% | 164 | expanding_prior_seasons | no |
| 2024 | 208 | 10.06 | 0.7029 | 0.6923 | 4.65% | 169 | expanding_prior_seasons | no |
| 2025 | 208 | 10.61 | 0.7172 | 0.6937 | -5.26% | 172 | expanding_prior_seasons | no |

## Limitations

- Free nflverse consensus closes, not The Odds API quotes stored on the site.
- No QB, injuries, or efficiency metrics. Rest/weather coverage is incomplete (domes have no temp/wind).
- Expanding logistic / OLS coefficients are still a small linear model. They are not a validated betting system.
- `market_blend` uses the close. Better scores there are not an independent edge.
- First seasons fall back to the unfitted shrinkage baseline until 200 prior evaluable games exist.
- Honest losing or worse-than-market numbers are reported as-is. **Do not enable live public ML/totals from this pass.**
- Ask before adding paid data.

## How to rerun

```bash
node scripts/research/nflverse-rich-features-study.js --input /path/to/games.csv
```

CI uses `scripts/research/fixtures/nflverse-games-rich-snippet.csv` (no network).
