-- ============================================================================
-- ROLLBACK for 010_line_shop_quotes.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops the quote ladder and entryBook. Does not touch odds / result /
-- qualityScore / closeOdds. Historical Published prices stay.
--
-- After rollback, fetch-live-odds retries without quote columns
-- (PGRST204 / 42703). Published persist retries without entryBook.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "PlayerPropCache"
  DROP COLUMN IF EXISTS "quotes",
  DROP COLUMN IF EXISTS "quoteUpdatedAt";

ALTER TABLE "PropValidation"
  DROP COLUMN IF EXISTS "entryBook";
