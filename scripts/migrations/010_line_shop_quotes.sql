-- ============================================================================
-- Line-shop quote ladder + Published entry book
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill.
--
-- WHY:
--   Morning fetch already receives every US book on the event-odds payload
--   but PlayerPropCache keeps only the best row. The public board cannot
--   shop, and Published rows never store which book was the entry.
--
-- WHAT THIS DOES:
--   PlayerPropCache.quotes JSONB — array of { book, american, decimal, lastUpdate }.
--   PlayerPropCache.quoteUpdatedAt — max last_update on that snapshot.
--   PropValidation.entryBook — book whose posted price was frozen as odds.
--   Historical rows stay NULL. No CLV / odds / result rewrite.
--
-- WHAT THIS DOES NOT DO:
--   Does not add Odds API regions or extra daily fetches.
--   Does not change clvProb (posted/entry vs consensus close).
--   Does not backfill discarded ladders.
--
-- VERIFY:
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE (table_name = 'PlayerPropCache' AND column_name IN ('quotes', 'quoteUpdatedAt'))
--      OR (table_name = 'PropValidation' AND column_name = 'entryBook')
--   ORDER BY table_name, column_name;
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "PlayerPropCache"
  ADD COLUMN IF NOT EXISTS "quotes" JSONB,
  ADD COLUMN IF NOT EXISTS "quoteUpdatedAt" TIMESTAMPTZ;

ALTER TABLE "PropValidation"
  ADD COLUMN IF NOT EXISTS "entryBook" TEXT;

COMMENT ON COLUMN "PlayerPropCache"."quotes" IS
  'Per-book ladder from the morning US payload: [{book, american, decimal, lastUpdate}]. NULL until 010 is applied and a fetch writes it.';
COMMENT ON COLUMN "PlayerPropCache"."quoteUpdatedAt" IS
  'Newest book last_update on that snapshot. NULL if no quote timestamps.';
COMMENT ON COLUMN "PropValidation"."entryBook" IS
  'Sportsbook whose posted price was stored as odds (Published entry). NULL on historical rows.';
