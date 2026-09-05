-- ============================================================================
-- ADD numBooks TO PROP CACHE + VALIDATION
-- ============================================================================
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- WHY:
--   Going forward we persist how many books were seen when a prop was written
--   (line-shop count). A future published-picks rule may require ≥3 books.
--   Historical rows stay NULL — do not backfill or invent counts.
--
-- WHAT THIS DOES:
--   Additive nullable INTEGER columns on PlayerPropCache and PropValidation.
--   Safe to run more than once (IF NOT EXISTS).
--
-- VERIFY:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name IN ('PlayerPropCache', 'PropValidation')
--     AND column_name = 'numBooks';
-- ============================================================================

ALTER TABLE "PlayerPropCache"
  ADD COLUMN IF NOT EXISTS "numBooks" INTEGER;

ALTER TABLE "PropValidation"
  ADD COLUMN IF NOT EXISTS "numBooks" INTEGER;

COMMENT ON COLUMN "PlayerPropCache"."numBooks" IS
  'Book count observed at save time. NULL on historical rows; do not invent.';

COMMENT ON COLUMN "PropValidation"."numBooks" IS
  'Book count copied from the cache/source at save time. NULL on historical rows.';
