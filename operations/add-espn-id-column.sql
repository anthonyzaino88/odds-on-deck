-- Add espnId column to Team table for proper team resolution
-- This prevents conflicts where ESPN uses same IDs for different teams in different sports

ALTER TABLE "Team" ADD COLUMN "espnId" TEXT;

-- Add comment for documentation
COMMENT ON COLUMN "Team"."espnId" IS 'ESPN API team ID for reliable team resolution across sports';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_team_espn_id ON "Team"("espnId");

-- Create unique index to ensure ESPN ID + sport combinations are unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_espn_id_sport ON "Team"("espnId", "sport");
