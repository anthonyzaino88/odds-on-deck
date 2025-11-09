# Payout Calculator Test

## Example: Parlay with +2010 odds (21.10x decimal)

### Correct Calculations:

**$10 Bet:**
- Decimal odds: 21.10
- Profit: $10 × (21.10 - 1) = $10 × 20.10 = **$201**
- Total return: $10 + $201 = **$211**

**$25 Bet:**
- Profit: $25 × 20.10 = **$502.50** → rounds to **$503**
- Total return: $25 + $502.50 = **$527.50** → rounds to **$528**

**$50 Bet:**
- Profit: $50 × 20.10 = **$1,005**
- Total return: $50 + $1,005 = **$1,055**

**$100 Bet:**
- Profit: $100 × 20.10 = **$2,010**
- Total return: $100 + $2,010 = **$2,110**

---

## Example: Parlay with +181 odds (2.81x decimal)

**$10 Bet:**
- Decimal odds: 2.81
- Profit: $10 × (2.81 - 1) = $10 × 1.81 = **$18.10** → rounds to **$18**
- Total return: $10 + $18.10 = **$28.10** → rounds to **$28**

**$25 Bet:**
- Profit: $25 × 1.81 = **$45.25** → rounds to **$45**
- Total return: $25 + $45.25 = **$70.25** → rounds to **$70**

**$50 Bet:**
- Profit: $50 × 1.81 = **$90.50** → rounds to **$91**
- Total return: $50 + $90.50 = **$140.50** → rounds to **$141**

**$100 Bet:**
- Profit: $100 × 1.81 = **$181**
- Total return: $100 + $181 = **$281**

---

## Formula

Given **American odds** (e.g., +2010):
1. Convert to decimal: `decimalOdds = (americanOdds / 100) + 1` = `(2010 / 100) + 1` = `21.10`
2. Calculate profit: `profit = stake × (decimalOdds - 1)`
3. Calculate total: `total = stake + profit`

Given **decimal odds** directly (e.g., 21.10):
1. Calculate profit: `profit = stake × (decimalOdds - 1)`
2. Calculate total: `total = stake + profit`

## What Was Fixed

The `calculatePayout` function was already using the correct formula. The fix was:
1. Changed from `.toFixed(2)` to `Math.round()` for cleaner rounding
2. Display format now shows whole dollars: `.toFixed(0)` instead of showing cents
3. This makes the display cleaner: `+$201 → $211` instead of `+$201.00 → $211.00`

