# 📊 Betting Metrics Explained

## What Do These Percentages Mean?

### 1. **Edge** (Most Important!)
**What it is:** The mathematical advantage you have over the sportsbook on a bet.

**Formula:**
```
Edge = (Your Probability - Market's Implied Probability) / Market's Implied Probability
```

**Example:**
- Your model says Team A has a 60% chance to win
- The odds are -110 (52.4% implied probability)
- Edge = (0.60 - 0.524) / 0.524 = 14.5% edge

**What edge means:**
- **5-10% edge**: Good bet, worth considering
- **10-20% edge**: Strong bet, very good value
- **20%+ edge**: Exceptional bet (but verify your model!)
- **Negative edge**: Bad bet, avoid

**Where we calculate it:**
- `lib/edge.js` - Game-level edges (moneyline, totals)
- `lib/player-props.js` - Player prop edges
- `lib/simple-parlay-generator.js` - Parlay edges

### 2. **Probability**
**What it is:** Our model's calculated chance that a bet will win.

**Examples:**
- Single bet: 65% probability = 65% chance to win
- Parlay (3 legs @ 65% each): 0.65 × 0.65 × 0.65 = 27.5% probability

**Where we calculate it:**
- `lib/model.js` - Team win probabilities using advanced stats
- `lib/player-props.js` - Player prop probabilities based on projections vs thresholds
- `lib/simple-parlay-generator.js` - Combined parlay probability (multiply all legs)

### 3. **Expected Value (EV)**
**What it is:** The average amount you'd win/lose per $1 bet if you placed this bet many times.

**Formula:**
```
EV = (Probability × Payout) - (1 - Probability) × Stake
```

**Example:**
- Parlay: +250 odds (pays $2.50 per $1)
- Probability: 30%
- EV = (0.30 × 2.50) - (0.70 × 1) = 0.75 - 0.70 = +$0.05

**What it means:**
- **Positive EV (+)**: Good bet, you'll profit long-term
- **Negative EV (-)**: Bad bet, you'll lose long-term
- **+0.05 EV**: Expect to win $5 for every $100 bet over many trials

### 4. **Confidence Level**
**What it is:** How confident we are in the bet based on edge, data quality, and sample size.

**Levels:**
- **Very High**: 20%+ edge, strong data
- **High**: 10-20% edge, good data
- **Medium**: 5-10% edge, decent data
- **Low**: 0-5% edge, limited data

---

## Are We Pulling Live Odds Data? ✅ YES!

**Source:** The-Odds-API (https://the-odds-api.com/)
**API Key:** Configured in `.env.local`

**What we fetch:**
- ✅ Moneyline odds (h2h market)
- ✅ Spread/Runline odds
- ✅ Over/Under totals
- ✅ Multiple sportsbooks (best lines)
- ✅ Line movement tracking
- ✅ Opening vs current lines

**Fetch frequency:**
- Every 15 minutes during active games
- API usage limited to 500 calls/month ($10 plan)
- Smart caching to avoid unnecessary calls

**Code locations:**
- `lib/vendors/odds.js` - Fetches from The-Odds-API
- `app/api/cron/refresh-odds/route.js` - Refresh endpoint
- `lib/data-manager.js` - Manages odds caching

**Current limitation:** 
- We fetch live odds for game lines (moneyline, spreads, totals)
- **Player prop odds are currently estimated at -110** (not live)
- Reason: The-Odds-API doesn't include player props in our plan tier

---

## How to Calculate Parlay Payouts

### Current Parlay Display (What You See Now):
```
Edge: 14.5%
Expected Value: +0.12
Probability: 27.5%
Total Odds: 6.5 (displayed as +550)
```

### What's Missing: **PAYOUT CALCULATOR**

### How to Add Payouts:

The calculation is already done in `lib/simple-parlay-generator.js` (line 224-227):
```javascript
// Calculate combined odds
let totalOdds = 1
for (const bet of combination) {
  const decimalOdds = bet.odds > 0 ? (bet.odds / 100) + 1 : (100 / Math.abs(bet.odds)) + 1
  totalOdds *= decimalOdds
}
```

**Convert to American Odds (what's displayed):**
```javascript
// In formatOdds function
const formatOdds = (decimalOdds) => {
  if (decimalOdds >= 2) {
    return `+${Math.round((decimalOdds - 1) * 100)}`
  } else {
    return `-${Math.round(100 / (decimalOdds - 1))}`
  }
}
```

**Calculate Payout for Different Stakes:**
```javascript
function calculatePayout(decimalOdds, stake) {
  const profit = stake * (decimalOdds - 1)
  const totalReturn = stake + profit
  
  return {
    stake: stake,
    profit: profit.toFixed(2),
    totalReturn: totalReturn.toFixed(2)
  }
}
```

**Example Payouts for a +550 parlay (6.5 decimal odds):**
- $10 bet → $55 profit → $65 total return
- $25 bet → $137.50 profit → $162.50 total return
- $50 bet → $275 profit → $325 total return
- $100 bet → $550 profit → $650 total return

---

## Proposed Enhanced Parlay Display

### Current View:
```
Parlay #1 [HIGH]    +550
Edge: 14.5%
Expected Value: +0.12
3 Legs
```

### Enhanced View (What You Want):
```
Parlay #1 [HIGH]    +550 (6.5x)

💰 PAYOUT CALCULATOR
$10  → $55 profit  → $65 total
$25  → $137.50 profit  → $162.50 total
$50  → $275 profit  → $325 total
$100 → $550 profit  → $650 total

📊 METRICS
Edge: 14.5%           [Great value!]
Probability: 27.5%    [1 in 3.6 chance]
Expected Value: +$0.12 per $1 [Profitable long-term]

📈 LEGS (3)
⚾ Aaron Judge hits OVER 1.5 (-110)
   NYY vs TOR | Edge: 8.2%
⚾ Shohei Ohtani hits OVER 1.5 (-110)
   LAD vs PHI | Edge: 7.8%
⚾ Bryce Harper hits OVER 1.5 (-110)
   PHI @ LAD | Edge: 6.9%
```

---

## Next Steps to Enhance Display

1. **Add payout calculator to ParlayResults component** ✅
2. **Show visual profit/loss chart** 
3. **Add "Quick Bet" buttons** ($10, $25, $50, $100)
4. **Track historical parlay performance**
5. **Add risk/bankroll management suggestions**

Would you like me to implement the enhanced parlay display with payout calculations?



