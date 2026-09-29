-- ============================================================================
-- PropValidation grade audit (tamper-evidence)
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill or regrade.
--
-- WHY:
--   Published / graded PropValidation rows only had timestamp + completedAt.
--   A later overwrite of result / actualValue left no updatedAt, who, or source.
--   Parlay / ParlayLeg already have updatedAt.
--
-- WHAT THIS DOES NOT DO:
--   Does not rewrite historical results or record totals.
--   Does not change grading math.
--   Code writes these columns when present and retries without them if
--   this file has not been applied yet.
--
-- VERIFY:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'PropValidation'
--     AND column_name IN ('updatedAt', 'gradedAt', 'gradedBy', 'gradeSource')
--   ORDER BY column_name;
-- ============================================================================

ALTER TABLE "PropValidation"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "gradedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "gradedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "gradeSource" TEXT;

COMMENT ON COLUMN "PropValidation"."updatedAt" IS
  'Last write to this row. Set on grade / review updates when the column exists.';
COMMENT ON COLUMN "PropValidation"."gradedAt" IS
  'When result / actualValue / completed status was last written.';
COMMENT ON COLUMN "PropValidation"."gradedBy" IS
  'Actor label (system / script name). Not a user id.';
COMMENT ON COLUMN "PropValidation"."gradeSource" IS
  'Writer: update_prop_result, validate_pending_props, grade_pending_game_lines.';
