# Local Testing Status - Odds Fetcher

## ✅ What's Working

### 1. API Connection ✅
- Paid API key working (`c35f7ecbd7c0fe0649582ffc2951ef01`)
- Successfully fetching odds and props
- **API calls used:** 25
- **Remaining quota:** 19,975 calls

### 2. Event ID Mapping ✅
- **NFL:** 13 games mapped successfully
- **NHL:** 5 games mapped successfully
- `oddsApiEventId` column added to database
- Team name matching working

### 3. Data Fetching ✅
- NHL prop markets fixed (removed invalid `player_anytime_goalscorer`)
- Fetching odds for all 3 sports
- Fetching props for NFL & NHL

---

## ❌ What's Broken

### Foreign Key Constraint Error

**Problem:**  
When saving odds to the database, we're using The Odds API event ID (e.g., `"6dd3b8a7..."`) as the `gameId`, but the `Odds` table has a foreign key constraint that requires `gameId` to exist in the `Game` table.

**Current:**
- `Game.id` = `"CHI_at_CIN_2025-11-02"` (ESPN format)
- `Game.oddsApiEventId` = `"6dd3b8a7..."` (The Odds API format)
- `Odds.gameId` = `"6dd3b8a7..."` ❌ (doesn't exist in `Game` table)

**Solution:**
- `Odds.gameId` should be `"CHI_at_CIN_2025-11-02"` ✅ (exists in `Game` table)

---

## 🔧 What Needs to Change

### Fix `saveGameOdds()` function

Instead of using The Odds API event ID directly, we need to:

1. **Create a mapping** from Odds API event ID → our database game ID
2. **Look up** our game ID before saving odds
3. **Use our game ID** in the `Odds.gameId` field

### Pseudo-code:

```javascript
// Current (BROKEN):
async function saveGameOdds(oddsGames, sport) {
  for (const game of oddsGames) {
    // game.id = "6dd3b8a7..." (Odds API event ID)
    await supabase.from('Odds').insert({
      gameId: game.id,  // ❌ Doesn't exist in Game table
      // ...
    })
  }
}

// Fixed (WORKING):
async function saveGameOdds(oddsGames, sport) {
  // 1. Get mapping of Odds API event ID → our database game ID
  const { data: games } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .not('oddsApiEventId', 'is', null)
  
  // 2. Create lookup map
  const eventIdToGameId = {}
  games.forEach(g => {
    eventIdToGameId[g.oddsApiEventId] = g.id
  })
  
  // 3. Save odds using our database game ID
  for (const oddsGame of oddsGames) {
    const ourGameId = eventIdToGameId[oddsGame.id]
    
    if (!ourGameId) {
      console.warn(`No database game found for Odds API event ${oddsGame.id}`)
      continue
    }
    
    await supabase.from('Odds').insert({
      gameId: ourGameId,  // ✅ Uses our database game ID
      // ...
    })
  }
}
```

---

## 📋 Testing Checklist

### Prerequisites:
- [x] Database has `oddsApiEventId` column
- [x] API key is working
- [x] Team name matching works
- [ ] Games exist in database (need to run `fetch-fresh-games.js`)

### Test Steps:
1. [ ] Populate games from ESPN
   ```bash
   node scripts/fetch-fresh-games.js nfl
   node scripts/fetch-fresh-games.js nhl
   ```

2. [ ] Fix `saveGameOdds()` to use correct game ID mapping

3. [ ] Test odds fetching
   ```bash
   node scripts/fetch-live-odds.js nfl
   ```

4. [ ] Verify database
   ```sql
   SELECT COUNT(*) FROM "Game" WHERE "oddsApiEventId" IS NOT NULL;
   SELECT COUNT(*) FROM "Odds";
   SELECT COUNT(*) FROM "PlayerPropCache";
   ```

5. [ ] Test caching (should skip API calls)
   ```bash
   node scripts/fetch-live-odds.js nfl
   # Should show 0 API calls
   ```

6. [ ] Test homepage
   ```bash
   npm run dev
   # Visit http://localhost:3000
   ```

---

## 🎯 Quick Fix Implementation

### Step 1: Update `saveGameOdds()`

Add this at the beginning of the function:

```javascript
async function saveGameOdds(games, sport) {
  if (games.length === 0) return
  
  // First, map event IDs
  await mapAndSaveEventIds(games, sport)
  
  // ** NEW: Get mapping of Odds API event ID → our database game ID **
  const { data: dbGames } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .not('oddsApiEventId', 'is', null)
  
  // Create lookup map
  const eventIdToGameId = {}
  if (dbGames) {
    dbGames.forEach(g => {
      if (g.oddsApiEventId) {
        eventIdToGameId[g.oddsApiEventId] = g.id
      }
    })
  }
  
  console.log(`  💾 Saving odds to database...`)
  
  let saved = 0
  for (const game of games) {
    // ** NEW: Look up our database game ID **
    const ourGameId = eventIdToGameId[game.id]
    
    if (!ourGameId) {
      console.warn(`    ⚠️  No database game found for Odds API event ${game.id}`)
      continue
    }
    
    try {
      for (const bookmaker of game.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          // ... (existing odds parsing logic) ...
          
          await supabase.from('Odds').insert({
            id: generateId(),
            gameId: ourGameId,  // ✅ Use our database game ID
            book: bookmaker.title,
            // ...
          })
        }
      }
    } catch (error) {
      // ...
    }
  }
}
```

### Step 2: Do the same for `savePlayerProps()`

---

## 📊 Expected Outcome

After fixing:

```bash
node scripts/fetch-live-odds.js nfl
```

**Expected output:**
```
🎮 Fetching NFL odds for 2025-11-02...
  📡 API Call #1: /v4/sports/americanfootball_nfl/odds
  ✅ Fetched 13 games with odds
  🔗 Mapping ESPN games to Odds API events...
    ✅ Mapped: ATL @ NE → 6dd3b8a7...
    ✅ Mapped: IND @ PIT → 2340a6e0...
    ... (11 more)
  ✅ Mapped 13 games
  💾 Saving odds to database...
  ✅ Saved 312 odds records  ← Should be > 0!

👤 Fetching NFL player props...
  💾 Saving player props to database...
  ✅ Saved 1,450 prop records  ← Should be > 0!

============================================================
✅ Complete! API calls used: 14
📊 Remaining quota: 19,986 calls this month
============================================================
```

---

## 🚀 Next Steps

1. **Implement the fix** (update `saveGameOdds()` and `savePlayerProps()`)
2. **Populate games** from ESPN
3. **Test locally** until everything works
4. **Commit & push** to GitHub
5. **Deploy** to Vercel

---

**Status:** Ready to implement fix  
**Blocker:** Foreign key constraint (using wrong game ID)  
**Fix:** 10 minutes of code changes  
**Testing:** 5 minutes

Do you want me to implement the fix now?

