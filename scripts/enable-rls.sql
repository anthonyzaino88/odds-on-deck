-- ============================================
-- ENABLE ROW LEVEL SECURITY (RLS) FOR ALL TABLES
-- ============================================
-- Run this in Supabase SQL Editor: Dashboard > SQL Editor > New Query
-- 
-- This script:
-- 1. Enables RLS on all tables
-- 2. Creates policies that allow public READ access (anon key)
-- 3. Write operations require the secret key (bypasses RLS)
-- ============================================

-- ============================================
-- STEP 1: Enable RLS on all tables
-- ============================================

ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Player" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Game" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Odds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EdgeSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lineup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineupEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PitchMix" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SplitStat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Parlay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParlayLeg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropValidation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MockPropValidation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerPropCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NFLMatchupHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NFLRosterEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NFLPlayerProp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NFLGameData" ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: Create READ policies for anon (public) role
-- These allow anyone with the publishable/anon key to read data
-- ============================================

-- Team table - public read
CREATE POLICY "Allow public read on Team" ON "Team"
  FOR SELECT USING (true);

-- Player table - public read
CREATE POLICY "Allow public read on Player" ON "Player"
  FOR SELECT USING (true);

-- Game table - public read
CREATE POLICY "Allow public read on Game" ON "Game"
  FOR SELECT USING (true);

-- Odds table - public read
CREATE POLICY "Allow public read on Odds" ON "Odds"
  FOR SELECT USING (true);

-- EdgeSnapshot table - public read
CREATE POLICY "Allow public read on EdgeSnapshot" ON "EdgeSnapshot"
  FOR SELECT USING (true);

-- Lineup table - public read
CREATE POLICY "Allow public read on Lineup" ON "Lineup"
  FOR SELECT USING (true);

-- LineupEntry table - public read
CREATE POLICY "Allow public read on LineupEntry" ON "LineupEntry"
  FOR SELECT USING (true);

-- PitchMix table - public read
CREATE POLICY "Allow public read on PitchMix" ON "PitchMix"
  FOR SELECT USING (true);

-- SplitStat table - public read
CREATE POLICY "Allow public read on SplitStat" ON "SplitStat"
  FOR SELECT USING (true);

-- Parlay table - public read
CREATE POLICY "Allow public read on Parlay" ON "Parlay"
  FOR SELECT USING (true);

-- ParlayLeg table - public read
CREATE POLICY "Allow public read on ParlayLeg" ON "ParlayLeg"
  FOR SELECT USING (true);

-- PropValidation table - public read
CREATE POLICY "Allow public read on PropValidation" ON "PropValidation"
  FOR SELECT USING (true);

-- MockPropValidation table - public read
CREATE POLICY "Allow public read on MockPropValidation" ON "MockPropValidation"
  FOR SELECT USING (true);

-- PlayerPropCache table - public read
CREATE POLICY "Allow public read on PlayerPropCache" ON "PlayerPropCache"
  FOR SELECT USING (true);

-- NFLMatchupHistory table - public read
CREATE POLICY "Allow public read on NFLMatchupHistory" ON "NFLMatchupHistory"
  FOR SELECT USING (true);

-- NFLRosterEntry table - public read
CREATE POLICY "Allow public read on NFLRosterEntry" ON "NFLRosterEntry"
  FOR SELECT USING (true);

-- NFLPlayerProp table - public read
CREATE POLICY "Allow public read on NFLPlayerProp" ON "NFLPlayerProp"
  FOR SELECT USING (true);

-- NFLGameData table - public read
CREATE POLICY "Allow public read on NFLGameData" ON "NFLGameData"
  FOR SELECT USING (true);

-- ============================================
-- DONE!
-- ============================================
-- 
-- After running this script:
-- ✅ RLS is enabled on all tables
-- ✅ Browser (publishable/anon key) can READ all data
-- ✅ Server (secret key) can READ and WRITE all data (bypasses RLS)
-- ✅ Security warnings in Supabase dashboard should disappear
--
-- To verify, go to: Dashboard > Security Advisor
-- All 17 "RLS Disabled" errors should be gone!
-- ============================================







