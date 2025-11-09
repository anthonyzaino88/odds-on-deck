# Prop Validation Quick Start Guide

## 🚀 Daily Workflow

### Morning (Before Games - 10 AM)

**Step 1: Save props for validation**
```bash
node scripts/save-top-props-for-validation.js
```

**Expected Output:**
```
📊 Saving Top Props for Validation...

🎯 Fetching props from multiple quality tiers...

📊 Props by tier:
   🏆 Elite (Q75+, P60+): 42
   ⭐ High (Q65-74, P55+): 68
   ✅ Good (Q55-64, P52+): 71
   📈 Total: 181

🏈 Props by sport:
   NFL: 45
   NHL: 82
   MLB: 54

✅ Saved: 181
⏭️  Skipped (already saved): 0
📈 Total props to validate: 181
```

### During/After Games (Every 30-60 min)

**Step 2: Validate completed props**
```bash
# Option A: Via API (if server is running)
curl -X POST http://localhost:3000/api/validation/check

# Option B: Via script (direct)
node scripts/check-and-validate-props.js
```

---

## 📊 Sample Size Breakdown

### What Gets Saved

| Tier | Quality Score | Probability | Count | Purpose |
|------|--------------|-------------|-------|---------|
| 🏆 Elite | 40-50 | ≥60% | 50 | Test our absolute best picks |
| ⭐ High | 35-39 | ≥55% | 75 | Validate good opportunities |
| ✅ Good | 30-34 | ≥52% | 75 | Analyze threshold calibration |
| **Total** | | | **200** | **Statistical significance** |

### Why Multiple Tiers?

**Elite Tier (40+)**
- These should have the highest win rate
- If not, your quality calculation needs tuning
- Target: 60-65% accuracy

**High Tier (35-39)**
- Should still be profitable
- Good risk/reward ratio
- Target: 55-60% accuracy

**Good Tier (30-34)**
- Tests lower boundary of model
- Helps determine minimum viable quality
- Target: 52-57% accuracy

---

## 📈 Benefits of Large Sample Size

### Before (20 props/day)
- ❌ 1 week = 140 props (not statistically significant)
- ❌ Hard to identify patterns
- ❌ Single bad day skews results
- ❌ Can't analyze by tier

### Now (200 props/day)
- ✅ 1 week = 1,400 props (highly significant)
- ✅ Clear performance patterns emerge
- ✅ Individual variance smoothed out
- ✅ Can compare tier performance
- ✅ Sport-specific insights
- ✅ Prop-type analysis possible

---

## 🎯 Key Metrics to Track

### Overall Performance

**Check your validation dashboard:** `/validation`

**Target Metrics:**
```
Elite Tier:   60-65% accuracy, 8-12% ROI
High Tier:    55-60% accuracy, 5-10% ROI
Good Tier:    52-57% accuracy, 2-8% ROI
Overall:      55-60% accuracy, 5-10% ROI
```

### Red Flags 🚩

**If Elite Tier < 55% accuracy:**
- Quality score calculation is broken
- Model predictions need recalibration
- Edge calculations are incorrect

**If Good Tier < 50% accuracy:**
- Threshold (30) is too low
- Raise minimum quality to 35-40

**If any tier has negative ROI:**
- Check if odds are accurate
- Verify probability calculations
- Review edge calculations

---

## 🔧 Troubleshooting

### No Props Saved

**Problem:** Script says "No props found to validate"

**Causes:**
1. No props in `PlayerPropCache` (need to fetch props first)
2. All props have low quality scores
3. All props are expired

**Solution:**
```bash
# Check if props exist
node scripts/check-player-props.js

# Fetch fresh props
node scripts/fetch-player-props.js

# Then run validation script again
node scripts/save-top-props-for-validation.js
```

### All Props Skipped

**Problem:** "Skipped (already saved): 200"

**Meaning:** All props already saved today ✅

**Action:** No action needed! Wait for tomorrow's props.

### Props Not Validating

**Problem:** Props stuck in "pending" status

**Causes:**
1. Games haven't finished yet
2. ESPN API down
3. Player names don't match

**Solution:**
```bash
# Check game statuses
node scripts/check-game-statuses.js

# Force revalidation
node scripts/revalidate-props.js
```

---

## 📅 Automation Setup

### Option 1: Windows Task Scheduler

**Save Props Daily (10 AM):**
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily at 10:00 AM
4. Action: Start a program
   - Program: `node`
   - Arguments: `scripts/save-top-props-for-validation.js`
   - Start in: `C:\Users\zaino\Desktop\Odds on Deck`

**Validate Props (Every 30 min, 2-11 PM):**
1. Create Basic Task
2. Trigger: Daily
3. Advanced: Repeat task every 30 minutes for 9 hours
4. Start at: 2:00 PM
5. Action: Run validation check

### Option 2: Manual (Recommended at First)

Run manually for 1-2 weeks to:
- Ensure everything works
- Monitor for issues
- Understand the data flow
- Then automate once confident

---

## 📊 Expected Weekly Data

With 200 props/day × 7 days = **1,400 props/week**

### Distribution (typical)

```
Sport Breakdown:
  NHL: ~600 props (42%)
  NFL: ~400 props (28%) 
  MLB: ~400 props (28%)

Prop Type Breakdown:
  Goals/Points: ~500 props
  Assists: ~300 props
  Shots: ~250 props
  Other: ~350 props

Quality Breakdown:
  Elite (75+): ~350 props
  High (65-74): ~525 props
  Good (55-64): ~525 props
```

---

## 🎓 Learning from Data

### Week 1: Establish Baseline
- Run script daily
- Let props validate automatically
- Don't make changes yet
- Observe patterns

### Week 2: Identify Issues
- Which tiers underperform?
- Which sports/prop types struggle?
- Are probabilities calibrated?
- Is edge calculation accurate?

### Week 3: Adjust Thresholds
- Raise quality minimums if needed
- Adjust probability calculations
- Fine-tune edge model
- Test changes

### Week 4: Measure Improvement
- Compare to baseline
- Did accuracy improve?
- Is ROI increasing?
- Iterate further

---

## 💡 Pro Tips

1. **Save before games start** - Don't save props mid-game (odds change)

2. **Check validation daily** - Monitor the `/validation` dashboard

3. **Track by sport** - Different sports have different predictability

4. **Review failures** - Why did high-quality props lose? Learn from them.

5. **Compare to Editor's Picks** - Are validation props same as what users see?

6. **Adjust seasonally** - Performance may vary by time of season

7. **Monitor data quality** - Bad input = bad validation = bad insights

---

## ✅ Success Checklist

- [ ] Run save script daily (manually or automated)
- [ ] Check validation dashboard weekly
- [ ] Track accuracy by tier
- [ ] Monitor ROI by sport
- [ ] Review prop failures monthly
- [ ] Adjust model based on data
- [ ] Document changes and results

---

## 🎯 Goal

**Get 1,400+ validated props/week to:**
- Achieve statistical significance
- Identify model weaknesses
- Calibrate probabilities accurately
- Improve quality scoring
- Maximize user ROI

**Current Status:** System ready! Run daily to build data.

---

## 📚 Further Reading

- Full details: `VALIDATION_SYSTEM_GUIDE.md`
- Insights system: `PICK_INSIGHTS_GUIDE.md`
- Edge calculation: `HONEST_EDGE_CALCULATION.md`

