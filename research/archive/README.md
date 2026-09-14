# Path B local archives

Prop-line and box-score archives used to live in Supabase (`ArchivedPropLine`, `GameBoxScore`) and were the main disk-pressure source. New writes go to **daily JSONL files on the operator laptop** (this checkout). Closing odds stay in Supabase.

## Layout

Agreed Windows parent: `C:\Users\zaino\Desktop\Odds on Deck\research\archive\`

| Folder | Source | Files |
| --- | --- | --- |
| `prop-lines/` | PlayerPropCache snapshots + stale-cache archive | `prop-lines-YYYY-MM-DD.jsonl` |
| `box-scores/` | MLB GameBoxScore (unchanged) | `box-scores-YYYY-MM-DD.jsonl` |
| `box-scores/nfl/` | Independent NFL box scores (this job) | `index.jsonl`, `raw/{eventId}/vN.json`, `normalized/{eventId}/vN.json`, `games/{eventId}.jsonl` |

When env vars are unset, scripts resolve those folders **relative to the repo root**, so the Desktop checkout just works:

- `research/archive/prop-lines`
- `research/archive/box-scores`
- `research/archive/box-scores/nfl`

Directories are created on write if missing. `*.jsonl` under this tree is gitignored — do not commit dump data. `.gitkeep` files keep the empty folders in git.

Dates in filenames are **UTC** calendar days.

## Env overrides (optional)

```
ARCHIVE_PROP_LINES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\prop-lines
ARCHIVE_BOX_SCORES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\box-scores
ARCHIVE_NFL_BOX_SCORES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\box-scores\nfl
NFL_ARCHIVE_SEASON=2026
```

`NFL_ARCHIVE_SEASON` is the configured current NFL season for audit/backfill. If unset, January–February use the previous calendar year (playoffs); otherwise the current UTC year.

## What writes here

- `scripts/clear-stale-props.js` — stale/expired/past-game `PlayerPropCache` rows. Archive write is verified first; **deletion is aborted if archive read/write fails**. Deletes match `id` + `fetchedAt` so a refresh between capture and delete is left alone.
- `scripts/snapshot-closing-lines.js` — prop snapshot section only. **ClosingOdds still inserts into Supabase** (needed by `close-stuck-parlays`).
- `scripts/validate-pending-props.js` — MLB box-score archive after grading. Grading itself still uses ESPN/MLB vendor APIs, not these files. NFL/NHL games are **not** archived from pending props (games without pending rows would be missed).
- `scripts/archive-nfl-box-scores.js` — independent NFL outcome archive from public ESPN endpoints.

Field names stay snake_case (`prop_id`, `game_id`, `player_name`, `stats`, …).

## NFL box-score archival (independent of PropValidation)

Completed NFL games are discovered from the ESPN scoreboard for an explicit season / week / date range. Elapsed kickoff time is **not** treated as final. The summary endpoint must report the game complete and include a box score.

Each successful write stores:

1. The **raw** ESPN summary JSON (`raw/{eventId}/vN.json`)
2. A **versioned normalized** record (`normalized/{eventId}/vN.json`) with provider event/player/team IDs, season/week, game time, `fetched_at` (actual capture time), source, and schema version
3. An append-only `index.jsonl` row — only after (1) and (2) are written **and verified**

Missing statistics stay `null`. A recorded `0` is a real zero. Absent categories are omitted (not inferred as DNP).

Reruns are idempotent: the same observation hash is a no-op. A later ESPN correction writes `vN+1` and becomes the latest complete version. Existing MLB JSONL files and prior NFL versions are left in place.

### Operator commands (archive-only — no cache cleanup)

Read-only coverage audit against completed games in the configured current season:

```
npm run archive:nfl:audit
node scripts/archive-nfl-box-scores.js --audit --season 2026
```

Archive-only backfill from public ESPN endpoints (no Odds API, no paid historical requests):

```
npm run archive:nfl -- --season 2026 --from 2026-09-04 --to 2026-09-14
node scripts/archive-nfl-box-scores.js --season 2026 --week 1
node scripts/archive-nfl-box-scores.js --event 401547353
node scripts/archive-nfl-box-scores.js --dry-run --season 2026 --week 1
```

The job **never** runs `clear-stale-props` and **never** deletes archive files.

### Coverage report fields

The audit/archive stdout reports:

| Field | Meaning |
| --- | --- |
| Expected games | Completed ESPN events in the requested season/date range |
| Complete archives | Events with a verified complete index version |
| Missing games | Expected completed events with no complete archive yet |
| Failed fetches | Scoreboard/summary HTTP or parse failures |
| Unresolved identities | Archived games whose players/teams lack provider IDs |
| Expected / archived date coverage | UTC calendar days actually seen on events vs index |

### Verify one archived game against its source

1. Note `provider_event_id` (ESPN event id) from the coverage report or `index.jsonl`.
2. Open `research/archive/box-scores/nfl/raw/{eventId}/vN.json` and `normalized/{eventId}/vN.json` (latest complete `N` from the index).
3. Confirm `header.id` equals `provider_event_id`.
4. Confirm `header.competitions[0].status.type.completed` is true (or `STATUS_FINAL`).
5. Pick one athlete from `boxscore.players[].statistics[].athletes[]` and match `athlete.id`, `displayName`, team id, and a stat (empty source values must be `null` in normalized, not `0`, unless the source literally sent `0`).
6. Confirm `fetched_at` is the time this machine captured the file — **not** backdated to `game_time`. Capture time is never a historical quote.

### Repeatable postgame run and later correction refresh

After games (same checkout the operator already uses for `validate:all`):

```
npm run validate:all
node scripts/archive-nfl-box-scores.js
```

Later the same day or mid-week, run the **same** archive command again. Identical box scores are no-ops; ESPN stat corrections write a new version. Do not add Odds API fetches.

### NHL

NHL box-score archival is a follow-up. Do not treat this NFL job as a multi-sport modeling pipeline.

## Prop-line timestamps

New prop-line archive rows keep these clocks distinct:

| Field | Meaning |
| --- | --- |
| `quote_ts` | Bookmaker/source quote time **if ingestion already stored it** |
| `quote_ts_status` | `source` or `unknown` |
| `fetched_at` | `PlayerPropCache.fetchedAt` (cache capture) |
| `archived_at` | When this JSONL line was written |
| `odds_format` | Explicit format of stored odds (`american` here) |
| `num_books` | `numBooks` when known; otherwise omitted/null |

`PlayerPropCache` does not currently persist Odds API `last_update`. When that field is absent, `quote_ts_status` is `unknown`. Archiving an old cached price **now** is not a current or closing quote. This change does not increase odds fetch frequency.

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
