-- ============================================================================
-- Published pick closing prices (S1: data capture + CLV)
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill or regrade.
--
-- WHY:
--   Published rows store the price at record time. There is no last
--   available price before first pitch, so we cannot measure CLV.
--
-- WHAT THIS DOES:
--   Five nullable columns on PropValidation. Historical rows stay NULL.
--   Laptop capture (`scripts/capture-published-closes.js`) writes them
--   going forward, one game at a time, only for Published picks.
--
-- WHAT THIS DOES NOT DO:
--   Does not rewrite odds, edge, qualityScore, or results.
--   Does not backfill closes for already-graded rows.
--   Does not change the Published ROI card.
--
-- VERIFY:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'PropValidation'
--     AND column_name IN ('closeOdds', 'closeLine', 'closeBook', 'closeNumBooks', 'closeCapturedAt')
--   ORDER BY column_name;
-- ============================================================================

ALTER TABLE "PropValidation"
  ADD COLUMN IF NOT EXISTS "closeOdds" INTEGER,
  ADD COLUMN IF NOT EXISTS "closeLine" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "closeBook" TEXT,
  ADD COLUMN IF NOT EXISTS "closeNumBooks" INTEGER,
  ADD COLUMN IF NOT EXISTS "closeCapturedAt" TIMESTAMPTZ;

COMMENT ON COLUMN "PropValidation"."closeOdds" IS
  'Last available American price before first pitch. NULL until captured.';
COMMENT ON COLUMN "PropValidation"."closeLine" IS
  'Closing threshold for the same market. May differ from threshold if the line moved.';
COMMENT ON COLUMN "PropValidation"."closeBook" IS
  'Book that offered the best closing price we stored.';
COMMENT ON COLUMN "PropValidation"."closeNumBooks" IS
  'Books seen on that close snapshot. NULL if unknown.';
COMMENT ON COLUMN "PropValidation"."closeCapturedAt" IS
  'When closeOdds was written. Capture never runs after first pitch.';
