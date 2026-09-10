# Path B local archives

Prop-line and box-score archives used to live in Supabase (`ArchivedPropLine`, `GameBoxScore`) and were the main disk-pressure source. New writes go to **daily JSONL files on the operator laptop** (this checkout). Closing odds stay in Supabase.

## Layout

Agreed Windows parent: `C:\Users\zaino\Desktop\Odds on Deck\research\archive\`

| Folder | Source table | Daily file |
| --- | --- | --- |
| `prop-lines/` | ArchivedPropLine | `prop-lines-YYYY-MM-DD.jsonl` |
| `box-scores/` | GameBoxScore | `box-scores-YYYY-MM-DD.jsonl` |

When env vars are unset, scripts resolve those folders **relative to the repo root**, so the Desktop checkout just works:

- `research/archive/prop-lines`
- `research/archive/box-scores`

Directories are created on write if missing. `*.jsonl` under this tree is gitignored — do not commit dump data. `.gitkeep` files keep the empty folders in git.

Dates in filenames are **UTC** calendar days.

## Env overrides (optional)

```
ARCHIVE_PROP_LINES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\prop-lines
ARCHIVE_BOX_SCORES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\box-scores
```

## What writes here

- `scripts/clear-stale-props.js` — stale/expired/past-game `PlayerPropCache` rows, then deletes those cache rows as before.
- `scripts/snapshot-closing-lines.js` — prop snapshot section only. **ClosingOdds still inserts into Supabase** (needed by `close-stuck-parlays`).
- `scripts/validate-pending-props.js` — MLB box-score archive after grading. Grading itself still uses ESPN/MLB vendor APIs, not these files.

Field names stay snake_case, matching today’s insert shapes (`prop_id`, `game_id`, `player_name`, `stats`, …).

## One-time export from Supabase

Reads both tables (service/secret key, same as other scripts). **Does not truncate or delete.**

```
node scripts/export-supabase-archives-to-jsonl.js --dry-run
node scripts/export-supabase-archives-to-jsonl.js
```

Rows are split by day (`archived_at` / `game_time` for props, `fetched_at` for box scores). Re-running the export **appends** again — verify files before a second pass.

## Truncate is a separate manual step

Only after you have opened the JSONL files and checked counts, reclaim disk in the **Supabase SQL editor**:

```sql
TRUNCATE TABLE "ArchivedPropLine";
TRUNCATE TABLE "GameBoxScore";
VACUUM "ArchivedPropLine";
VACUUM "GameBoxScore";
```

Do **not** truncate `ClosingOdds`, `PlayerPropCache`, `Game`, `PropValidation`, or `ArchivedGame`. Do **not** apply migration 004 as part of this move.
