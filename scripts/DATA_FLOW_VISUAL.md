# 📊 Odds Data Pipeline - Visual Data Flow

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        THE ODDS API                             │
│                   (500 calls/month limit)                       │
│                                                                 │
│  GET /v4/sports/{sport}/odds                                   │
│  GET /v4/sports/{sport}/events/{game_id}/odds                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ fetch-live-odds.js
                         │ (runs 1x daily)
                         │ - Rate limited: 1 call/sec
                         │ - Check cache first
                         │ - Smart retry logic
                         ↓
        ┌────────────────────────────────────────┐
        │      SUPABASE DATABASE                 │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Odds Table                       │  │
        │  ├──────────────────────────────────┤  │
        │  │ • gameId                         │  │
        │  │ • book (DraftKings, FanDuel)     │  │
        │  │ • market (h2h, spreads, totals)  │  │
        │  │ • priceHome, priceAway           │  │
        │  │ • ts (timestamp)                 │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ PlayerPropCache Table            │  │
        │  ├──────────────────────────────────┤  │
        │  │ • propId (unique)                │  │
        │  │ • playerName, sport, type        │  │
        │  │ • odds, probability, edge        │  │
        │  │ • qualityScore, confidence       │  │
        │  │ • expiresAt (TTL)                │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ PropValidation Table             │  │
        │  ├──────────────────────────────────┤  │
        │  │ • propId, playerName             │  │
        │  │ • prediction, actualValue        │  │
        │  │ • result (correct/incorrect)     │  │
        │  │ • edge, confidence               │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ MockPropValidation Table         │  │
        │  ├──────────────────────────────────┤  │
        │  │ Same structure as PropValidation │  │
        │  │ For testing/training mode        │  │
        │  └──────────────────────────────────┘  │
        └────────────────────────────────────────┘
                         ↑
                         │ Frontend queries only
                         │ SELECT * FROM Odds WHERE gameId = ?
                         │ (zero API calls)
                         │
        ┌────────────────────────────────────────┐
        │      FRONTEND APPLICATION              │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Homepage                         │  │
        │  │ - Display games & scores         │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Odds Display Page                │  │
        │  │ - Show all available odds        │  │
        │  │ - Filter by book/market          │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Props Generator                  │  │
        │  │ - Display props by sport         │  │
        │  │ - Show confidence scores         │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Parlay Builder                   │  │
        │  │ - Combine props/moneylines       │  │
        │  │ - Calculate total odds           │  │
        │  └──────────────────────────────────┘  │
        │                                        │
        │  ┌──────────────────────────────────┐  │
        │  │ Validation Tracker               │  │
        │  │ - View accuracy metrics          │  │
        │  │ - Analyze ROI                    │  │
        │  └──────────────────────────────────┘  │
        └────────────────────────────────────────┘
```

---

## 2. Data Flow for Single Game

```
Input: Game CHI @ CIN on 2025-11-02

Step 1: Fetch Game Odds
─────────────────────────
API Call: GET /v4/sports/americanfootball_nfl/odds
                      │
                      ↓
        Returns bookmakers with markets:
        {
          "bookmakers": [
            {
              "title": "DraftKings",
              "markets": [
                {
                  "key": "h2h",  ← moneyline
                  "outcomes": [
                    { "name": "CHI", "price": 110 },   ← away
                    { "name": "CIN", "price": -110 }   ← home
                  ]
                },
                {
                  "key": "spreads",
                  "description": "-3.5",
                  "outcomes": [...]
                }
              ]
            }
          ]
        }
                      │
                      ↓
Save to Odds table:
┌─────────────────────────────────────────┐
│ gameId: NFL_CHI_at_CIN_2025-11-02       │
│ book: DraftKings                        │
│ market: h2h                             │
│ priceAway: 110                          │
│ priceHome: -110                         │
│ ts: 2025-11-02T14:30:00Z                │
│                                         │
│ market: spreads                         │
│ spread: -3.5                            │
│ priceAway: -110                         │
│ priceHome: -110                         │
│ ts: 2025-11-02T14:30:00Z                │
└─────────────────────────────────────────┘


Step 2: Fetch Player Props
──────────────────────────
API Call: GET /v4/sports/americanfootball_nfl/events/
                   NFL_CHI_at_CIN_2025-11-02/odds
                      │
                      ↓
        Returns props per bookmaker:
        {
          "bookmakers": [
            {
              "title": "DraftKings",
              "markets": [
                {
                  "key": "player_pass_yds",
                  "outcomes": [
                    {
                      "name": "Justin Fields",
                      "description": "249.5",
                      "point": 249.5,
                      "price": -110  ← odds for over
                    }
                  ]
                }
              ]
            }
          ]
        }
                      │
                      ↓
Save to PlayerPropCache table:
┌─────────────────────────────────────────┐
│ propId: unique-id-123                   │
│ gameId: NFL_CHI_at_CIN_2025-11-02       │
│ playerName: Justin Fields               │
│ type: player_pass_yds                   │
│ threshold: 249.5                        │
│ pick: over  (if point >= 0)             │
│ odds: -110                              │
│ probability: 0.5 (default)              │
│ edge: 0 (default)                       │
│ confidence: low (default)                │
│ qualityScore: 0 (default)               │
│ sport: nfl                              │
│ bookmaker: DraftKings                   │
│ expiresAt: 2025-11-03T14:30:00Z         │
└─────────────────────────────────────────┘

Note: Later, we calculate:
  - probability (from predictive model)
  - edge (probability vs market)
  - confidence (high/medium/low)
  - qualityScore (0-100)
```

---

## 3. Cache Lifecycle

```
Timer: How long is data fresh?

Moneyline Odds Cache
────────────────────
                    ┌─ 0 minutes: API fetched
                    │  (Cache FRESH)
                    │
              1 hour cache window
                    │
                    │
                    └─ 60 minutes: Cache expires
                       (Need to refresh)

Spreads/Totals Cache
─────────────────────
                    ┌─ 0 minutes: API fetched
                    │  (Cache FRESH)
                    │
              1 hour cache window
                    │
                    │
                    └─ 60 minutes: Cache expires
                       (Need to refresh)

Player Props Cache
──────────────────
                    ┌─ 0 minutes: API fetched
                    │  (Cache FRESH)
                    │
              24 hour cache window
                    │
        (Game happens between here)
                    │
                    │
                    └─ 1440 minutes: Cache expires
                       (Need to refresh)


Cache Check Logic
─────────────────
When script runs:

  Question: Cache exists?
       │
       ├─ NO  → Fetch from API 🔄
       │        (Use API call)
       │
       └─ YES → Check age?
                 │
                 ├─ Fresh (< 1 hour for odds)
                 │  → Use cache ✅
                 │   (Save API call)
                 │
                 └─ Stale (> 1 hour for odds)
                    → Fetch from API 🔄
                     (Use API call)
```

---

## 4. Daily Script Execution

```
6:00 AM - Morning Run
═══════════════════════

Command: node scripts/fetch-live-odds.js all

Step 1: Parse Arguments
        sport: all
        date: 2025-11-02
        dryRun: false
        cacheFresh: false
                ↓
Step 2: For each sport (nfl, mlb, nhl)
        ├─ Fetch NFL
        │  ├─ Check cache for moneyline odds
        │  │  └─ Cache fresh? YES → Skip ✅
        │  │
        │  └─ Fetch NFL player props
        │     ├─ Check cache
        │     │  └─ Cache fresh? YES → Skip ✅
        │     │
        │     └─ Save props to DB 💾
        │
        ├─ Fetch MLB
        │  └─ (same flow)
        │
        └─ Fetch NHL
           └─ (same flow)
                ↓
Step 3: Report
        ✅ Complete! API calls used: 2
        📊 Remaining quota: ~498 calls


Output Example:
════════════════════════════════════════
⚡ ODDS FETCHER - LOCAL SCRIPT
════════════════════════════════════════
📅 Date: 2025-11-02
🎮 Sport: all
🏗️  Mode: PRODUCTION
🔄 Cache: CHECK (use if fresh)
════════════════════════════════════════

🎮 Fetching NFL ODDS for 2025-11-02...
  ✅ Cache hit for moneyline odds

👤 Fetching NFL PLAYER PROPS for 2025-11-02...
  📅 Found 14 games
  ✅ Fetched 5 bookmakers for NFL_CHI_at_CIN
  ✅ Saved 28 prop records

🎮 Fetching MLB ODDS for 2025-11-02...
  ✅ Fetched 3 games with odds
  ✅ Saved 9 odds records

👤 Fetching MLB PLAYER PROPS for 2025-11-02...
  📅 Found 3 games
  ✅ Fetched 2 bookmakers for MLB_NYY_vs_BOS
  ✅ Saved 15 prop records

🎮 Fetching NHL ODDS for 2025-11-02...
  ✅ Cache hit for moneyline odds

════════════════════════════════════════
✅ Complete! API calls used: 4
📊 Remaining quota: ~496 calls this month
════════════════════════════════════════
```

---

## 5. Frontend Data Query

```
User Views Homepage
═══════════════════

Component: app/games/page.js
         │
         └─ useEffect()
            │
            └─ Supabase Query:
               
               SELECT * FROM "Odds"
               WHERE "market" = 'h2h'
               LIMIT 100
                      │
                      ↓
            Database returns:
            {
              "gameId": "NFL_CHI_at_CIN_2025-11-02",
              "book": "DraftKings",
              "market": "h2h",
              "priceHome": -110,
              "priceAway": 110,
              "ts": "2025-11-02T14:30:00Z"
            }
                      │
                      ↓
            Component renders:
            ┌──────────────────────────────────┐
            │  CHI @ CIN                       │
            │  DraftKings: -110 / +110         │
            │  Updated: 2:30 PM                │
            └──────────────────────────────────┘


User Clicks on Game
═══════════════════

Component: app/game/[id]/page.js
         │
         └─ useEffect()
            │
            ├─ Query 1: Game details
            │  SELECT * FROM "Game" WHERE "id" = ?
            │
            ├─ Query 2: Odds for game
            │  SELECT * FROM "Odds" WHERE "gameId" = ?
            │
            └─ Query 3: Props for game
               SELECT * FROM "PlayerPropCache"
               WHERE "gameId" = ?
               AND "expiresAt" > NOW()
                      │
                      ↓
            All data rendered from database
            (ZERO API calls to The Odds API!)
```

---

## 6. API Call Tracking

```
Monthly API Budget: 500 calls
Daily Budget: 16-17 calls
Recommended: 4 calls/day

Day 1 - Monday
──────────────
6:00 AM  - node scripts/fetch-live-odds.js all
           API Calls: 4
           Cumulative: 4
           Remaining: 496

Day 2 - Tuesday
──────────────
6:00 AM  - node scripts/fetch-live-odds.js all
           API Calls: 2 (some cache hits)
           Cumulative: 6
           Remaining: 494

Day 3 - Wednesday
──────────────
6:00 AM  - node scripts/fetch-live-odds.js all
           API Calls: 3
           Cumulative: 9
           Remaining: 491

Day 7 - Sunday (Weekly Check)
───────────────────────────────
Total used: ~28 calls
Rate: 28/7 = 4 calls/day average ✅
Projected monthly: 4 × 30 = 120 calls ✅
Status: On track! 🎉

Day 30 - End of Month
──────────────────────
Total used: 121 calls
Target: 120 calls
Status: Nearly perfect! 🎯
Next month quota resets to 500
```

---

## 7. Prop Validation Flow

```
When User Makes Prediction
══════════════════════════

Step 1: Record Prediction
        INSERT INTO "PropValidation"
        propId: unique-id
        playerName: Justin Fields
        propType: player_pass_yds
        threshold: 249.5
        prediction: over
        odds: -110
        status: pending
                ↓
Step 2: Game Plays (Hours pass)
        CHI @ CIN happens
                ↓
Step 3: Get Final Stats
        Justin Fields final passing yards: 265
                ↓
Step 4: Update Validation
        UPDATE "PropValidation"
        SET actualValue = 265
        SET result = 'correct'  (265 > 249.5)
        SET status = 'completed'
                ↓
Step 5: Analyze Results

        Query All Completed Props:
        ────────────────────────
        SELECT 
          prediction,
          COUNT(*) as total,
          COUNT(CASE WHEN result = 'correct' THEN 1 END) as wins,
          COUNT(CASE WHEN result = 'incorrect' THEN 1 END) as losses,
          ROUND(100.0 * COUNT(CASE WHEN result = 'correct' THEN 1 END) / COUNT(*), 2) as win_rate
        FROM "PropValidation"
        WHERE status = 'completed'
        GROUP BY prediction
        
        Results:
        ─────────
        over:   wins: 42, losses: 25, win_rate: 62.7%
        under:  wins: 38, losses: 30, win_rate: 55.9%
        
        Overall: 80 wins out of 135 = 59.3% accuracy ✅
```

---

## 8. Scaling Architecture

```
Current Single-User Load
════════════════════════
1 user visits homepage
└─ 1 database query
   └─ Instant response
   └─ Zero API calls


With 1000 Users
═══════════════
1000 users visit simultaneously
└─ 1000 database queries
   └─ All queries cached by Supabase
   └─ Instant responses for all
   └─ Zero API calls


API Call Pattern (Unchanged!)
═════════════════════════════
Whether 1 or 1,000,000 users:
6:00 AM  ← Script runs once
         ├─ 4 API calls to fetch data
         └─ Data cached for 1-24 hours

Result: Linear scaling with no API cost increase! 🚀
```

---

## 9. Error Handling Flow

```
API Call Fails
──────────────
         GET /odds API fails
              │
              ↓
    Can we use cache?
              │
         ┌────┴────┐
         │          │
        YES        NO
         │          │
         ↓          ↓
    Use cache    Log error
    (serve old)  Report failure
                 Skip for now
                      │
                      ↓
              Try again tomorrow


Database Connection Fails
─────────────────────────
         Insert to DB fails
              │
              ↓
    Log error with details
    Report in console output
    Continue processing other sports
    (don't crash entire script)
              │
              ↓
    User sees stale data
    Or empty results
    But frontend doesn't crash


Frontend Query Fails
───────────────────
    Query database fails
              │
              ↓
    Show loading state
    Then show error message
    "Unable to load odds"
              │
              ↓
    User can retry
    Or try later
```

---

## Summary

**The Complete Data Flow:**

```
┌──────────────┐
│ The Odds API │  (500 calls/month)
└──────┬───────┘
       │
       │ (4 calls/day)
       ↓
┌──────────────┐
│ fetch-live   │  (Local Script)
│ -odds.js     │  - Rate limiting
└──────┬───────┘  - Smart caching
       │          - Error handling
       │
       │ (Database writes)
       ↓
┌──────────────┐
│ Supabase DB  │  (Always fresh)
│ 4 tables     │  - 1h cache: odds
└──────┬───────┘  - 24h cache: props
       │          - Forever: validation
       │
       │ (Database reads)
       ↓
┌──────────────┐
│ Frontend App │  (User Experience)
│ (5 features) │  - Zero API calls
└──────────────┘  - Instant response
                  - Unlimited scale
```

**Result: Efficient, scalable, and cost-effective!** 🎉

