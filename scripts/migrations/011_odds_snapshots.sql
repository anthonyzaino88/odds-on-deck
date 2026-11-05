-- ============================================================================
-- Published-pick price snapshots (path from morning post to close)
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill.
--
-- WHY:
--   CLV is still entry price vs consensus close. That pair is two
--   points. Midday / pregame snapshots record how each Published pick's
--   line and price moved in between, without a second morning fetch.
--
-- WHAT THIS DOES:
--   OddsSnapshot — one row per Published pick per capture. Informational
--   only. Does not rewrite PropValidation.odds / closeOdds / result.
--
-- WHAT THIS DOES NOT DO:
--   Does not change clvProb (posted/entry vs consensus close).
--   Does not snapshot shadow-published or unpublished pending archive.
--   Does not write source='close' — that window stays on close capture.
--   Does not add Odds API regions. Snapshot script uses regions=us.
--
-- VERIFY:
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'OddsSnapshot'
--   ORDER BY ordinal_position;
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "OddsSnapshot" (
  "id" TEXT PRIMARY KEY,
  "propValidationId" TEXT NOT NULL,
  "gameId" TEXT,
  "sport" TEXT,
  "market" TEXT,
  "playerName" TEXT,
  "selection" TEXT,
  "line" DOUBLE PRECISION,
  "consensusOdds" INTEGER,
  "bestOdds" INTEGER,
  "bestBook" TEXT,
  "numBooks" INTEGER,
  "quotes" JSONB,
  "capturedAt" TIMESTAMPTZ NOT NULL,
  "source" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "OddsSnapshot_propValidationId_capturedAt_idx"
  ON "OddsSnapshot" ("propValidationId", "capturedAt");

COMMENT ON TABLE "OddsSnapshot" IS
  'Informational Published-pick price path (midday/pregame). CLV stays entry vs consensus close.';
COMMENT ON COLUMN "OddsSnapshot"."propValidationId" IS
  'PropValidation.id of the Published pick. Not a FK — additive, no lock on persist.';
COMMENT ON COLUMN "OddsSnapshot"."quotes" IS
  'Same-line book ladder: [{book, american, lastUpdate}]. NULL if 011 is applied but no books matched.';
COMMENT ON COLUMN "OddsSnapshot"."source" IS
  'midday | pregame | close. The snapshot script never writes close.';
