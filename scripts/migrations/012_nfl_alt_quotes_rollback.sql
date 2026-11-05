-- ============================================================================
-- ROLLBACK for 012_nfl_alt_quotes.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops altQuotes / altQuoteUpdatedAt. Does not touch quotes /
-- quoteUpdatedAt / entryBook / odds / closeOdds / result. CLV stays.
--
-- After rollback, fetch-published-nfl-alt-lines.js degrades on
-- PGRST204 / 42703 (warn, no crash). /api/props returns altLines=null.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "PlayerPropCache"
  DROP COLUMN IF EXISTS "altQuotes",
  DROP COLUMN IF EXISTS "altQuoteUpdatedAt";
