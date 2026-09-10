# Proposal only — do not run against production

Adds the columns needed to store an NFL prediction with the quote it was computed against, and to stop treating ESPN season totals as "last 10."

This file is documentation. It is not a Prisma migrate and must not be applied by this PR.

## EdgeSnapshot

```sql
-- PROPOSAL. DO NOT EXECUTE.
ALTER TABLE "EdgeSnapshot"
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS "oddsSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "inputSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "quotedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "eligibleForPublic" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS edge_snapshot_model_run_idx
  ON "EdgeSnapshot" ("modelRun");
```

`payload` should store the `calculateNFLSelection` contract: model / market / evaluation / eligibility / snapshots.

Until this exists, NFL rows persist `modelRun = nfl-selection-v1.0.0` and null edge floats. Public readers must ignore `nfl-nhl-v0.1.0` NFL rows.

## Team

```sql
-- PROPOSAL. DO NOT EXECUTE.
ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS season TEXT,
  ADD COLUMN IF NOT EXISTS "gamesPlayed" INTEGER,
  ADD COLUMN IF NOT EXISTS "statsKind" TEXT,
  ADD COLUMN IF NOT EXISTS "statsCapturedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "statsDataThrough" TIMESTAMPTZ;
```

`last10Record` / `avgPointsLast10` stay for NHL/MLB compatibility. New readers must treat those columns as season aggregates until a real last-10 window is stored under a different name.

## Backfill / presentation

1. Leave historical `nfl-nhl-v0.1.0` EdgeSnapshot rows in place. Do not regrade them.
2. Public APIs already drop NFL rows unless `eligibleForPublic === true` and `modelRun !== nfl-nhl-v0.1.0`.
3. After columns exist, write `payload` from `calculateNFLEdges` and keep `eligibleForPublic` false until a validated study lands.
4. Published / PropValidation game-line rows created from the legacy heuristic should keep their original odds and prediction. Do not rewrite them as `nfl-selection-v1.0.0`.
