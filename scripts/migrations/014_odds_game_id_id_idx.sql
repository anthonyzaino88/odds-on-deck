-- ============================================================================
-- Odds (gameId, id) index for cleanup retention reads
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not delete or rewrite rows.
--
-- WHY:
--   Cleanup pages Odds with gameId IN (...) ORDER BY id, using the last id
--   as the cursor. There is no cap on how many of those rows are retained.
--
-- WHAT THIS DOES:
--   Adds Odds_gameId_id_idx on ("gameId", "id").
--
-- WHAT THIS DOES NOT DO:
--   Does not add or drop quotedAt / quoted_at (that is SQL 013).
--   Does not delete odds history.
--   Does not add Odds API requests.
--
-- VERIFY:
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'Odds' AND indexname = 'Odds_gameId_id_idx';
-- ============================================================================

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS "Odds_gameId_id_idx"
  ON "Odds" ("gameId", "id");
