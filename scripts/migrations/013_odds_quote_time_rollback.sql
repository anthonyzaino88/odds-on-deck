-- ============================================================================
-- ROLLBACK for 013_odds_quote_time.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops the quote-time columns. Capture clocks (Odds.ts, ClosingOdds.snapshot_at)
-- stay. Writers already omit quotedAt / quoted_at when the column is missing.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "Odds" DROP COLUMN IF EXISTS "quotedAt";
ALTER TABLE "ClosingOdds" DROP COLUMN IF EXISTS "quoted_at";
