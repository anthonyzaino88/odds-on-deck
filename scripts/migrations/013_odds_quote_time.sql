-- ============================================================================
-- Bookmaker quote time on Odds and ClosingOdds
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill.
--
-- WHY:
--   Game-line evaluation (docs/game-lines-eval-contract.md) needs the
--   Odds API last_update separately from the time this database stored
--   the row. Capture time stays ts (Odds) and snapshot_at (ClosingOdds).
--
-- WHAT THIS DOES:
--   Odds.quotedAt — bookmaker or market last_update for that row.
--   ClosingOdds.quoted_at — the same clock on archived and clvclose rows.
--   Both nullable. Historical rows stay NULL. Writers omit the field
--   until this SQL is applied (PGRST204 / 42703 retry).
--
-- WHAT THIS DOES NOT DO:
--   Does not copy ts or snapshot_at into the new column.
--   Does not add Odds API requests, regions, or markets.
--   Does not change close-capture windows or CLV math.
--
-- VERIFY:
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE (table_name = 'Odds' AND column_name = 'quotedAt')
--      OR (table_name = 'ClosingOdds' AND column_name = 'quoted_at')
--   ORDER BY table_name, column_name;
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "Odds"
  ADD COLUMN IF NOT EXISTS "quotedAt" TIMESTAMPTZ;

ALTER TABLE "ClosingOdds"
  ADD COLUMN IF NOT EXISTS "quoted_at" TIMESTAMPTZ;

COMMENT ON COLUMN "Odds"."quotedAt" IS
  'Odds API bookmaker/market last_update. NULL when the payload had none. Not a copy of ts.';
COMMENT ON COLUMN "ClosingOdds"."quoted_at" IS
  'Odds API bookmaker/market last_update. NULL when the payload had none. Not a copy of snapshot_at.';
