# Removing Fake Probability Inflation - November 9, 2025

## What Was Wrong

### The Fake Model:
```javascript
// OLD (DISHONEST):
function calculateOurProbability(pick, threshold, impliedProb) {
  const baseAdjustment = 0.02 + (Math.random() * 0.03) // FAKE 2-5% edge
  return Math.min(0.65, impliedProb + baseAdjustment)
}
```

This was adding a **random 2-5% probability boost** to every prop, creating fake edges that don't exist!

### The Impact:
- Every prop showed 2-5% edge (fake)
- Parlays showed huge combined edges (also fake)
- Model appeared to have value when it didn't
- **We were lying to ourselves about having an edge**

## What We Fixed

### The Honest Approach:
```javascript
// NEW (HONEST):
function calculateOurProbability(pick, threshold, impliedProb) {
  // For now, use bookmaker's probability directly (no fake edges)
  return impliedProb
}
```

Now we use **bookmaker's implied probability as-is** until we have real data.

## What This Means Now

### Current State:
- **Edge**: ~0% on all props (honest - we don't have better info than bookmakers yet)
- **Probability**: Same as bookmaker's implied probability
- **Quality Score**: Based purely on bookmaker's assessment
- **Parlays**: Accurate odds from bookmakers, no fake inflation

### Why This is Better:
1. **Honest**: We're not claiming fake edges
2. **Foundation**: Clean starting point for building a real model
3. **Data Collection**: We can now track REAL performance vs bookmakers
4. **Credibility**: Results will be meaningful

## The Path Forward

### Phase 1: Data Collection (Now)
- Save all props with bookmaker's probabilities
- Track actual results in `PropValidation`
- Build historical database over time

### Phase 2: Analysis (After ~50-100 validated props)
- Calculate player-specific hit rates
- Identify which prop types we can predict
- Find patterns in successful predictions

### Phase 3: Build Real Model (After ~200+ validated props)
- Integrate player stats from ESPN
- Use historical validation data
- Calculate TRUE edges based on real performance
- Continuously improve as we collect more data

## Files Modified

### scripts/fetch-live-odds.js
**Lines 1053-1076**: Removed fake probability inflation
```javascript
function calculateOurProbability(pick, threshold, impliedProb) {
  // For now, use bookmaker's probability directly (no fake edges)
  return impliedProb
  
  // FUTURE: Replace with real model using historical data
}
```

**Lines 1167-1175**: Removed minimum edge filter
- Was: Skip props with edge < 1% (would skip everything now)
- Now: Only skip obvious data errors (edge > 50%)

## What You'll See Now

### When You Fetch New Props:
- **Edge**: ~0.0% (honest - no model yet)
- **Confidence**: "very_low" (correct - we don't know better than bookmakers)
- **Quality Score**: Based on bookmaker's assessment only

### In Parlays:
- **Odds**: Correctly calculated from bookmaker's odds
- **Win Probability**: Bookmaker's implied probability
- **Edge**: ~0% (we're not claiming fake value)
- **Expected Value**: ~0 (break even, as expected)

## The Validation System is Key!

The whole point of the app is to:
1. ✅ **Save predictions** (with bookmaker's probabilities for now)
2. ✅ **Track results** (already working via `PropValidation`)
3. ✅ **Analyze performance** (via `performance-analyzer.js`)
4. 🔨 **Build model** (next step - use historical data to beat bookmakers)
5. 🎯 **Find real edges** (over time, as model learns)

## Next Steps to Build the Real Model

### Immediate (You can do now):
1. Keep fetching and saving props
2. Keep validating results
3. Let data accumulate

### Short Term (After we have data):
1. Build analysis tools to query `PropValidation`
2. Calculate player-specific hit rates
3. Identify which props/players we're good at

### Long Term (The goal):
1. Integrate ESPN player stats API
2. Build predictive model using:
   - Player season averages
   - Historical validation data
   - Opponent matchups
   - Home/away splits
   - Recent form
3. Calculate REAL edges
4. Generate parlays with actual value

## Running This Fix

To update your props with honest probabilities:
```bash
# Delete old props with fake edges
node -e "import('@supabase/supabase-js').then(s => import('dotenv').then(d => { d.config({path:'.env.local'}); const c = s.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); c.from('PlayerPropCache').delete().neq('id', 'none').then(r => console.log('Deleted', r.data?.length || 0, 'old props')); }))"

# Fetch fresh props with honest probabilities
node scripts/fetch-live-odds.js nhl
node scripts/fetch-live-odds.js nfl
```

## The Bottom Line

We went from **lying about having edges** to **being honest about not having better info than bookmakers YET**.

This is the foundation for building a REAL model that can actually find value over time!

