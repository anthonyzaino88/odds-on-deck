-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "parkFactor" REAL
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "bats" TEXT,
    "throws" TEXT,
    "teamId" TEXT,
    "isPitcher" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "homeId" TEXT NOT NULL,
    "awayId" TEXT NOT NULL,
    "probableHomePitcherId" TEXT,
    "probableAwayPitcherId" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "Game_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Game_awayId_fkey" FOREIGN KEY ("awayId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Odds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "priceHome" REAL,
    "priceAway" REAL,
    "total" REAL,
    "spread" REAL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Odds_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SplitStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "vsHand" TEXT NOT NULL,
    "wOBA" REAL,
    "ISO" REAL,
    "kRate" REAL,
    "bbRate" REAL,
    "xwOBA" REAL,
    "samplePA" INTEGER,
    "scope" TEXT NOT NULL,
    CONSTRAINT "SplitStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PitchMix" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "pitch" TEXT NOT NULL,
    "usage" REAL,
    "whiff" REAL,
    "xwOBA" REAL,
    "runValue" REAL,
    CONSTRAINT "PitchMix_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EdgeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "edgeMlHome" REAL,
    "edgeMlAway" REAL,
    "edgeTotalO" REAL,
    "edgeTotalU" REAL,
    "ourTotal" REAL,
    "modelRun" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EdgeSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_abbr_key" ON "Team"("abbr");
