# 🏈🏒⚾ Multi-Sport Platform Architecture Plan

## Current State: MLB Foundation ✅
- Teams, Players, Games, Odds, Edges
- Live scores, lineups, player props
- Edge calculation and picks generation
- Professional UI with dashboard

## Hybrid Approach Strategy 🎯

### Phase 1: Add Sport Identification
```sql
-- Add sport field to existing models (non-breaking)
model Team {
  sport    String @default("mlb")  // mlb, nfl, nhl
  league   String?                 // AL/NL, AFC/NFC, Eastern/Western
  division String?                 // Central, North, etc.
  // ... rest unchanged
}

model Game {
  sport String @default("mlb")     // sport identifier
  // ... rest unchanged, add sport-specific fields as needed
}
```

### Phase 2: Sport-Specific Extensions
```sql
-- NFL-specific data (separate table)
model NFLGameData {
  gameId        String @id
  game          Game   @relation(fields: [gameId], references: [id])
  week          Int     // 1-18
  quarter       Int?    // 1-4 + OT
  timeLeft      String? // "14:23"
  possession    String? // team with ball
  down          Int?    // 1-4
  distance      Int?    // yards to go
  yardLine      String? // "NYG 25"
  lastPlay      String? // "15 yard pass to WR"
}

-- NHL-specific data (separate table)  
model NHLGameData {
  gameId        String @id
  game          Game   @relation(fields: [gameId], references: [id])
  period        Int?    // 1-3 + OT/SO
  timeLeft      String? // "14:23"
  possession    String? // team with puck
  powerPlay     String? // "home", "away", null
  penaltyTime   String? // "1:15" remaining
  lastPlay      String? // "Goal by #99"
  shots         Json?   // {home: 15, away: 12}
}
```

## 🚀 Benefits of Hybrid Approach

### **Easy to Add Each Sport:**
1. **Keep existing MLB** completely intact (zero risk)
2. **Add NFL models** alongside existing ones
3. **Add NHL models** using same pattern
4. **Shared utilities** for picks, edges, UI components

### **Scalable Pattern:**
```javascript
// lib/vendors/nfl-stats.js - NFL API calls
// lib/vendors/nhl-stats.js - NHL API calls  
// lib/vendors/mlb-stats.js - Current MLB (rename)

// lib/nfl-props.js - NFL player props
// lib/nhl-props.js - NHL player props
// lib/mlb-props.js - MLB player props (rename current)

// lib/shared/
//   - edge-calculation.js - Common edge math
//   - picks-generator.js - Common picks logic
//   - live-data-updater.js - Common live data patterns
```

## 🏈 NFL Implementation Plan

### **NFL Unique Advantages:**
- ✅ **Weekly Schedule** (vs daily baseball) = deeper analysis time
- ✅ **Massive Props Market** (20+ props per game vs 5-8 in MLB)
- ✅ **Weather Impact** (wind, temperature, precipitation) 
- ✅ **Injury Impact** (single player can change entire game)
- ✅ **Higher Betting Volume** (#1 sport for betting)

### **NFL Data We'd Track:**
```javascript
// Game-level
- Score by quarter
- Time remaining, down & distance
- Red zone efficiency
- Turnovers, penalties

// Player-level
- QB: Pass yards, TDs, INTs, completion %
- RB: Rush yards, TDs, receptions
- WR/TE: Targets, catches, yards, TDs
- K: FG attempts, XP, longest kick
- DEF: Sacks, INTs, fumbles recovered
```

## 🏒 NHL Implementation Plan

### **NHL Unique Advantages:**
- ✅ **Fast-Paced Action** = lots of live betting opportunities
- ✅ **Goalie Props** (saves, goals against)
- ✅ **Power Play Situations** = strategic betting moments
- ✅ **Shots/Hits Props** (easier to predict than goals)
- ✅ **International Appeal** (Canada, Europe)

### **NHL Data We'd Track:**
```javascript
// Game-level  
- Score by period
- Shots on goal, hits, blocked shots
- Power play time, penalty minutes
- Faceoff win percentage

// Player-level
- Forwards: Goals, assists, shots, +/-
- Defensemen: Assists, blocked shots, hits
- Goalies: Saves, goals against, save %
- Special teams: PP goals, PK efficiency
```

## 🎯 **Timeline Estimate**

### **NFL (First)**: ~1-2 weeks
- Week 1: Schema + basic game/team data
- Week 2: Player props + live scores + UI

### **NHL (Second)**: ~3-4 days  
- Reuse NFL patterns and utilities
- Different prop types but same logic structure

### **Shared Features**: Immediate
- ✅ Same picks system (adapt thresholds)
- ✅ Same edge calculation (different inputs)
- ✅ Same live data pipeline (different endpoints)
- ✅ Same UI framework (different icons/colors)

## 💡 **Best Part: Sport Switcher**
```javascript
// Users could toggle between sports in nav:
⚾ MLB | 🏈 NFL | 🏒 NHL
```

**Want to start with NFL this week?** We could have football picks ready for next weekend's games! The infrastructure work would make adding NHL almost trivial afterward.

Which would you prefer to tackle first - NFL or NHL? Or both simultaneously? 🤔
