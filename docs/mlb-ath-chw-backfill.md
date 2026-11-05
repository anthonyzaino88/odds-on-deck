# One-time MLB OAK/CWS → ATH/CHW backfill

Stored codes are ESPN-canonical **ATH** (Athletics) and **CHW** (White Sox).
Code aliases already accept `OAK`/`CWS` on ingest. Leftover rows may still
store the old abbreviations on `Team.abbr` and inside `Game.id`.

**Do not run this SQL from CI, from an agent, or from a laptop without
Anthony's OK.** Check leftovers first (read-only, no writes):

```
node scripts/report-mlb-legacy-abbr.js
```

If both counts are 0, stop. There is nothing to backfill.

## Team.abbr (safe if `id` stays 133 / 145)

`Team` is unique on `(abbr, sport)`. Confirm no MLB `ATH`/`CHW` row already
exists before renaming.

```sql
-- ONE-TIME. Do not run without Anthony's OK.
-- Preview:
SELECT id, name, abbr, sport
FROM "Team"
WHERE sport = 'mlb' AND abbr IN ('OAK', 'CWS');

-- Apply (Anthony only):
UPDATE "Team" SET abbr = 'ATH' WHERE sport = 'mlb' AND abbr = 'OAK';
UPDATE "Team" SET abbr = 'CHW' WHERE sport = 'mlb' AND abbr = 'CWS';
```

NFL `OAK` (Raiders / LV alias) must not be touched — the `sport = 'mlb'`
predicate is required.

## Game.id (PK + dependents — do not freelance)

`Game.id` is the primary key (`AWAY_at_HOME_YYYY-MM-DD`). Rewriting it
also has to rewrite every child `gameId` / `game_id` / `gameIdRef`.
**Do not run the remap below unless Anthony has signed off on a
maintenance window and a backup.**

Preview only:

```sql
-- ONE-TIME preview. Do not UPDATE without Anthony's OK.
SELECT id, sport, status, date
FROM "Game"
WHERE sport = 'mlb'
  AND (
    id ILIKE 'OAK_at_%'
    OR id ILIKE '%_at_OAK_%'
    OR id ILIKE 'CWS_at_%'
    OR id ILIKE '%_at_CWS_%'
  );
```

If Anthony approves a remap, do it in one transaction and keep the
`sport = 'mlb'` filter. Child tables that store the game id include
`Odds`, `EdgeSnapshot`, `Lineup`, `PlayerPropCache`, `ClosingOdds`
(`game_id`), `OddsSnapshot` (`game_id`), `GameBoxScore` (`game_id`),
plus non-FK `PropValidation.gameIdRef` and `ParlayLeg.gameIdRef`.

```sql
-- ONE-TIME. Do not run without Anthony's OK.
-- Example shape only — expand the child UPDATEs after reviewing
-- report-mlb-legacy-abbr.js output.
BEGIN;
-- UPDATE "Game" SET id = replace(replace(id, 'OAK_', 'ATH_'), 'CWS_', 'CHW_')
--   WHERE sport = 'mlb' AND (id LIKE '%OAK%' OR id LIKE '%CWS%');
ROLLBACK;
```

Leave the `ROLLBACK` in place until the child-table list is complete and
Anthony has said go. This file is documentation, not a migration.
