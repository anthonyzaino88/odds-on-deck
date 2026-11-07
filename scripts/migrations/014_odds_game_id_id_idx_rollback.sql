-- ============================================================================
-- ROLLBACK for 014_odds_game_id_id_idx.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Drops only Odds_gameId_id_idx. Odds rows and quotedAt stay.
--
-- OUTSIDE A TRANSACTION. DROP INDEX CONCURRENTLY cannot run inside
-- BEGIN/COMMIT. Run this file as the only statement.
-- Also use this when CREATE INDEX CONCURRENTLY left the index INVALID
-- (indisvalid = false). Drop it here, then run the CREATE again.
-- ============================================================================

DROP INDEX CONCURRENTLY IF EXISTS "Odds_gameId_id_idx";
