# Team freshness + EdgeSnapshot traceability

Executable SQL lives at `scripts/migrations/004_team_freshness_and_edge_traceability.sql`.

Prisma models `Team` and `EdgeSnapshot` in `prisma/schema.prisma` match those columns.

## How to apply (do not run from this PR)

This repo applies additive SQL in the Supabase SQL Editor. It does **not** run `prisma migrate` in CI or against production from a pull request.

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/004_team_freshness_and_edge_traceability.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` / additive and can be re-run.
4. Confirm with the `information_schema.columns` checks in that file.
5. Only then run `scripts/fetch-team-performance-data.js` / edge calculation against that database.

Do **not** apply from CI, do not backfill, and do not regrade historical `nfl-nhl-v0.1.0` rows.

`eligibleForPublic` defaults to `FALSE`. Fetch and NFL persist paths keep it false.

## Team

```sql
ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS season TEXT,
  ADD COLUMN IF NOT EXISTS "gamesPlayed" INTEGER,
  ADD COLUMN IF NOT EXISTS "statsKind" TEXT,
  ADD COLUMN IF NOT EXISTS "statsCapturedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "statsDataThrough" TIMESTAMPTZ;
```

`last10Record` / `avgPointsLast10` stay for NHL/MLB compatibility. New readers must treat those columns as season aggregates until a real last-10 window is stored under a different name (`statsKind = 'last10'`).

Fetch write rules (`lib/team-performance-stats.js`):

- Persist present ESPN fields only. Omitted fields are absent (no null erasure).
- `statsKind` is `season` for the ESPN team endpoint (season averages, not a trailing 10).
- `statsCapturedAt` / `statsDataThrough` are written only on a **full** present-stats extract.
- Partial ESPN updates keep prior freshness timestamps. Retained stats are not marked freshly updated.
- `statsDataThrough` is the last completed ESPN game date when that event is in the payload. It is never set to the fetch clock.

## EdgeSnapshot

```sql
ALTER TABLE "EdgeSnapshot"
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS "oddsSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "inputSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "quotedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "eligibleForPublic" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS edge_snapshot_model_run_idx
  ON "EdgeSnapshot" ("modelRun");
```

`payload` stores the `calculateNFLSelection` contract: model / market / evaluation / eligibility / snapshots, including sportsbook, line, decimal/American odds, and quote timestamps.

NFL persist (`toNflEdgeSnapshotInsert`) writes those pairing columns and keeps `eligibleForPublic = false`. Public readers already drop NFL rows unless `eligibleForPublic === true` and `modelRun` is the current selection model.

Until Anthony explicitly enables after OOS work, production NFL sides and totals stay ineligible. Production without a fitted totals distribution stays totals-ineligible.

## Backfill / presentation

1. Leave historical `nfl-nhl-v0.1.0` EdgeSnapshot rows in place. Do not regrade them.
2. Public APIs already drop NFL rows unless `eligibleForPublic === true` and `modelRun !== nfl-nhl-v0.1.0`.
3. Published / PropValidation game-line rows created from the legacy heuristic keep their original odds and prediction.
