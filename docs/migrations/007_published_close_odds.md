# S1: Published closing-price capture + CLV

Executable SQL: `scripts/migrations/007_published_close_odds.sql`.
Rollback: `scripts/migrations/007_published_close_odds_rollback.sql`.
Both set `lock_timeout = '5s'`.

Do **not** add these columns to the Prisma `PropValidation` model until
the SQL has been applied. Prisma `findMany()` without an explicit
`select` would request the new scalars and fail on a pre-migration
database. Writers retry without the close columns on `PGRST204` / `42703`.

## How to apply (do not run from this PR)

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/007_published_close_odds.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` /
   additive and can be re-run.
4. Confirm with the `information_schema.columns` check in that file.

Do **not** apply from CI. Do not backfill. Do not regrade.

Rollback (same editor, do not run from CI):
`scripts/migrations/007_published_close_odds_rollback.sql` drops the
five columns. Captured closes are lost; recorded odds/grades stay.

## Capture strategy (quota-aware)

Morning ops already spends about **22 Odds API calls** on the full
slate. Do not re-run `fetch-live-odds` to get closes.

One laptop task at **:16 and :46 ET**, **record first, then capture**:

```
node scripts/record-mlb-window-props.js
node scripts/capture-published-closes.js --apply
# postseason (12–22 ET):
node scripts/record-mlb-window-props.js --postseason
node scripts/capture-published-closes.js --apply
```

(PowerShell: do **not** use `npm run capture:published-closes -- --apply`
— the `--apply` is eaten and the script dry-runs.)

Kill switch: `CLOSING_CAPTURE=0`. Caps: `--max-calls N` and
`--min-remaining N` (default 50 remaining credits).

The capture step takes **only** games that:

- have at least one Published-track pick still missing `closeOdds`
- start within the next **30 minutes**, and not within 2 minutes
- have not started

One HTTP call per such game:

```
GET /v4/sports/{sport}/events/{oddsApiEventId}/odds
  ?regions=us&markets={only the markets those picks need}&oddsFormat=american
```

Credits = **markets × regions** (we use `regions=us`, so 1 region).
A game with 2 markets costs 2 credits, not 1.

After a pick has `closeOdds`, later hours skip it. NHL is never
fetched. London NFL **9:30 AM ET** games are missed if this job only
runs in the MLB 11–22 ET window — their 60-minute close window is
8:30–9:30 ET.

### Per-day cost

| Slate | Typical games | HTTP calls / day | Credits / day (≈2 markets) |
| --- | --- | --- | --- |
| MLB regular day | 6–12 | 6–12 | 12–24 |
| NFL Sunday | 8–16 | 8–16 | 16–32 |
| NFL weeknight | 1–4 | 1–4 | 2–8 |
| Off day | 0 | 0 | 0 |

Monthly add vs a 20k quota: ~16 credits × 30 ≈ **480**, plus NFL
Sundays. Leave morning’s ~22/day alone.

## CLV headline

`clvProb = implied(close) − implied(recorded)` on the **same line**.
Beat-close = recorded decimal > close decimal.

Rows where `closeLine != threshold` (line moved; `matchClosingQuote`
fell back) are **excluded** from average CLV and % beat-close. The
report prints them separately.

## Impact analysis (no downtime)

| Surface | Impact |
| --- | --- |
| **Migration** | 5 nullable columns. `IF NOT EXISTS`. `lock_timeout 5s`. No backfill. |
| **DB / disk** | ~40 bytes × new Published rows. Existing rows stay NULL. |
| **API** | Laptop only. Credits = markets × regions. |
| **Vercel** | No new function, env, or build change. |
| **Downtime** | None. Additive ALTER + laptop script. Rollback drops columns only. |

## Owner commands

```
node scripts/capture-published-closes.js --dry-run
node scripts/capture-published-closes.js --apply
node scripts/report-published-clv.js
```
