-- ============================================================================
-- ROLLBACK for 011_odds_snapshots.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops OddsSnapshot. Does not touch PropValidation.odds / closeOdds /
-- result / qualityScore / entryBook. CLV math stays.
--
-- After rollback, snapshot-published-odds.js degrades on 42P01 /
-- PGRST204 / 42703 (warn, no crash).
-- ============================================================================

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "OddsSnapshot_propValidationId_capturedAt_idx";
DROP TABLE IF EXISTS "OddsSnapshot";
