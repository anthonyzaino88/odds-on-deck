-- ============================================================================
-- ROLLBACK for 008_closing_odds_close_capture_uniq.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops the partial unique index only. Does not restore deleted exact
-- duplicate close-capture rows. Snapshot-closing-lines rows are untouched.
-- ============================================================================

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "ClosingOdds_close_capture_uniq";
