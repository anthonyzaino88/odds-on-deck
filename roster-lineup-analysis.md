# MLB and NFL Roster/Lineup Analysis

## 🏈 **MLB ROSTERS & STARTING LINEUPS**

### **Data Sources:**
- **Primary**: MLB Stats API (`statsapi.mlb.com`)
- **Endpoint**: `/api/v1/game/{gameId}/boxscore`
- **Free**: Yes, no API key required

### **Data Flow:**
1. **Game Lineup Fetching** (`lib/live-data.js`):
   ```javascript
   // Fetch lineup for specific game
   const lineups = await fetchGameLineup(game.mlbGameId)
   
   // Process home team lineup
   if (lineups.home && lineups.home.length > 0) {
     await storePlayersAndStats(lineups.home, game.homeId)
     await storeBattingLineup(lineups.home, game.id, 'home')
   }
   
   // Process away team lineup  
   if (lineups.away && lineups.away.length > 0) {
     await storePlayersAndStats(lineups.away, game.awayId)
     await storeBattingLineup(lineups.away, game.id, 'away')
   }
   ```

2. **Data Mapping** (`lib/vendors/stats.js`):
   ```javascript
   // Extract batting order from MLB API response
   lineups.home = teams.home.battingOrder.map((playerId, index) => ({
     id: playerId.toString(),
     fullName: playerInfo.person?.fullName || 'Unknown',
     bats: playerInfo.person?.batSide?.code || null,
     throws: playerInfo.person?.pitchHand?.code || null,
     isPitcher: playerInfo.person?.primaryPosition?.code === '1',
     battingOrder: index + 1
   }))
   ```

3. **Database Storage**:
   - **Players**: Stored in `Player` table with MLB-specific fields
   - **Lineups**: Stored in `Lineup` table with batting order (1-9)
   - **Team Assignment**: Players linked to teams via `teamId`

### **Key Features:**
- ✅ **Real-time lineups** from official MLB API
- ✅ **Batting order** (1-9 positions)
- ✅ **Player stats** (bats/throws, position)
- ✅ **Automatic updates** via cron jobs
- ✅ **Free API** - no rate limits

### **Current Status:**
- **Home team lineups**: ✅ Working (Toronto has 9 players)
- **Away team lineups**: ⏳ Waiting for announcement (NYY lineup not announced yet)
- **Player names**: ✅ Working correctly
- **Auto-refresh**: ✅ Every 5 minutes

---

## 🏈 **NFL ROSTERS & STARTING LINEUPS**

### **Data Sources:**
- **Primary**: ESPN API (`site.web.api.espn.com`)
- **Secondary**: NFL.com Official API
- **Fallback**: SportsBlaze API
- **Free**: Yes, but with rate limits

### **Data Flow:**
1. **Roster Fetching** (`lib/nfl-live-roster.js`):
   ```javascript
   // Fetch live roster from ESPN API
   const liveRoster = await fetchNFLOfficialRoster(team.abbr.toLowerCase())
   
   // Process each position group
   for (const [positionGroup, players] of Object.entries(liveRoster)) {
     for (let i = 0; i < players.length; i++) {
       const playerData = players[i]
       
       // Create/update player
       const player = await prisma.player.upsert({
         where: { id: playerId },
         update: { fullName, position, jersey, experience, teamId },
         create: { id: playerId, fullName, position, jersey, experience, teamId }
       })
       
       // Create roster entry
       await prisma.nFLRosterEntry.upsert({
         where: { playerId_teamId_season_specificPosition: {...} },
         update: { positionGroup, depthOrder, injuryStatus, isActive },
         create: { playerId, teamId, season, positionGroup, depthOrder, ... }
       })
     }
   }
   ```

2. **Multiple API Endpoints** (`lib/vendors/nfl-official.js`):
   ```javascript
   const endpoints = [
     `https://www.nfl.com/teams/${teamAbbr.toLowerCase()}/roster/`,
     `https://api.nfl.com/v1/teams/${nflTeam}/roster`,
     `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamAbbr.toLowerCase()}/roster`
   ]
   ```

3. **Database Storage**:
   - **Players**: Stored in `Player` table with NFL-specific fields
   - **Roster Entries**: Stored in `NFLRosterEntry` table with depth charts
   - **Position Groups**: QB, RB, WR, TE, OL, DL, LB, DB, K, P

### **Key Features:**
- ✅ **Live rosters** from ESPN/NFL APIs
- ✅ **Depth charts** with position rankings
- ✅ **Injury status** tracking
- ✅ **Jersey numbers** and experience
- ✅ **Multiple fallback APIs**

### **Current Status:**
- **Roster fetching**: ✅ Working (28 teams processed)
- **Player data**: ✅ Working (names, positions, jerseys)
- **Depth charts**: ✅ Working (position groups)
- **Starting lineups**: ⚠️ Limited (depends on game-specific data)

---

## 🔄 **AUTO-REFRESH SYSTEM**

### **Cron Jobs:**
1. **MLB Lineups** (`app/api/cron/refresh-lineups/route.js`):
   - **Frequency**: Every 5 minutes
   - **Trigger**: `fetchAndStoreLiveLineups()`
   - **Scope**: Games with `mlbGameId`

2. **NFL Rosters** (`app/api/cron/auto-refresh/route.js`):
   - **Frequency**: Every 30 minutes
   - **Trigger**: `fetchAndStoreLiveNFLRosters()`
   - **Scope**: All NFL teams

3. **General Data** (`app/api/cron/refresh-slate/route.js`):
   - **Frequency**: Every 15 minutes
   - **Trigger**: `forceRefreshAllData()`
   - **Scope**: All sports data

### **Data Manager** (`lib/data-manager.js`):
- **Centralized refresh**: `forceRefreshAllData()`
- **Parallel processing**: MLB + NFL simultaneously
- **Error handling**: Graceful degradation
- **Caching**: 5-minute TTL for API responses

---

## 📊 **DATABASE SCHEMA**

### **Player Table:**
```sql
model Player {
  id        String      @id
  fullName  String
  
  // MLB-specific
  bats      String?     // R/L/S
  throws    String?     // R/L
  isPitcher Boolean     @default(false)
  
  // NFL-specific  
  position  String?     // QB, RB, WR, TE, etc.
  jersey    Int?        // Jersey number
  experience Int?       // Years in league
  
  teamId    String
  team      Team        @relation(fields: [teamId], references: [id])
}
```

### **Lineup Table (MLB):**
```sql
model Lineup {
  id           String @id @default(cuid())
  gameId       String
  playerId     String
  team         String // "home" or "away"
  battingOrder Int?   // 1-9 for batting order
  position     String? // 1B, 2B, SS, etc.
  isStarting   Boolean @default(true)
}
```

### **NFLRosterEntry Table:**
```sql
model NFLRosterEntry {
  id               String @id @default(cuid())
  playerId         String
  teamId           String
  season           String
  positionGroup    String // QB, RB, WR, etc.
  specificPosition String // QB1, RB1, WR1, etc.
  depthOrder       Int    // 1, 2, 3, etc.
  injuryStatus     String // HEALTHY, QUESTIONABLE, etc.
  isActive         Boolean @default(true)
  week             Int?   // Current week
}
```

---

## 🎯 **CURRENT ISSUES & SOLUTIONS**

### **MLB Issues:**
1. **Away team lineups missing**: ⏳ Normal behavior - lineups announced 1-2 hours before game
2. **Player names undefined**: ✅ Fixed - was a query field name issue
3. **Only home team props**: ⏳ Expected - away team lineup not announced yet

### **NFL Issues:**
1. **Roster data mapping**: ⚠️ Some teams missing ESPN team IDs
2. **Starting lineups**: ⚠️ Limited to depth chart data
3. **Game-specific starters**: ⚠️ Not implemented yet

### **Solutions:**
1. **MLB**: Wait for lineup announcements (automatic)
2. **NFL**: Implement game-specific starter detection
3. **Both**: Add more robust error handling and fallbacks

---

## 🚀 **RECOMMENDATIONS**

### **Immediate:**
1. **Monitor lineup announcements** - NYY lineup should appear soon
2. **Test NFL roster completeness** - verify all teams have rosters
3. **Add lineup announcement notifications** - alert when new lineups available

### **Future:**
1. **NFL starting lineup detection** - identify actual game starters
2. **Injury report integration** - track player availability
3. **Historical lineup data** - store past lineups for analysis
4. **Real-time updates** - WebSocket for instant lineup changes

