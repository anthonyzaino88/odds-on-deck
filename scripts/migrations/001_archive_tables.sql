-- ============================================================================
-- ARCHIVE TABLES for Path B (Predictive Model Training Data)
-- Run this in the Supabase SQL Editor
-- ============================================================================

-- 1. Completed game results (archived before cleanup deletes them)
CREATE TABLE IF NOT EXISTS "ArchivedGame" (
  id            TEXT PRIMARY KEY,         -- original Game.id
  sport         TEXT NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  home_team     TEXT NOT NULL,            -- team abbr
  away_team     TEXT NOT NULL,
  home_score    INT,
  away_score    INT,
  status        TEXT,
  -- context useful for modeling
  weather_temp  FLOAT,
  weather_wind  FLOAT,
  weather_dir   TEXT,
  weather_humid FLOAT,
  home_pitcher  TEXT,                     -- MLB probable pitcher name
  away_pitcher  TEXT,
  home_qb       TEXT,                     -- NFL starting QB
  away_qb       TEXT,
  mlb_game_id   TEXT,
  espn_game_id  TEXT,
  archived_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archived_game_sport_date ON "ArchivedGame" (sport, date);

-- 2. Closing odds (last known lines before game time)
CREATE TABLE IF NOT EXISTS "ClosingOdds" (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       TEXT NOT NULL,
  sport         TEXT NOT NULL,
  book          TEXT NOT NULL,
  market        TEXT NOT NULL,            -- h2h, totals, spreads
  price_home    FLOAT,
  price_away    FLOAT,
  total         FLOAT,
  spread        FLOAT,
  snapshot_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closing_odds_game ON "ClosingOdds" (game_id);
CREATE INDEX IF NOT EXISTS idx_closing_odds_sport_date ON "ClosingOdds" (sport, snapshot_at);

-- 3. Prop line snapshots (archived before clear-stale-props deletes them)
CREATE TABLE IF NOT EXISTS "ArchivedPropLine" (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  prop_id       TEXT NOT NULL,
  game_id       TEXT NOT NULL,
  sport         TEXT NOT NULL,
  player_name   TEXT NOT NULL,
  team          TEXT,
  prop_type     TEXT NOT NULL,            -- hits, strikeouts, goals, etc.
  pick          TEXT NOT NULL,            -- over / under
  threshold     FLOAT NOT NULL,
  odds          FLOAT,                    -- decimal odds
  probability   FLOAT,
  edge          FLOAT,
  confidence    TEXT,
  quality_score FLOAT,
  bookmaker     TEXT,
  projection    FLOAT,
  game_time     TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archived_prop_sport_date ON "ArchivedPropLine" (sport, game_time);
CREATE INDEX IF NOT EXISTS idx_archived_prop_game ON "ArchivedPropLine" (game_id);
CREATE INDEX IF NOT EXISTS idx_archived_prop_player ON "ArchivedPropLine" (player_name);

-- 4. Box score stats (full player stats saved during validation)
CREATE TABLE IF NOT EXISTS "GameBoxScore" (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       TEXT NOT NULL,
  sport         TEXT NOT NULL,
  player_name   TEXT NOT NULL,
  team          TEXT,
  stats         JSONB NOT NULL,           -- flexible: { hits: 2, rbi: 1, ... } or { goals: 1, assists: 2, ... }
  fetched_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boxscore_game ON "GameBoxScore" (game_id);
CREATE INDEX IF NOT EXISTS idx_boxscore_sport_date ON "GameBoxScore" (sport, fetched_at);
CREATE INDEX IF NOT EXISTS idx_boxscore_player ON "GameBoxScore" (player_name);

-- Enable RLS but allow service role full access
ALTER TABLE "ArchivedGame" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClosingOdds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArchivedPropLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GameBoxScore" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON "ArchivedGame" FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON "ClosingOdds" FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON "ArchivedPropLine" FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON "GameBoxScore" FOR ALL USING (true);
