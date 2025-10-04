/*
  Warnings:

  - You are about to drop the column `avgRunsAllowedLast10` on the `Team` table. All the data in the column will be lost.
  - You are about to drop the column `avgRunsLast10` on the `Team` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Odds" ADD COLUMN "commence_time" DATETIME;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN "experience" INTEGER;
ALTER TABLE "Player" ADD COLUMN "jersey" INTEGER;
ALTER TABLE "Player" ADD COLUMN "position" TEXT;
ALTER TABLE "Player" ADD COLUMN "shoots" TEXT;

-- CreateTable
CREATE TABLE "Lineup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "battingOrder" INTEGER,
    "position" TEXT,
    "isStarting" BOOLEAN NOT NULL DEFAULT true,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lineup_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lineup_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NFLGameData" (
    "gameId" TEXT NOT NULL PRIMARY KEY,
    "quarter" INTEGER,
    "timeLeft" TEXT,
    "possession" TEXT,
    "down" INTEGER,
    "distance" INTEGER,
    "yardLine" TEXT,
    "redZone" BOOLEAN NOT NULL DEFAULT false,
    "lastPlay" TEXT,
    "driveStart" TEXT,
    "timeOfPossessionHome" TEXT,
    "timeOfPossessionAway" TEXT,
    CONSTRAINT "NFLGameData_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NFLRosterEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "specificPosition" TEXT NOT NULL,
    "depthOrder" INTEGER NOT NULL,
    "injuryStatus" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "season" TEXT NOT NULL,
    "week" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NFLRosterEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NFLRosterEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NFLPlayerProp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "propType" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "overPrice" INTEGER,
    "underPrice" INTEGER,
    "projection" REAL,
    "edge" REAL,
    "confidence" TEXT,
    "vsDefenseRank" INTEGER,
    "playerAverage" REAL,
    "recentForm" REAL,
    "book" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NFLPlayerProp_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NFLPlayerProp_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NFLMatchupHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offenseTeamId" TEXT NOT NULL,
    "defenseTeamId" TEXT NOT NULL,
    "gameId" TEXT,
    "week" INTEGER NOT NULL,
    "season" TEXT NOT NULL,
    "pointsScored" INTEGER,
    "totalYards" INTEGER,
    "passingYards" INTEGER,
    "rushingYards" INTEGER,
    "turnovers" INTEGER,
    "thirdDownPct" REAL,
    "redZonePct" REAL,
    "timeOfPossession" TEXT,
    "passYardsAllowed" INTEGER,
    "rushYardsAllowed" INTEGER,
    "sacksRecorded" INTEGER,
    "interceptionsRecorded" INTEGER,
    "fumbleRecoveries" INTEGER,
    "weather" TEXT,
    "temperature" INTEGER,
    "isHomeGame" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NFLMatchupHistory_offenseTeamId_fkey" FOREIGN KEY ("offenseTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NFLMatchupHistory_defenseTeamId_fkey" FOREIGN KEY ("defenseTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NFLMatchupHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sport" TEXT NOT NULL DEFAULT 'mlb',
    "mlbGameId" TEXT,
    "espnGameId" TEXT,
    "date" DATETIME NOT NULL,
    "homeId" TEXT NOT NULL,
    "awayId" TEXT NOT NULL,
    "probableHomePitcherId" TEXT,
    "probableAwayPitcherId" TEXT,
    "homeStartingQB" TEXT,
    "awayStartingQB" TEXT,
    "status" TEXT NOT NULL,
    "week" INTEGER,
    "season" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "inning" INTEGER,
    "inningHalf" TEXT,
    "outs" INTEGER,
    "balls" INTEGER,
    "strikes" INTEGER,
    "runnerOn1st" TEXT,
    "runnerOn2nd" TEXT,
    "runnerOn3rd" TEXT,
    "currentBatterId" TEXT,
    "currentPitcherId" TEXT,
    "lastPlay" TEXT,
    "lastUpdate" DATETIME,
    "temperature" REAL,
    "windSpeed" REAL,
    "windDirection" TEXT,
    "humidity" REAL,
    "precipitation" REAL,
    CONSTRAINT "Game_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Game_awayId_fkey" FOREIGN KEY ("awayId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Game" ("awayId", "date", "homeId", "humidity", "id", "mlbGameId", "precipitation", "probableAwayPitcherId", "probableHomePitcherId", "status", "temperature", "windDirection", "windSpeed") SELECT "awayId", "date", "homeId", "humidity", "id", "mlbGameId", "precipitation", "probableAwayPitcherId", "probableHomePitcherId", "status", "temperature", "windDirection", "windSpeed" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'mlb',
    "league" TEXT,
    "division" TEXT,
    "parkFactor" REAL,
    "last10Record" TEXT,
    "avgPointsLast10" REAL,
    "avgPointsAllowedLast10" REAL,
    "homeRecord" TEXT,
    "awayRecord" TEXT
);
INSERT INTO "new_Team" ("abbr", "awayRecord", "homeRecord", "id", "last10Record", "name", "parkFactor") SELECT "abbr", "awayRecord", "homeRecord", "id", "last10Record", "name", "parkFactor" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_abbr_key" ON "Team"("abbr");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_gameId_playerId_key" ON "Lineup"("gameId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "NFLRosterEntry_playerId_teamId_season_specificPosition_key" ON "NFLRosterEntry"("playerId", "teamId", "season", "specificPosition");

-- CreateIndex
CREATE UNIQUE INDEX "NFLMatchupHistory_offenseTeamId_defenseTeamId_gameId_key" ON "NFLMatchupHistory"("offenseTeamId", "defenseTeamId", "gameId");
