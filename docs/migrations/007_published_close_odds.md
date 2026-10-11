# S1: Published closing-price capture + CLV

Executable SQL: `scripts/migrations/007_published_close_odds.sql`.

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

## Capture strategy (quota-aware)

Morning ops already spends about **22 Odds API calls** on the full
slate. Do not re-run `fetch-live-odds` to get closes.

Instead, an hourly laptop job (same :16 ET slot as MLB window
recording, or right after it) captures **only** games that:

- have at least one Published-track pick (`source=system_generated`,
  edge > 0, QS ≥ 40, MLB/NFL) still missing `closeOdds`
- start within the next **90 minutes**
- have not started

One HTTP call per such game:

```
GET /v4/sports/{sport}/events/{oddsApiEventId}/odds
  ?regions=us&markets={only the markets those picks need}&oddsFormat=american
```

After a pick has `closeOdds`, later hours skip it. We never fetch a
game twice for close, and we never fetch NHL (not on the Published
card).

### Per-day call cost

| Slate | Typical games with Published picks | HTTP calls / day |
| --- | --- | --- |
| MLB regular day | 6–12 | 6–12 |
| NFL Sunday | 8–16 | 8–16 |
| NFL weeknight | 1–4 | 1–4 |
| Off day | 0 | 0 |

Credits: The Odds API bills some plans per market. We request **only
the markets on those picks** (often 1–3: `batter_hits`,
`batter_total_bases`, `player_receptions`), not the morning 8–10
market bundle. Worst case still far cheaper than re-running morning
ops.

Monthly add vs a 20k quota: ~8 calls × 30 days ≈ **240**, plus NFL
Sundays. Leave morning’s ~22/day alone.

## Impact analysis (no downtime)

| Surface | Impact |
| --- | --- |
| **Migration size** | 5 nullable columns on `PropValidation`. `IF NOT EXISTS`. No index required for the first year of volume. No backfill. |
| **DB / disk** | ~40 bytes × new Published rows going forward (~5–20/day). Existing ~18k PropValidation rows stay NULL. No rewrite of `odds` / `result`. |
| **API calls** | See table above. Laptop only. Not a Vercel cron. |
| **Vercel** | No new serverless function, no new env, no build change. The public card does not read `closeOdds` yet. |
| **Downtime** | None. Additive columns. App code writes them when present and retries without them if the SQL has not been applied. Reads of the Published ROI card are unchanged. |

The owner’s “no downtime before infrastructure changes” bar is met:
this is a nullable ALTER plus a laptop script.

## Owner commands

Preview (no Odds API, no writes) — lists games/picks that would be
fetched:

```
node scripts/capture-published-closes.js --dry-run
```

`--apply` refuses if the 007 columns are missing (dry-run still lists
the in-window games). After the SQL is in (writes `closeOdds`; calls
the Odds API):

```
node scripts/capture-published-closes.js --apply
```

Schedule on the ops laptop at **:16 ET or later**, hourly. Do not add
it to the :09 job (`:05–:15` is a no-write window; the script exits 0).

Read-only CLV report (after some closes exist):

```
node scripts/report-published-clv.js
```

or `npm run report:published-clv`.

## What success looks like

`summarizePublishedClv` reports average CLV (implied-probability
points) and the share of Published picks that beat the close. Positive
average CLV is the first bar for a real projection model. ROI comes
after. See `docs/projection-model-proposal.md` if that file is on
the branch; otherwise it ships in the companion docs PR.
