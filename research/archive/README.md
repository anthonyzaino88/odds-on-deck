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

Dates in filenames are **UTC** calendar days. `--from` / `--to` on the NFL job are also **inclusive UTC calendar days**, not Eastern dates.

An **8:15 PM ET** kickoff on a named Eastern date is the **next UTC day** (EDT = 00:15Z, EST = 01:15Z). `--to 2026-09-14` does **not** include Sunday Night Football at 8:15 PM ET on 14 September. Use `--to 2026-09-15` for that kickoff. A 4:15 PM ET kickoff is 20:15Z the same UTC day and **is** included in `--to 2026-09-14`.

## Env overrides (optional)

```
ARCHIVE_PROP_LINES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\prop-lines
ARCHIVE_BOX_SCORES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\box-scores
ARCHIVE_NFL_BOX_SCORES_DIR=C:\Users\zaino\Desktop\Odds on Deck\research\archive\box-scores\nfl
NFL_ARCHIVE_SEASON=2026
```

`NFL_ARCHIVE_SEASON` is the configured current NFL season for audit/backfill. If unset, January–February use the previous calendar year (playoffs); otherwise the current UTC year.

## What writes here

- `scripts/clear-stale-props.js` — stale/expired/past-game `PlayerPropCache` rows. Archive write is verified first; **deletion is aborted if archive read/write fails**, including when candidate collection exhausts retries (zero deletes). Deletes match `id` + the **exact** `fetchedAt` string from the DB (Postgres fractional seconds are not truncated through `Date`). Candidate reads use an explicit column list, conservative **keyset** pages (`id > cursor`, default 50), and bounded retries on 504/503/network errors. Offset pages are not used: they get slower on large caches and skip rows if earlier matches disappear mid-walk. Remaining limit: a row that only becomes eligible after its `id` has passed the cursor is left for the next run; a refresh after capture is skipped at refetch or delete-time and those skips are reported separately. `--dry-run` / `--collect-only` are read-only and exit 1 on read failure. `--help` does no DB/archive work.
- `scripts/snapshot-closing-lines.js` — prop snapshot section only. **ClosingOdds still inserts into Supabase** (needed by `close-stuck-parlays`).
- `scripts/validate-pending-props.js` — MLB box-score archive after grading. Grading itself still uses ESPN/MLB vendor APIs, not these files. NFL/NHL games are **not** archived from pending props (games without pending rows would be missed).
- `scripts/archive-nfl-box-scores.js` — independent NFL outcome archive from public ESPN endpoints.

Field names stay snake_case (`prop_id`, `game_id`, `player_name`, `stats`, …).

## NFL box-score archival (independent of PropValidation)

Completed NFL games are discovered from the ESPN scoreboard for an explicit season / week / date range. Elapsed kickoff time is **not** treated as final. The summary endpoint must report the game complete and include a box score.

Each successful write stores:

1. The **raw** ESPN summary JSON (`raw/{eventId}/vN.json`)
2. A **versioned normalized** record (`normalized/{eventId}/vN.json`) with provider event/player/team IDs, **season / season type / week carried from scoreboard discovery** (checked against summary header metadata), game time, `fetched_at` (actual capture time), source, and schema version
3. An append-only `index.jsonl` row — only after (1) and (2) are written **and verified**

Coverage audits **re-read those files**. An index row alone is not a complete archive: the audit checks existence, JSON parseability, event identity, schema, completeness, a **recomputed** normalized content hash, **raw-content integrity** (recomputed raw hash vs stored `raw_hash` when present), and **raw-to-normalized consistency** (re-parse the summary and compare player stats / teams / game identity). Season / week / seasonType may come from scoreboard discovery rather than the summary raw; audits reuse those stored fields so a healthy archive is not rejected for metadata the summary omitted. A damaged latest version is reported as corrupt/incomplete; an older healthy version is not treated as current. Valid raw JSON with one altered player stat is **corrupt**. Prior versions and original `fetched_at` stamps stay in place; corrections write `vN+1` only.

Missing statistics stay `null`. A recorded `0` is a real zero. Absent categories are omitted (not inferred as DNP). Completeness requires player-stat coverage for **both** competitor team IDs; a one-team box score is incomplete and does not overwrite the last complete version.

Reruns are idempotent: the same observation hash on a **healthy** latest version is a no-op. A later ESPN correction, metadata repair, or recovery from a damaged latest version writes `vN+1` and becomes the latest complete version. Prior versions, original `fetched_at` stamps, and damaged bytes are left in place. Existing MLB JSONL files are left in place.

### Operator commands (archive-only — no cache cleanup)

Read-only coverage audit against completed games in the configured current season:

```
npm run archive:nfl:audit
node scripts/archive-nfl-box-scores.js --audit --season 2026
```

Archive-only backfill from public ESPN endpoints (no Odds API, no paid historical requests).
`--from` / `--to` are **inclusive UTC calendar days**, not Eastern dates.
An 8:15 PM ET kickoff on the named Eastern date is the next UTC day and is **not** in `--to` of that Eastern date.

Default `npm run archive:nfl` with no `--week` / `--from` / `--to` walks regular-season weeks 1–18 and re-fetches each completed summary (identical observation hashes are no-ops). Prefer `--week` or a date range for a postgame run.

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
| Healthy archives | Events whose **latest** index version has readable raw + normalized files, matching event IDs, schema, completeness, a **recomputed** content hash, raw-content integrity, and raw-to-normalized stat consistency (scoreboard-sourced season/week/seasonType allowed) |
| Missing games | Expected completed events with no archive yet |
| Corrupt archives | Latest version exists but JSON is unreadable, event IDs disagree, recomputed hashes disagree, or raw player stats do not match the normalized record |
| Incomplete archives | Latest version parsed but fails both-team completeness (or index `complete` is false) |
| Missing files | Index claims a version whose raw and/or normalized file is gone |
| Failed fetches | Scoreboard/summary HTTP failures |
| Unresolved identities | Archived games whose players/teams lack provider IDs |
| Expected / archived date coverage | UTC calendar days actually seen on events vs index |

`--audit` and archive runs exit **2** when any of those integrity buckets is non-empty, including incomplete ESPN responses that returned HTTP 200.

### Verify one archived game against its source

1. Note `provider_event_id` (ESPN event id) from the coverage report or `index.jsonl`.
2. Open `research/archive/box-scores/nfl/raw/{eventId}/vN.json` and `normalized/{eventId}/vN.json` (latest complete `N` from the index).
3. Confirm `header.id` equals `provider_event_id`.
4. Confirm `header.competitions[0].status.type.completed` is true (or `STATUS_FINAL`).
5. Pick one athlete from `boxscore.players[].statistics[].athletes[]` and match `athlete.id`, `displayName`, team id, and a stat (empty source values must be `null` in normalized, not `0`, unless the source literally sent `0`).
6. Confirm `fetched_at` is the time this machine captured the file — **not** backdated to `game_time`. Capture time is never a historical quote.

### Repeatable postgame run and later correction refresh

A **one-time backfill is not the recurring archival**. After games (same checkout the operator already uses for `validate:all`):

```
npm run validate:all
node scripts/archive-nfl-box-scores.js --week <n>
# or a UTC date range that includes evening ET kickoffs on their UTC day
```

Later the same day or mid-week, run the **same** archive command again. Identical box scores on a healthy latest version are no-ops; ESPN stat corrections and metadata repairs write a new version. Docs here are the operator routine; they are not proof a given run happened. Do not add Odds API fetches.

### JSONL append recovery (prop-line cleanup + NFL index)

Verified appends refuse to write if the existing file is truncated or has unparseable lines. They then prove the **on-disk** file (not the payload in isolation) contains the prior records plus the new ones. On failure, damaged bytes stay on disk.

1. **Do not** run cache cleanup / delete the DB source.
2. Copy the damaged file aside (`*.jsonl.damaged`).
3. Keep every complete JSON object line. Leave an incomplete tail in the damaged copy; do not invent records.
4. Retry the append. Cleanup stays aborted until verification succeeds.

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
| `odds_format` | Verified format of the stored numeric price: explicit `odds_format` / `oddsFormat`, else a known writer (`fetch-live-odds` → `decimal`), else `unknown`. Cleanup archives unlabeled rows as `unknown` when writer provenance is unavailable. **Do not globally label legacy rows decimal.** Never defaulted to `american`. Magnitude is not used. The original number is preserved. |
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
