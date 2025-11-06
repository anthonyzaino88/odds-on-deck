# 🚀 Loading Data on Vercel - Complete Guide

## How It Works

Your scripts connect to **Supabase** (the same database Vercel uses), so when you run scripts locally, the data immediately appears on your Vercel site!

**Key Point:** Your local `.env.local` file should have the same Supabase credentials that Vercel uses.

---

## ✅ Step-by-Step: Daily Data Refresh

### **STEP 1: Fetch Games from ESPN**

This populates the `Game` table with today's scheduled games:

```bash
# Fetch all sports (NFL + NHL)
node scripts/fetch-fresh-games.js all

# OR fetch individually:
node scripts/fetch-fresh-games.js nfl
node scripts/fetch-fresh-games.js nhl
```

**What it does:**
- Fetches games from ESPN API
- Saves to Supabase `Game` table
- Creates game IDs like `UTA_at_TOR_2025-11-05`
- Stores `espnGameId` for later use

**Wait for this to complete before Step 2!**

---

### **STEP 2: Fetch Odds from The Odds API**

This populates the `Odds` and `PlayerPropCache` tables:

```bash
# Fetch odds for all sports
node scripts/fetch-live-odds.js all

# OR fetch individually:
node scripts/fetch-live-odds.js nfl
node scripts/fetch-live-odds.js nhl
```

**What it does:**
- Maps games to Odds API events
- Fetches moneyline, spreads, totals
- Fetches player props
- Saves to Supabase `Odds` and `PlayerPropCache` tables

**Wait for this to complete!**

---

### **STEP 3: Refresh Live Scores (Optional)**

Only run this if games are currently in progress:

```bash
node scripts/refresh-nhl-scores.js
```

**What it does:**
- Updates scores for active games
- Updates game status
- Stores period/quarter info

---

## 🎯 Quick One-Liner (All Sports)

```bash
node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all
```

---

## 📋 Complete Daily Workflow

**For a fresh start each day:**

```bash
# 1. Fetch all games
node scripts/fetch-fresh-games.js all

# 2. Wait for completion, then fetch odds
node scripts/fetch-live-odds.js all

# 3. (Optional) Refresh live scores if games are active
node scripts/refresh-nhl-scores.js
```

---

## ✅ Verify Your Data is on Vercel

After running the scripts:

1. **Check your Vercel site:** https://your-site.vercel.app
2. **Check Today's Slate page** - Should show games with odds
3. **Check a game detail page** - Should show odds and props

The data appears immediately because both local scripts and Vercel use the same Supabase database!

---

## 🔧 Environment Variables Check

Make sure your `.env.local` has:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Optional, for scripts that need admin access
ODDS_API_KEY=your-odds-api-key
```

**These should match what's set in Vercel's environment variables!**

---

## 📊 Expected Results

**After Step 1 (Games):**
```
✅ Saved 5 NHL games
✅ Saved 10 NFL games
```

**After Step 2 (Odds):**
```
✅ Mapped 5 NHL games to Odds API
✅ Saved 15 odds records
✅ Saved 50 player props
```

**Then on Vercel:**
- Homepage shows game counts
- Today's Slate shows games with odds
- Game detail pages show full odds and props

---

## ⚠️ Important Notes

1. **Order Matters:** Always fetch games BEFORE odds
2. **Wait for Completion:** Don't run odds script until games script finishes
3. **Same Database:** Local scripts and Vercel use the same Supabase database
4. **Rate Limits:** Odds API has monthly limits, don't run too frequently
5. **One-Time Setup:** Once games/odds are fetched, they persist until you refresh

---

## 🆘 Troubleshooting

**If data doesn't appear on Vercel:**

1. **Check Supabase connection:**
   ```bash
   node scripts/test-connection.js
   ```

2. **Verify environment variables match:**
   - Local `.env.local` 
   - Vercel Dashboard → Settings → Environment Variables

3. **Check Vercel logs:**
   - Vercel Dashboard → Your Deployment → Functions → View Logs

4. **Verify data in Supabase:**
   - Go to Supabase Dashboard → Table Editor
   - Check `Game`, `Odds`, `PlayerPropCache` tables

---

## 🎯 TL;DR - Quick Reference

```bash
# Morning routine (before games start):
node scripts/fetch-fresh-games.js all
node scripts/fetch-live-odds.js all

# During games (optional):
node scripts/refresh-nhl-scores.js
```

**That's it!** Data appears on Vercel immediately because you're using the same Supabase database.

