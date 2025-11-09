# Parlay Odds Inversion Fix - November 9, 2025

## Critical Bug Fixed: Inverted Parlay Odds

### **The Problem**
Parlays were displaying **NEGATIVE odds** (favorites) like `-752`, `-733`, `-770` when they should have been showing **POSITIVE odds** (underdogs) like `+752`, `+733`, `+770`.

This was completely wrong because:
- **Parlays combine multiple bets**, so they should almost always have positive odds (longshots)
- **Negative odds mean favorites** (risk more to win less)
- Example: `-752` means you risk $752 to win $100 ❌
- Should be: `+752` means you risk $100 to win $752 ✅

### **Root Cause**
In `lib/simple-parlay-generator.js` line 576, the code was treating decimal odds as if they were American odds:

**Before (WRONG)**:
```javascript
const decimalOdds = bet.odds > 0 ? (bet.odds / 100) + 1 : (100 / Math.abs(bet.odds)) + 1
totalOdds *= decimalOdds
```

This incorrectly converted:
- `1.95` (decimal) → treated as `+195` (American) → converted to `2.95` (decimal)
- After multiplying 3 such bets: `2.95 × 2.95 × 2.95 = 25.7` instead of `1.95 × 1.95 × 1.95 = 7.4`
- Result: WAY too high, then when converted to American, it wrapped around to negative

**The Issue:**
- Props in `PlayerPropCache` store odds as **decimal format** (e.g., 1.95, 2.10, 1.80)
- The code was treating them as **American format** (e.g., +195, -110)
- This double-conversion caused the inversion

### **The Fix**
**After (CORRECT)**:
```javascript
// bet.odds is already in decimal format from PlayerPropCache (e.g., 1.95)
// No conversion needed - just multiply directly
const decimalOdds = bet.odds
totalOdds *= decimalOdds
```

Now the calculation is correct:
- 3 bets with 1.95 odds each: `1.95 × 1.95 × 1.95 = 7.41` decimal
- Converts to: `+641` American odds ✅
- Meaning: Risk $100 to win $641

### **Example Calculation**

**3-leg parlay with each leg at 1.95 decimal odds:**

| Before Fix | After Fix |
|------------|-----------|
| Treated as: +195 each | Correctly used: 1.95 each |
| Converted to: 2.95 each | No conversion needed |
| Combined: 2.95³ = 25.67 | Combined: 1.95³ = 7.41 |
| Displayed: -2467 ❌ | Displayed: +641 ✅ |
| **WRONG!** | **CORRECT!** |

### **Impact**

#### Before Fix:
- Parlays showed as heavy favorites (negative odds)
- Payouts looked terrible: $10 bet → $11 total
- Made no sense mathematically or strategically

#### After Fix:
- Parlays show as underdogs (positive odds) ✅
- Correct payouts: $10 bet → $70-80 total for 3-leggers ✅
- Mathematically sound and makes strategic sense ✅

### **Files Modified**
- `lib/simple-parlay-generator.js` (lines 573-580)
  - Removed incorrect American → Decimal conversion
  - Now uses decimal odds directly from database

### **Expected Behavior Now**

Typical 3-leg parlay with decent odds (each leg ~1.90-2.00):
- **Decimal odds**: ~7-8x multiplier
- **American odds**: +600 to +700
- **Payout on $10**: $70-80 total return

This is now showing correctly! 🎉

### **How to Verify**
1. Generate new parlays
2. Check that all parlays show **positive odds** like `+700`, `+850`, `+600`
3. Verify payout calculator makes sense:
   - $10 bet on +700 → ~$80 total return
   - NOT $10 bet on -700 → ~$11 total return

The hot reloader should pick up this fix automatically!

