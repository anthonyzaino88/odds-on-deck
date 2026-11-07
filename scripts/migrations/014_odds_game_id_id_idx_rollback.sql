-- ============================================================================
-- ROLLBACK for 014_odds_game_id_id_idx.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops only Odds_gameId_id_idx. Odds rows and quotedAt stay.
-- ============================================================================

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "Odds_gameId_id_idx";
