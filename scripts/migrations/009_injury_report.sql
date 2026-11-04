-- ============================================================================
-- ESPN injury reports + NHL starting goalies
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill.
-- Laptop fetch (`scripts/fetch-injuries.js`) writes these going forward.
-- Code degrades if the tables are missing (WARN, continue).
--
-- WHY:
--   Published / auto-save currently skip FA/IR/Out only when the ESPN
--   event roster says so. A dedicated injury snapshot plus confirmed
--   NHL starters lets morning persist skip Out/IR/Doubtful and backup
--   goalies before picks are recorded. Zero Odds API credits.
--
-- WHAT THIS DOES:
--   1. Creates InjuryReport (NFL + NHL ESPN injury rows for an ET day).
--   2. Creates NhlStartingGoalie (confirmed/probable starter per team).
--   3. Enables RLS with no policies (anon denied; service_role bypasses).
--   4. GRANTs service_role; REVOKEs PUBLIC/anon/authenticated.
--
-- WHAT THIS DOES NOT DO:
--   Does not rewrite PropValidation, closeOdds, or grades.
--   Does not call The Odds API.
--   Does not backfill historical injuries.
--
-- VERIFY:
--   SELECT table_name
--   FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('InjuryReport', 'NhlStartingGoalie')
--   ORDER BY table_name;
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "InjuryReport" (
  "id" TEXT PRIMARY KEY,
  "sport" TEXT NOT NULL,
  "teamAbbr" TEXT NOT NULL,
  "playerName" TEXT NOT NULL,
  "playerId" TEXT,
  "status" TEXT NOT NULL,
  "statusCode" TEXT,
  "position" TEXT,
  "comment" TEXT,
  "source" TEXT NOT NULL DEFAULT 'espn',
  "asOfDate" TEXT NOT NULL,
  "fetchedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "InjuryReport_sport_asOfDate_idx"
  ON "InjuryReport" ("sport", "asOfDate");
CREATE INDEX IF NOT EXISTS "InjuryReport_sport_team_asOfDate_idx"
  ON "InjuryReport" ("sport", "teamAbbr", "asOfDate");

CREATE TABLE IF NOT EXISTS "NhlStartingGoalie" (
  "id" TEXT PRIMARY KEY,
  "gameId" TEXT,
  "espnEventId" TEXT,
  "nhlGameId" TEXT,
  "teamAbbr" TEXT NOT NULL,
  "opponentAbbr" TEXT,
  "playerName" TEXT NOT NULL,
  "playerId" TEXT,
  "confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "source" TEXT NOT NULL,
  "asOfDate" TEXT NOT NULL,
  "fetchedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "NhlStartingGoalie_asOfDate_idx"
  ON "NhlStartingGoalie" ("asOfDate");
CREATE INDEX IF NOT EXISTS "NhlStartingGoalie_team_asOfDate_idx"
  ON "NhlStartingGoalie" ("teamAbbr", "asOfDate");

ALTER TABLE "InjuryReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NhlStartingGoalie" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "InjuryReport" TO service_role;
GRANT ALL ON TABLE "NhlStartingGoalie" TO service_role;
REVOKE ALL ON TABLE "InjuryReport" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "NhlStartingGoalie" FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE "InjuryReport" IS
  'ESPN public injury snapshot for NFL/NHL. Laptop fetch only. Not a grade table.';
COMMENT ON TABLE "NhlStartingGoalie" IS
  'Confirmed or probable NHL starter. ESPN first, NHL api-web fallback.';
