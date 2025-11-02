# 🚀 Immediate Action Plan - Fix Homepage & Prepare for Migration

## Phase 1: FIX HOMEPAGE NOW (15 minutes)

### Step 1: Check if dynamic=force-dynamic is set
```bash
grep -r "export const dynamic" app/api/games/today/
```

### Step 2: Verify the API endpoint has proper flags
```javascript
// app/api/games/today/route.js should have:
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
```

### Step 3: Force Vercel rebuild
- Push empty commit (done ✅)
- Wait 5 minutes
- Check: https://odds-on-deck.vercel.app
- Homepage should show 28 games ✅

---

## Phase 2: Prepare for Supabase Migration (Today)

### Option A: Quick Win (This Week)
Just add `export const dynamic = 'force-dynamic'` to all problematic routes:

**Routes to Update:**
```bash
app/api/cron/live-refresh/route.js
app/api/cron/refresh-odds/route.js
app/api/cron/refresh-slate/route.js
app/api/data/refresh/route.js
app/api/demo/stats/route.js
app/api/cleanup/old-games/route.js
```

This prevents them from running at build time ✅

### Option B: Full Migration (Next 2 weeks)
1. Install Supabase client
2. Create `lib/supabase.js`
3. Migrate `/api/games/today` endpoint
4. Delete unused endpoints
5. Migrate other key endpoints one at a time

---

## Phase 3: Cleanup Unused Endpoints (Ongoing)

### Low Priority - Can Delete Immediately (Won't Affect App)
```
app/api/debug/*                    (9 endpoints)
app/api/setup/*                    (5 endpoints)
app/api/nfl/refresh*               (3 endpoints)
app/api/nhl/fix-nfl-data/          (1 endpoint)
app/api/nhl/diagnose/              (1 endpoint)
app/api/live/*                     (3 endpoints)
```

**Total: ~25 endpoints to delete**

### Medium Priority - Move to Scripts
```
app/api/cron/*                     (5 endpoints → scripts/)
app/api/nfl/*/live-*               (2 endpoints → scripts/)
app/api/nhl/fetch*                 (3 endpoints → scripts/)
```

**Total: ~10 endpoints to move**

### High Priority - Keep & Improve
```
✅ /api/games/today                Main endpoint (WORKING NOW)
✅ /api/games/[id]                 Keep
✅ /api/odds/save                  Keep (needed for data ingestion)
✅ /api/props/save                 Keep (needed for data ingestion)
✅ /api/validation/*               Keep (used by validation page)
✅ /api/parlays/save               Keep (used by parlay generator)
```

---

## Technical Debt Addressed

| Issue | Current | After |
|-------|---------|-------|
| Build Errors | ❌ Frequent | ✅ Gone |
| API Endpoints | 🚨 61 | ✅ 7-10 |
| Maintenance | 😫 High | ✅ Low |
| Deploy Time | ⏱️ 5-10min | ✅ 2-3min |
| Prisma Regenerate | 🔄 Every deploy | ✅ Never |

---

## Success Metrics

🎯 **Today**: Homepage shows 28 games  
🎯 **This Week**: Reduce to <20 API endpoints  
🎯 **Next Week**: Migrate to Supabase client  
🎯 **Long-term**: Build time <3 minutes, zero Prisma issues

---

## Quick Reference: What's Happening

### Before (Now):
1. User visits homepage
2. Frontend calls `/api/games/today`
3. Prisma client imports (generated at build time ❌)
4. Prisma connects to DB
5. If DB unreachable, returns empty array
6. Homepage shows 0 games 😞

### After (Migration):
1. User visits homepage
2. Frontend calls `/api/games/today`
3. Supabase client imports (loads at runtime ✅)
4. Supabase connects to DB
5. Returns data immediately
6. Homepage shows 28 games 🎉

### Why Supabase > Prisma for This Use Case
- Supabase is **just a thin wrapper** around PostgreSQL
- No build-time generation = no caching issues
- Direct SQL access = faster queries
- Real-time subscriptions built-in
- Perfect for betting app (need live updates!)

---

## Next Message Should Contain

After you see the homepage working:
```
"✅ Homepage is showing X games!"
```

Then we'll:
1. Delete unused endpoints
2. Migrate to Supabase
3. Clean up the codebase
4. Optimize for production
