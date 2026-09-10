# Research scripts

Research-only helpers. They must not write production databases, regrade picks, merge, or flip public NFL eligibility.

| Script | Purpose | Network |
| --- | --- | --- |
| `nflverse-games-study.js` | Pass 1: shrinkage ML baseline + empirical totals distribution | Optional nflverse CSV download only |
| `nflverse-rich-features-study.js` | Pass 2: PD / rest / div / weather candidates + PPG totals vs close | Optional nflverse CSV download only |
| `nfl-cross-book-sides.js` | Model-free NFL ML/totals price gap (props formula) | None (local JSON) |
| `nfl-historical-clv-pilot.js` | Budgeted 2024 REG historical CLV (hard 3000-credit cap) | Odds API only with `--live` |

How to run and what the studies report: `docs/research/README.md`.
