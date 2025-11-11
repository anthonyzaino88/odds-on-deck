-- Create ParlayHistory table for tracking validated parlay results
CREATE TABLE IF NOT EXISTS "ParlayHistory" (
  id TEXT PRIMARY KEY,
  
  -- Parlay configuration
  sport TEXT NOT NULL,
  type TEXT NOT NULL,
  "legCount" INTEGER NOT NULL,
  
  -- Parlay metrics
  "totalOdds" REAL NOT NULL,
  probability REAL NOT NULL,
  edge REAL NOT NULL,
  "expectedValue" REAL NOT NULL,
  confidence TEXT NOT NULL,
  
  -- Results
  outcome TEXT NOT NULL CHECK (outcome IN ('won', 'lost', 'cancelled')),
  "actualResult" TEXT,
  
  -- Leg details (JSON array)
  legs JSONB NOT NULL,
  
  -- Timestamps
  "createdAt" TIMESTAMPTZ NOT NULL,
  "completedAt" TIMESTAMPTZ NOT NULL,
  "validatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_parlay_history_outcome 
  ON "ParlayHistory"(outcome);

CREATE INDEX IF NOT EXISTS idx_parlay_history_sport 
  ON "ParlayHistory"(sport);

CREATE INDEX IF NOT EXISTS idx_parlay_history_completed 
  ON "ParlayHistory"("completedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_parlay_history_validated 
  ON "ParlayHistory"("validatedAt" DESC);

-- Grant permissions (adjust role as needed)
-- Replace 'anon' and 'authenticated' with your actual Supabase roles
GRANT SELECT, INSERT ON "ParlayHistory" TO anon;
GRANT SELECT, INSERT ON "ParlayHistory" TO authenticated;

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE "ParlayHistory" ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows anyone to read history
CREATE POLICY "Anyone can read parlay history"
  ON "ParlayHistory"
  FOR SELECT
  USING (true);

-- Create a policy that allows inserts (system only)
CREATE POLICY "System can insert parlay history"
  ON "ParlayHistory"
  FOR INSERT
  WITH CHECK (true);

-- Sample query to verify table creation
-- SELECT * FROM "ParlayHistory" LIMIT 1;

