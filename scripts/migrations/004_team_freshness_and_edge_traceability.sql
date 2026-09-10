-- ============================================================================
-- Team freshness + EdgeSnapshot prediction↔quote pairing
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill or regrade.
--
-- WHY:
--   Selection can eventually read season / gamesPlayed / statsKind /
--   statsCapturedAt / statsDataThrough instead of inferring "last 10" from
--   ESPN season aggregates. NFL EdgeSnapshot rows can store the prediction
--   with the quote it was computed against.
--
-- WHAT THIS DOES NOT DO:
--   Does not enable public NFL moneylines or totals.
--   Does not rewrite historical nfl-nhl-v0.1.0 rows.
--   eligibleForPublic defaults FALSE.
--
-- VERIFY:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'Team'
--     AND column_name IN (
--       'season', 'gamesPlayed', 'statsKind', 'statsCapturedAt', 'statsDataThrough'
--     )
--   ORDER BY column_name;
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'EdgeSnapshot'
--     AND column_name IN (
--       'payload', 'oddsSnapshotId', 'inputSnapshotId', 'quotedAt', 'eligibleForPublic'
--     )
--   ORDER BY column_name;
-- ============================================================================

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS season TEXT,
  ADD COLUMN IF NOT EXISTS "gamesPlayed" INTEGER,
  ADD COLUMN IF NOT EXISTS "statsKind" TEXT,
  ADD COLUMN IF NOT EXISTS "statsCapturedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "statsDataThrough" TIMESTAMPTZ;

COMMENT ON COLUMN "Team".season IS
  'ESPN season year written by team-performance fetch (e.g. 2025). Distinct from Game.season.';
COMMENT ON COLUMN "Team"."gamesPlayed" IS
  'Season games implied by ESPN record/stats. Omitted on partial fetches that lack a record.';
COMMENT ON COLUMN "Team"."statsKind" IS
  'Honest stats window: season (ESPN team endpoint averages) or last10 (true trailing window; not written today).';
COMMENT ON COLUMN "Team"."statsCapturedAt" IS
  'Set only when a fetch writes a full present-stats extract. Partial updates must not refresh this.';
COMMENT ON COLUMN "Team"."statsDataThrough" IS
  'Last completed ESPN game date when present. Never invented as the fetch clock.';

ALTER TABLE "EdgeSnapshot"
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS "oddsSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "inputSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "quotedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "eligibleForPublic" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS edge_snapshot_model_run_idx
  ON "EdgeSnapshot" ("modelRun");

COMMENT ON COLUMN "EdgeSnapshot".payload IS
  'NFL calculateNFLSelection contract: model / market / evaluation / eligibility / snapshots.';
COMMENT ON COLUMN "EdgeSnapshot"."oddsSnapshotId" IS
  'Odds.id of the quote used at prediction time. Public output must reuse this row.';
COMMENT ON COLUMN "EdgeSnapshot"."inputSnapshotId" IS
  'Id of the team-input snapshot the prediction was computed from.';
COMMENT ON COLUMN "EdgeSnapshot"."quotedAt" IS
  'Timestamp of the paired quote (Odds.ts).';
COMMENT ON COLUMN "EdgeSnapshot"."eligibleForPublic" IS
  'Production NFL writes stay FALSE until an explicit OOS enablement.';
