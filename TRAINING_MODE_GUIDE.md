# 🧪 Training Mode Guide

## What is Training Mode?

**Training Mode** lets you generate and validate player props **without using the paid Odds API**. Instead, it uses **100% free APIs** (ESPN, MLB Stats) to create statistical predictions and track their accuracy.

### Perfect For:
- ✅ When Odds API monthly limit is reached (like now until Nov 1st)
- ✅ Testing your validation system
- ✅ Building a training dataset for ML models
- ✅ Tracking accuracy without API costs
- ✅ Development and testing

---

## 🎯 How It Works

### 1. **Generate Mock Props**
```
Uses Free APIs → Statistical Models → Generate Props → Save to Database
```

**What it does:**
- Fetches today's games from ESPN (free)
- Gets player stats from MLB Stats API / ESPN (free)
- Calculates probabilities using Poisson distribution
- Generates synthetic odds using statistical models
- Saves as "mock props" in `MockPropValidation` table

**No Odds API calls = No cost!**

### 2. **Wait for Games to Finish**
Games play out normally...

### 3. **Validate Results**
```
Fetch Actual Stats (free APIs) → Compare to Predictions → Calculate Accuracy
```

**What it does:**
- Checks which games are finished
- Fetches actual player stats from free APIs
- Compares to your predictions
- Records results (correct/incorrect/push)
- Updates accuracy statistics

---

## 📱 Using Training Mode

### Access the Page
**URL**: https://odds-on-deck.vercel.app/training

### Step-by-Step

#### Step 1: Generate Props
1. Visit `/training` page
2. Click **"🎲 Generate Props"** button
3. Wait a few seconds
4. See confirmation: "Generated X props for Y games"

#### Step 2: Wait for Games
- Games need to finish before validation
- Check game status at `/games` (Today's Slate)

#### Step 3: Validate Results
1. Return to `/training` page
2. Click **"✅ Validate Props"** button
3. See results: accuracy, correct/incorrect counts

#### Step 4: View Details
- Click **"📊 View Validation Dashboard"** to see all results
- Or **"💡 View Insights"** for advanced analytics

---

## 🔌 API Endpoints

### Generate Mock Props
```bash
POST /api/training/generate
```

**Response:**
```json
{
  "success": true,
  "generated": 150,
  "games": 5,
  "saved": 150,
  "message": "Generated 150 mock props for 5 games"
}
```

### Validate Completed Props
```bash
POST /api/training/validate
```

**Response:**
```json
{
  "success": true,
  "validated": 45,
  "correct": 25,
  "incorrect": 20,
  "message": "Validated 45 mock props"
}
```

### Get Training Stats
```bash
GET /api/training/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "pending": 105,
    "completed": 45,
    "correct": 25,
    "incorrect": 20,
    "pushes": 0,
    "accuracy": 0.556
  }
}
```

---

## 📊 Database Storage

### Mock Props Table: `MockPropValidation`

Training Mode props are stored separately from real props:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `gameIdRef` | Reference to game |
| `playerName` | Player name |
| `propType` | Type of prop (hits, passing_yards, etc.) |
| `threshold` | Line value (e.g., 1.5 hits) |
| `prediction` | "over" or "under" |
| `projectedValue` | Your model's prediction |
| `probability` | Win probability |
| `syntheticOdds` | Calculated odds (not from bookmaker) |
| `actualValue` | Result after validation |
| `result` | "correct", "incorrect", or "push" |
| `status` | "pending" or "completed" |
| `sport` | "mlb", "nfl", or "nhl" |

**Separate table** means mock props don't interfere with real prop tracking!

---

## 🆚 Training Mode vs Real Props

| Feature | Training Mode | Real Props |
|---------|--------------|------------|
| **API Used** | ESPN, MLB Stats (FREE) | The Odds API (PAID) |
| **Cost** | $0 | Uses API quota |
| **Odds Source** | Statistical models | Real bookmaker lines |
| **Purpose** | Testing, training, dev | Live betting analysis |
| **Accuracy** | Good baseline | Best accuracy |
| **Availability** | Always available | Limited by quota |
| **Storage** | `MockPropValidation` | `PropValidation` |

---

## 🎓 Training Mode Workflow

### Daily Routine (While Odds API is Limited)

**Morning:**
```bash
1. Visit /training
2. Click "Generate Props"
3. Review generated props
```

**Evening (After Games):**
```bash
1. Visit /training
2. Click "Validate Props"
3. Check accuracy statistics
4. View results in /validation dashboard
```

**Over Time:**
- Build a dataset of predictions
- Track model accuracy trends
- Identify which prop types work best
- Train ML models on historical data

---

## 🔧 Technical Details

### Prop Generation Logic

```javascript
// 1. Fetch player recent stats (free API)
const stats = await getPlayerRecentStats(playerName, propType)

// 2. Calculate probability using Poisson distribution
const probability = calculateOverProbability(stats.average, threshold)

// 3. Convert to odds
const syntheticOdds = probabilityToOdds(probability)

// 4. Generate edge
const edge = (probability - impliedProbability(syntheticOdds)) * 100

// 5. Save prop
await saveMockProp({
  playerName,
  propType,
  threshold,
  prediction: 'over',
  probability,
  syntheticOdds,
  edge
})
```

### Validation Logic

```javascript
// 1. Get pending mock props
const pendingProps = await getPendingMockProps()

// 2. Check if games are finished
for (const prop of pendingProps) {
  const game = await getGame(prop.gameIdRef)
  if (!isGameFinal(game)) continue
  
  // 3. Fetch actual stat (free API)
  const actualValue = await getActualStat(
    game.id,
    prop.playerName,
    prop.propType
  )
  
  // 4. Determine result
  const result = checkResult(
    actualValue,
    prop.threshold,
    prop.prediction
  )
  
  // 5. Update prop
  await updateMockProp(prop.id, {
    actualValue,
    result,
    status: 'completed'
  })
}
```

---

## 📈 Use Cases

### 1. **Odds API Limit Hit**
When you've used your monthly quota (like now):
- Generate props with Training Mode
- Continue tracking accuracy
- Resume real props on Nov 1st

### 2. **Model Development**
Testing new prediction algorithms:
- Generate props with your model
- Validate against real results
- Compare accuracy to baseline

### 3. **Training Dataset**
Building ML training data:
- Generate daily props for months
- Accumulate thousands of predictions
- Use for model training

### 4. **A/B Testing**
Comparing different approaches:
- Run two models side-by-side
- Track which performs better
- Optimize your strategy

---

## 🚀 Getting Started NOW

Since your Odds API is at limit until Nov 1st:

### Today (Oct 31):
```bash
1. Visit https://odds-on-deck.vercel.app/training
2. Click "Generate Props"
3. Wait for tonight's games to finish
4. Validate tomorrow morning
```

### Tomorrow (Nov 1):
```bash
1. Validate today's props
2. Your Odds API resets!
3. Can use both Training Mode AND real props
4. Compare accuracy between the two
```

---

## 📊 Expected Accuracy

### Training Mode (Mock Props)
- **MLB Hitting:** 50-55% (based on Poisson models)
- **MLB Pitching:** 55-60% (more predictable)
- **NFL Passing:** 48-52% (high variance)
- **NHL Scoring:** 50-55% (medium variance)

### Real Props (Odds API)
- **All Props:** 52-58% (bookmaker lines are sharper)
- **High Confidence:** 58-62%

**Training Mode provides a good baseline** without any API costs!

---

## 🔮 Future Enhancements

Potential improvements to Training Mode:

1. **Multiple Models**: Compare Poisson vs Neural Network vs XGBoost
2. **Feature Engineering**: Add weather, injuries, rest days
3. **Real-time Stats**: Stream live stats during games
4. **Ensemble Methods**: Combine multiple model predictions
5. **Auto-learning**: Retrain models based on results

---

## ✅ Summary

**Training Mode = Free prop generation & validation**

- ✅ Uses only free APIs
- ✅ Available 24/7 (no quotas)
- ✅ Separate from real prop tracking
- ✅ Perfect for development & testing
- ✅ Builds training datasets
- ✅ Live at `/training` right now!

---

**Start using Training Mode today** while waiting for your Odds API to reset on Nov 1st! 🧪

---

*Created: October 31, 2025*  
*Status: Live on production* ✅

