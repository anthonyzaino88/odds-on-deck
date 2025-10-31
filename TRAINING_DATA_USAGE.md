# 🎓 Training Mode Data - What To Do With It

## What Training Mode Data Is

Training Mode generates **mock props** (shadow props) using free APIs and statistical models. After games finish, these props are validated against actual results. This creates a **dataset of predictions vs reality**.

---

## 📊 Current Uses (What's Already Built)

### 1. **Accuracy Dashboard** (`/training` page)
See your model's performance in real-time:
- Overall accuracy across all props
- Accuracy by sport (MLB, NFL, NHL)
- Accuracy by prop type (hits, yards, goals, etc.)
- Props breakdown (pending vs completed)
- Game status tracking

### 2. **Validation History** (`/validation` page)
- View all completed validations
- Filter by sport, prop type, result
- See correct/incorrect predictions
- Compare mock props vs real props

### 3. **Cost Savings Tracker**
Every mock prop saves you ~$0.01 in API costs:
- 1,000 props = $10 saved
- 10,000 props = $100 saved
- Free to generate unlimited props!

---

## 🚀 Advanced Uses (What You Can Build)

### **Use Case 1: Train Machine Learning Models** 🤖

**Goal:** Improve prediction accuracy from 52% → 58%+

**How:**
```javascript
// Step 1: Export training data
const response = await fetch('/api/training/export?format=analysis')
const data = await response.json()

// Step 2: Prepare features
const features = data.rawData.map(prop => [
  prop.expectedValue,
  prop.threshold,
  prop.probability,
  prop.qualityScore,
  encodeSport(prop.sport),
  encodePropType(prop.propType)
])

const labels = data.rawData.map(prop => 
  prop.result === 'correct' ? 1 : 0
)

// Step 3: Train model (using TensorFlow.js, scikit-learn, etc.)
const model = await trainModel(features, labels)

// Step 4: Use model for future predictions
const futureProps = generateProps()
const predictions = model.predict(futureProps)
const bestProps = predictions.filter(p => p.confidence > 0.6)
```

**Benefit:** Data-driven prop selection with proven accuracy

---

### **Use Case 2: Find Your Edge** 💰

**Goal:** Identify which props you're best at predicting

**How:**
```javascript
// Export analysis
const response = await fetch('/api/training/export?format=analysis')
const data = await response.json()

// Find strong edges
const edges = Object.entries(data.byPropType)
  .filter(([type, stats]) => stats.total >= 20) // Min sample size
  .map(([type, stats]) => ({
    propType: type,
    accuracy: stats.accuracy,
    edge: (stats.accuracy - 0.5) * 100, // % edge over coinflip
    volume: stats.total
  }))
  .sort((a, b) => b.edge - a.edge)

console.log('Your best edges:', edges.slice(0, 5))
// Output:
// [
//   { propType: 'rushing_yards', accuracy: 0.61, edge: 11%, volume: 45 },
//   { propType: 'hits', accuracy: 0.58, edge: 8%, volume: 120 },
//   ...
// ]

// Focus on high-edge props
const highEdgeProps = edges.filter(e => e.edge > 5)
```

**Benefit:** Only bet on props where you have a statistical edge

---

### **Use Case 3: Export to Excel/CSV for Analysis** 📈

**How:**
```bash
# Download CSV file
curl "https://odds-on-deck.vercel.app/api/training/export?format=csv" > training-data.csv

# Open in Excel/Google Sheets
# Analyze with pivot tables, charts, regression analysis
```

**Excel Analysis Examples:**
- **Pivot Table**: Accuracy by Sport x Prop Type
- **Chart**: Accuracy trend over time
- **Regression**: Which factors predict success?
- **What-If Analysis**: Optimal bet sizing

---

### **Use Case 4: Build a Bankroll Management System** 💵

**Goal:** Size bets based on proven performance

**How:**
```javascript
// Get historical accuracy for a prop type
async function getAccuracy(propType, sport) {
  const response = await fetch('/api/training/export?format=analysis')
  const data = await response.json()
  
  return data.byPropType[propType]?.accuracy || 0.5
}

// Kelly Criterion bet sizing
function kellyBet(accuracy, odds, bankroll) {
  const winProbability = accuracy
  const edge = winProbability - (1 / (odds + 1))
  
  if (edge <= 0) return 0 // No edge, no bet
  
  const kellyPercentage = edge / odds
  const betSize = kellyPercentage * bankroll
  
  // Use half-kelly for safety
  return betSize * 0.5
}

// Example
const accuracy = await getAccuracy('hits', 'mlb')
const betSize = kellyBet(accuracy, 1.91, 1000) // $1000 bankroll
console.log(`Bet $${betSize.toFixed(2)}`)
```

**Benefit:** Mathematically optimal bet sizing

---

### **Use Case 5: Model Calibration** 📐

**Goal:** Ensure your probabilities are accurate

**How:**
```javascript
// Check calibration
const response = await fetch('/api/training/export?format=analysis')
const data = await response.json()

// Props you predict at 60% should hit 60% of the time
const calibration = data.insights.calibration

calibration.forEach(bucket => {
  const diff = Math.abs(bucket.probability - bucket.actualAccuracy)
  if (diff > 0.1) {
    console.log(`⚠️ Miscalibrated at ${bucket.probability}`)
    console.log(`   Predicted: ${bucket.probability}`)
    console.log(`   Actual: ${bucket.actualAccuracy}`)
  }
})
```

**Benefit:** Trust your probability estimates

---

### **Use Case 6: Automated Daily Reports** 📧

**Goal:** Get daily insights emailed to you

**How:**
```javascript
// In a cron job (runs daily at 9 AM)
async function generateDailyReport() {
  const response = await fetch('/api/training/export?format=analysis')
  const data = await response.json()
  
  const report = `
    📊 Daily Training Report - ${new Date().toDateString()}
    
    Yesterday's Performance:
    - Props Generated: ${data.summary.total}
    - Accuracy: ${(data.summary.accuracy * 100).toFixed(1)}%
    
    Best Prop Types:
    ${data.insights.bestPropTypes.map(p => 
      `  ✅ ${p.propType}: ${(p.accuracy * 100).toFixed(1)}%`
    ).join('\n')}
    
    Worst Prop Types:
    ${data.insights.worstPropTypes.map(p => 
      `  ❌ ${p.propType}: ${(p.accuracy * 100).toFixed(1)}%`
    ).join('\n')}
    
    Recommendations:
    - Focus on ${data.insights.bestPropTypes[0]?.propType}
    - Avoid ${data.insights.worstPropTypes[0]?.propType}
  `
  
  await sendEmail(report)
}
```

**Benefit:** Stay informed without manual checking

---

### **Use Case 7: A/B Testing** 🧪

**Goal:** Compare different prediction models

**How:**
```javascript
// Model A: Simple average
// Model B: Weighted recent games
// Model C: Machine learning

// Generate props with each model, tagged
await generateMockProps({ model: 'simple', tag: 'model_a' })
await generateMockProps({ model: 'weighted', tag: 'model_b' })
await generateMockProps({ model: 'ml', tag: 'model_c' })

// After validation, compare
const modelA_accuracy = getAccuracyByTag('model_a')
const modelB_accuracy = getAccuracyByTag('model_b')
const modelC_accuracy = getAccuracyByTag('model_c')

console.log('Best model:', Math.max(modelA, modelB, modelC))
```

**Benefit:** Continuously improve your approach

---

## 📥 How to Export Training Data

### **Option 1: JSON (for code)**
```bash
curl "https://odds-on-deck.vercel.app/api/training/export"
```

### **Option 2: CSV (for Excel)**
```bash
curl "https://odds-on-deck.vercel.app/api/training/export?format=csv" > data.csv
```

### **Option 3: Analysis (pre-computed insights)**
```bash
curl "https://odds-on-deck.vercel.app/api/training/export?format=analysis"
```

### **Filters:**
```bash
# MLB props only
/api/training/export?sport=mlb

# Completed props only
/api/training/export?status=completed

# Combined
/api/training/export?sport=nfl&status=completed&format=csv
```

---

## 🎯 Recommended Workflow

### **Daily:**
1. Generate props in the morning
2. Let games play out
3. Validate after games finish
4. Review accuracy dashboard

### **Weekly:**
1. Export data to CSV
2. Analyze in Excel
3. Identify best/worst prop types
4. Adjust strategy

### **Monthly:**
1. Train ML model on accumulated data
2. Compare model accuracy to baseline
3. Deploy improved model
4. Track ROI improvements

---

## 💡 Key Insights to Track

### **1. Accuracy by Sample Size**
Small samples (< 20) are unreliable
Focus on prop types with 50+ validations

### **2. Accuracy by Confidence Level**
High confidence should be 60%+
Low confidence around 50% (coinflip)

### **3. Calibration**
Props at 70% should hit 70% of the time
If miscalibrated, adjust probability formulas

### **4. Edge Persistence**
Does your edge hold over time?
Or was it lucky variance?

### **5. Cost-Benefit**
Is manual analysis worth it?
Or should you automate everything?

---

## 🚀 Next Steps

### **Immediate (This Week):**
1. Generate 500+ props
2. Validate after games
3. Review accuracy dashboard
4. Identify 2-3 strong prop types

### **Short-term (This Month):**
1. Export CSV weekly
2. Build Excel analysis template
3. Track edge by prop type
4. Focus bets on high-edge props

### **Long-term (3-6 Months):**
1. Accumulate 5,000+ validations
2. Train ML model
3. Automate prop generation daily
4. Build bankroll management system
5. Track P&L and ROI

---

## 📊 Expected Results

### **Baseline (No Training Data):**
- 50% accuracy (random guessing)
- No edge
- Break even long-term

### **With Training Data Analysis:**
- 54-56% accuracy (small edge)
- 4-6% ROI
- Profitable long-term

### **With ML Model:**
- 58-62% accuracy (strong edge)
- 8-12% ROI
- Very profitable long-term

---

## ✅ Summary

**Training Mode data lets you:**
1. ✅ **Track accuracy** - See what's working
2. ✅ **Find edges** - Identify profitable prop types
3. ✅ **Train models** - Build ML prediction systems
4. ✅ **Size bets** - Use Kelly Criterion
5. ✅ **A/B test** - Compare different approaches
6. ✅ **Calibrate** - Improve probability estimates
7. ✅ **Export** - Analyze in Excel/Python/R
8. ✅ **Automate** - Build daily reporting
9. ✅ **Improve** - Continuously refine strategy
10. ✅ **Save money** - No API costs!

**The more data you generate, the more valuable it becomes!**

---

*Pro Tip: Generate 100+ props daily for 30 days to build a statistically significant dataset (3,000+ samples)*

