-- AlterTable
ALTER TABLE "Game" ADD COLUMN "humidity" REAL;
ALTER TABLE "Game" ADD COLUMN "precipitation" REAL;
ALTER TABLE "Game" ADD COLUMN "temperature" REAL;
ALTER TABLE "Game" ADD COLUMN "windDirection" TEXT;
ALTER TABLE "Game" ADD COLUMN "windSpeed" REAL;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "avgRunsAllowedLast10" REAL;
ALTER TABLE "Team" ADD COLUMN "avgRunsLast10" REAL;
ALTER TABLE "Team" ADD COLUMN "awayRecord" TEXT;
ALTER TABLE "Team" ADD COLUMN "homeRecord" TEXT;
ALTER TABLE "Team" ADD COLUMN "last10Record" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Odds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "priceHome" REAL,
    "priceAway" REAL,
    "total" REAL,
    "spread" REAL,
    "openingPriceHome" REAL,
    "openingPriceAway" REAL,
    "openingTotal" REAL,
    "movementDirection" TEXT,
    "isSharpMoney" BOOLEAN NOT NULL DEFAULT false,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Odds_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Odds" ("book", "gameId", "id", "market", "priceAway", "priceHome", "spread", "total", "ts") SELECT "book", "gameId", "id", "market", "priceAway", "priceHome", "spread", "total", "ts" FROM "Odds";
DROP TABLE "Odds";
ALTER TABLE "new_Odds" RENAME TO "Odds";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
