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
    CONSTRAINT "Game_awayId_fkey" FOREIGN KEY ("awayId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Game_probableHomePitcherId_fkey" FOREIGN KEY ("probableHomePitcherId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Game_probableAwayPitcherId_fkey" FOREIGN KEY ("probableAwayPitcherId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Game" ("awayId", "awayScore", "awayStartingQB", "balls", "currentBatterId", "currentPitcherId", "date", "espnGameId", "homeId", "homeScore", "homeStartingQB", "humidity", "id", "inning", "inningHalf", "lastPlay", "lastUpdate", "mlbGameId", "outs", "precipitation", "probableAwayPitcherId", "probableHomePitcherId", "runnerOn1st", "runnerOn2nd", "runnerOn3rd", "season", "sport", "status", "strikes", "temperature", "week", "windDirection", "windSpeed") SELECT "awayId", "awayScore", "awayStartingQB", "balls", "currentBatterId", "currentPitcherId", "date", "espnGameId", "homeId", "homeScore", "homeStartingQB", "humidity", "id", "inning", "inningHalf", "lastPlay", "lastUpdate", "mlbGameId", "outs", "precipitation", "probableAwayPitcherId", "probableHomePitcherId", "runnerOn1st", "runnerOn2nd", "runnerOn3rd", "season", "sport", "status", "strikes", "temperature", "week", "windDirection", "windSpeed" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
