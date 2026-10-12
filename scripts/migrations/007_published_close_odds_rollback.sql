-- ============================================================================
-- ROLLBACK for 007_published_close_odds.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops the five nullable close columns. Does not touch odds / result /
-- qualityScore. Historical Published rows are unchanged except losing
-- any captured closeOdds.
--
-- After rollback, capture-published-closes.js --apply refuses (missing
-- columns). The public ROI card does not read these columns.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "PropValidation"
  DROP COLUMN IF EXISTS "closeOdds",
  DROP COLUMN IF EXISTS "closeLine",
  DROP COLUMN IF EXISTS "closeBook",
  DROP COLUMN IF EXISTS "closeNumBooks",
  DROP COLUMN IF EXISTS "closeCapturedAt";
