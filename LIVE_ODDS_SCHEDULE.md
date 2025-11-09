# Live Odds Update Schedule

With your **$30/month plan (20,000 requests)**, you can run live odds updates frequently!

## 📊 Budget Analysis

**Available:** 20,000 requests/month = 666/day

**Recommended Schedule:**
- Morning fetch: 3 requests
- Live updates (10-min intervals, 6 PM - 11 PM): ~110 requests/day
- **Total:** ~113 requests/day = 3,390/month (17% of budget)

You have **plenty of headroom** for live updates! 🎉

---

## 🚀 Quick Start

### Option 1: Manual Testing

```bash
# Test the live update script
node scripts/update-live-odds.js
```

This fetches fresh odds for all sports (MLB, NFL, NHL).

### Option 2: Automated Schedule (Recommended)

Set up Windows Task Scheduler to run automatically.

---

## 🤖 Windows Task Scheduler Setup

### Step 1: Create Morning Update Task

1. Open **Task Scheduler** (search in Windows)
2. Click **"Create Basic Task"**
3. **Name:** "Odds on Deck - Morning Odds"
4. **Trigger:** Daily at **9:00 AM**
5. **Action:** Start a program
   - **Program:** `node`
   - **Arguments:** `scripts/fetch-live-odds.js all --cache-fresh`
   - **Start in:** `C:\Users\zaino\Desktop\Odds on Deck`
6. **Finish**

### Step 2: Create Live Update Task

1. **Create Basic Task**
2. **Name:** "Odds on Deck - Live Updates"
3. **Trigger:** Daily
4. **Action:** Start a program
   - **Program:** `node`
   - **Arguments:** `scripts/update-live-odds.js`
   - **Start in:** `C:\Users\zaino\Desktop\Odds on Deck`
5. After creating, **right-click → Properties**
6. **Triggers tab → Edit:**
   - Start: **5:00 PM**
   - **Repeat task every:** 10 minutes
   - **For a duration of:** 7 hours
   - ✅ Enabled
7. **OK** to save

### Step 3: Create Late Night Update (Optional)

For West Coast games:
1. **Create Basic Task**
2. **Name:** "Odds on Deck - Late Update"
3. **Trigger:** Daily at **11:30 PM**
4. **Action:** Start a program
   - **Program:** `node`
   - **Arguments:** `scripts/fetch-live-odds.js all --cache-fresh`
   - **Start in:** `C:\Users\zaino\Desktop\Odds on Deck`

---

## 📅 Full Schedule Summary

| Time | Task | Requests | Purpose |
|------|------|----------|---------|
| 9:00 AM | Morning fetch | 3 | Fresh odds for the day |
| 12:00 PM | Midday refresh | 3 | Updated afternoon lines |
| 5:00 PM - 12:00 AM | Live updates (every 10 min) | ~126 | Real-time odds during games |
| **Daily Total** | | **~132** | |
| **Monthly Total** | | **~3,960** | 20% of budget |

---

## ⚡ Alternative Schedules

### Conservative (Every 15 minutes)
```
Daily: ~65 requests
Monthly: ~1,950 (10% budget)
```

**Setup:** Change "Repeat task every" to **15 minutes** in Step 2

### Aggressive (Every 5 minutes)
```
Daily: ~260 requests
Monthly: ~7,800 (39% budget)
```

**Setup:** Change "Repeat task every" to **5 minutes** in Step 2

### Game Days Only

You can also set up **different schedules for different days**:

**NFL Sundays:**
- 12:00 PM - 11:00 PM: Every 5 minutes (NFL only)

**NHL Weeknights:**
- 6:00 PM - 11:00 PM: Every 10 minutes (NHL only)

---

## 🔍 Monitoring

### Check if updates are running:

**View last update:**
```bash
# Check Supabase Odds table
# Look at updatedAt timestamp
```

**View Task Scheduler logs:**
1. Open Task Scheduler
2. Task Scheduler Library
3. Right-click task → **History** tab

### API Usage Tracking:

The Odds API dashboard shows your usage:
- https://the-odds-api.com/account

**Monitor to ensure you stay under 20,000/month**

---

## 💡 Tips

### During Low-Activity Periods:
- **Off-season:** Disable live updates, only morning fetch
- **No games scheduled:** Skip that day's updates

### During High-Activity:
- **Playoffs:** Increase to every 5 minutes
- **Big betting days:** Add extra pre-game fetches

### Optimize by Sport:
```bash
# Only update sports with games today
node scripts/fetch-live-odds.js nfl nhl  # Skip MLB in off-season
```

---

## 🎯 Recommended Starting Point

**Week 1: Test with conservative schedule**
- Morning: 9 AM
- Live: Every 15 minutes (5 PM - 11 PM)
- Monitor API usage

**Week 2+: Adjust based on needs**
- If under budget → Increase to 10 minutes
- If odds are accurate → Maybe 15 min is fine
- If users want real-time → Go to 5 minutes

---

## 🚨 Budget Alerts

Set up alerts when you hit certain thresholds:

**5,000 requests (25%):** ✅ On track
**10,000 requests (50%):** ⚠️ Monitor closely  
**15,000 requests (75%):** 🚨 Reduce frequency
**18,000 requests (90%):** ⛔ Stop live updates

---

## 📊 Expected Results

With 10-minute live updates, your users will see:
- ✅ Fresh odds every 10 minutes during games
- ✅ Real-time line movements
- ✅ Updated player props
- ✅ Live probabilities and edges
- ✅ Better betting decisions

**And you'll still use less than 20% of your API budget!** 🎉

---

## Next Steps

1. ✅ Test manual update: `node scripts/update-live-odds.js`
2. ✅ Set up morning task (9 AM daily)
3. ✅ Set up live updates (every 10 min, 5-12 PM)
4. 📊 Monitor usage for 1 week
5. 🎯 Adjust frequency based on needs and budget

**Your live odds are now ready!** 🚀

