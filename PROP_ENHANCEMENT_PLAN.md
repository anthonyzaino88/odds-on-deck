# Player Props Enhancement Plan - Smart Filtering

## Executive Summary

Enhance prop selection by incorporating team performance, offensive advantage, and player context to surface the highest-value props.

## ✅ Available Data (Already in Database)

### Team Performance (`Team` table)
- `last10Record` - Recent form (e.g., "7-3")
- `homeRecord` / `awayRecord` - Venue splits
- `avgPointsLast10` - Offensive output
- `avgPointsAllowedLast10` - Defensive quality
- `parkFactor` - Offensive advantage (>1 = offense-friendly)

### Game Context (`Game` table)
- Home/away team IDs
- Game date/time
- Status

### Betting Edges (`EdgeSnapshot` table)
- Win probabilities for each team
- Expected game totals
- Calculated edges

## 🎯 Enhancement Strategy (SAFE & ADDITIVE)

### Phase 1: Team Context Enrichment (API Layer)
**Impact**: Zero breaking changes - adds data only

Add team context to each prop:
```javascript
{
  // Existing prop data...
  playerName: "Patrick Mahomes",
  type: "player_pass_yds",
  threshold: 275.5,
  
  // NEW: Team context (additive)
  teamContext: {
    team: "KC",
    isHome: true,
    teamWinProbability: 0.68,
    recentForm: "7-3",
    offensivePower: 32.5,  // Points per game
    defensivePower: 18.2,  // Points allowed per game
    venueAdvantage: 1.15,  // Home court boost
    gameTotal: 47.5       // Expected points in game
  }
}
```

### Phase 2: Smart Filters (Component Layer)
**Impact**: New optional filter modes - existing modes unchanged

Add new filter options:
1. **"Power Offense"** - Teams with offensive advantage + high win probability
2. **"Home Heroes"** - Players with strong home venue performance
3. **"High Scoring"** - Props from games with high expected totals
4. **"Dominance"** - Players on teams with 65%+ win probability

### Phase 3: Visual Indicators (UI Layer)
**Impact**: Display only - no logic changes

Add badges/icons showing:
- 🔥 "Hot Team" (last10 record ≥ 70% wins)
- 🏠 "Home Advantage" (strong home record)
- ⚡ "High Scoring Game" (total ≥ 48 for NFL, ≥ 6.5 for NHL)
- 👑 "Dominant Team" (win probability ≥ 65%)

## 🔒 Safety Guarantees

### 1. No Database Schema Changes
- Uses existing tables and columns
- No migrations needed
- No risk to data integrity

### 2. Backward Compatible
- Existing API endpoints work unchanged
- Existing filters work unchanged
- New features are additive

### 3. Toggleable
- Users can switch between standard and smart filters
- Default behavior unchanged
- Easy to disable if issues arise

### 4. No Dependencies
- Doesn't require real-time API calls
- Uses cached database data
- Fast and reliable

## 📈 Implementation Details

### Step 1: API Enhancement (`app/api/props/route.js`)

```javascript
// CURRENT: Simple prop fetch
const props = data.map(prop => ({
  propId: prop.propId,
  playerName: prop.playerName,
  // ... existing fields
}))

// ENHANCED: Add team context
const props = await enrichPropsWithTeamContext(data)
```

### Step 2: Enrichment Function (NEW: `lib/prop-enrichment.js`)

```javascript
export async function enrichPropsWithTeamContext(props) {
  // Get all unique gameIds
  const gameIds = [...new Set(props.map(p => p.gameId))]
  
  // Batch fetch game + team + edge data
  const gamesData = await supabase
    .from('Game')
    .select(`
      id,
      homeId,
      awayId,
      home:Team!Game_homeId_fkey(*),
      away:Team!Game_awayId_fkey(*),
      edges:EdgeSnapshot(*)
    `)
    .in('id', gameIds)
  
  // Map to gameId lookup
  const gameContext = createGameContextMap(gamesData)
  
  // Enrich each prop
  return props.map(prop => ({
    ...prop,
    teamContext: calculateTeamContext(prop, gameContext[prop.gameId])
  }))
}
```

### Step 3: Smart Filters (`components/PlayerPropsFilter.js`)

```javascript
// ADD to existing filter modes
const filterModes = [
  { id: 'safe', name: 'Safe Picks' },        // Existing
  { id: 'balanced', name: 'Balanced' },      // Existing
  { id: 'value', name: 'Value Bets' },       // Existing
  { id: 'homerun', name: 'Home Runs' },      // Existing
  { id: 'power', name: '⚡ Power Offense' },  // NEW
  { id: 'home', name: '🏠 Home Heroes' },     // NEW
  { id: 'scoring', name: '🎯 High Scoring' }, // NEW
]

// Smart filter logic (additive)
if (filterMode === 'power') {
  filtered = filtered.filter(p => {
    const ctx = p.teamContext
    return ctx?.teamWinProbability >= 0.55 &&
           ctx?.offensivePower >= 25 &&  // NFL: 25+ ppg
           (p.probability || 0) >= 0.50
  })
  filtered.sort((a, b) => 
    (b.teamContext?.offensivePower || 0) - 
    (a.teamContext?.offensivePower || 0)
  )
}
```

## 🧪 Testing Strategy

### 1. Unit Tests
- Test enrichment function with mock data
- Verify all existing filters still work
- Verify new filters add correct filtering

### 2. Integration Tests
- Fetch props from API
- Verify team context is added
- Verify performance (should be fast)

### 3. Manual Testing
- Switch between all filter modes
- Verify props display correctly
- Check that disabled filters work

## 📊 Example Enhancements

### Before (Current)
```
Patrick Mahomes - Over 275.5 Pass Yds
70% probability | +0.0% edge | Q: 45.2
```

### After (Enhanced)
```
Patrick Mahomes - Over 275.5 Pass Yds
🔥 KC (Home, 7-3) vs LV | Win Prob: 68%
70% probability | +0.0% edge | Q: 45.2
⚡ 32.5 PPG offense | O/U 47.5
```

## 🎯 Benefits

1. **Better Prop Selection**: Focus on high-probability game contexts
2. **More Context**: Users understand WHY a prop is good
3. **Smarter Parlays**: Combine props from strong offensive games
4. **Visual Clarity**: Icons/badges make trends obvious
5. **Zero Risk**: Completely additive and toggleable

## 🚀 Rollout Plan

1. **Phase 1** (Week 1): API enrichment + data validation
2. **Phase 2** (Week 2): Add smart filters (disabled by default)
3. **Phase 3** (Week 3): Enable smart filters, gather feedback
4. **Phase 4** (Week 4): Add visual indicators and polish

## 🔐 Confidence Level: 100%

**Why This is Safe**:
- ✅ No schema changes
- ✅ No breaking changes to existing features
- ✅ All additions are optional/toggleable
- ✅ Uses existing, cached database data
- ✅ Can be rolled back instantly
- ✅ No external API dependencies
- ✅ Thoroughly testable

**Worst Case Scenario**:
- New filters don't work → Users keep using existing filters
- Performance issue → Disable enrichment, back to normal
- Data missing → Gracefully degrades to existing behavior

## 📝 Files to Modify

### New Files (No Risk)
- `lib/prop-enrichment.js` - Team context calculation
- `PROP_ENHANCEMENT_GUIDE.md` - Documentation

### Modified Files (Low Risk - Additive Only)
- `app/api/props/route.js` - Add enrichment call
- `components/PlayerPropsFilter.js` - Add smart filter options
- `app/props/page.js` - No changes needed!

### No Changes Needed
- Database schema
- Existing prop generation
- Validation system
- Edge calculation
- Parlay generation (we can enhance later)

