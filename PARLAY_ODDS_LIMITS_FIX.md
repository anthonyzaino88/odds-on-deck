# Maximum Odds Limits for Parlay Modes - November 9, 2025

## Problem Fixed: Unrealistic Parlay Odds

### **The Issue**
The parlay generator was creating parlays with outrageous odds, especially in HOMERUN mode:
- **Before**: +147368, +134401, +138426 (1400x+ multipliers)
- These had virtually 0% chance of hitting (lottery tickets)
- Made the feature unusable for realistic betting

### **The Solution**
Added maximum odds limits for each betting strategy mode to keep parlays realistic and actionable.

## New Maximum Odds Limits

| Mode | Max Multiplier | Max American Odds | Use Case |
|------|---------------|-------------------|----------|
| **SAFE** | 10x | +900 | Most likely to hit, conservative plays |
| **BALANCED** | 30x | +2900 | Good balance of risk and reward |
| **VALUE** | 50x | +4900 | Hunting for edge, willing to take risks |
| **HOMERUN** | 100x | +9900 | Big swings, still realistic (not lottery) |

### **Examples of What You'll See Now:**

#### SAFE Mode (+900 max):
- 2-leg parlay: Each leg around +200 odds
- 3-leg parlay: Each leg around +100 to +150 odds
- **Win probability**: 10-20%
- **Strategy**: Solid, conservative plays

#### BALANCED Mode (+2900 max):
- 2-leg parlay: Each leg around +400 to +500 odds
- 3-leg parlay: Each leg around +200 to +250 odds
- **Win probability**: 3-8%
- **Strategy**: Good value with reasonable hit rate

#### VALUE Mode (+4900 max):
- 2-leg parlay: Each leg around +600 to +700 odds
- 3-leg parlay: Each leg around +300 to +350 odds
- **Win probability**: 2-5%
- **Strategy**: Maximum edge, accepting lower probability

#### HOMERUN Mode (+9900 max):
- 2-leg parlay: Each leg around +900 to +1000 odds
- 3-leg parlay: Each leg around +400 to +450 odds
- **Win probability**: 1-3%
- **Strategy**: Big payouts, still within reality

## Code Changes

### File: `lib/simple-parlay-generator.js`

**Lines 434-443**: Added maximum odds filtering
```javascript
// Apply maximum odds limits based on filter mode to keep parlays realistic
const maxOddsLimits = {
  'safe': 10,        // Max 10x (e.g., +900) - Reasonable favorites
  'balanced': 30,    // Max 30x (e.g., +2900) - Balanced risk/reward
  'value': 50,       // Max 50x (e.g., +4900) - High value hunting
  'homerun': 100     // Max 100x (e.g., +9900) - Big swings, still realistic
}

const maxOdds = maxOddsLimits[filterMode] || 30
sortedParlays = sortedParlays.filter(p => p.totalOdds <= maxOdds)
```

## Why These Limits?

### **10x Limit (SAFE)**
- Professional bettors rarely go above 10x parlays
- Still offers 10:1 return, which is excellent
- High enough for excitement, low enough to be realistic

### **30x Limit (BALANCED)**
- Sweet spot for recreational bettors
- ~3% hit rate is reasonable
- Good balance of payout and probability

### **50x Limit (VALUE)**
- For aggressive value hunters
- ~2% hit rate still within statistical possibility
- Focuses on finding mispriced odds

### **100x Limit (HOMERUN)**
- Maximum for "moonshot" parlays
- ~1% hit rate (1 in 100)
- Still grounded in reality, not lottery territory
- Anything above this is typically -EV (negative expected value)

## Expected Behavior After Fix

When you generate new parlays:

1. **SAFE Mode**: All parlays under +900 odds (10x)
   - Most will be +200 to +600
   - Higher win probability shown

2. **BALANCED Mode**: All parlays under +2900 odds (30x)
   - Most will be +600 to +2000
   - Balanced metrics

3. **VALUE Mode**: All parlays under +4900 odds (50x)
   - Most will be +1500 to +4000
   - High edge shown

4. **HOMERUN Mode**: All parlays under +9900 odds (100x)
   - Most will be +3000 to +9000
   - Big payouts, but not insane

## Testing

Try generating new parlays in HOMERUN mode now - you should see:
- **Before**: +147368, +134401, +138426
- **After**: +9800, +8500, +7200 (still big, but realistic!)

The hot reloader should pick this up automatically! 🎉

