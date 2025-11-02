# 🔄 SUPABASE MIGRATION PLAN

## Current Situation

We started migrating from Prisma to Supabase, but **only 2 endpoints** were migrated:
- ✅ `app/api/games/today/route.js` - Uses Supabase
- ✅ `scripts/fetch-live-odds.js` - Uses Supabase

**Everything else (95% of the app) still uses Prisma**, causing continuous Prisma errors.

---

## Why Prisma Is Still Running

### Sources of Prisma Errors (in order of frequency):

1. **`/api/data`** endpoint (`app/api/data/route.js`)
   - Called by `ParlayBuilder.js` component on parlays page
   - Calls `getAllData()` from `lib/data-manager.js`
   - Triggers `refreshOdds()` which uses Prisma

2. **Background refresh** (`app/api/data/background-refresh/route.js`)
   - **NOW DISABLED** ✅
   - Was calling `getAllData()` automatically

3. **26 Library Files** still using Prisma:
   ```
   lib/data-manager.js
   lib/live-data.js
   lib/validation.js
   lib/parlay-generator.js
   lib/player-props.js
   lib/nfl-data.js
   lib/nhl-props.js
   ... and 19 more
   ```

4. **Multiple API Endpoints** calling Prisma functions

---

## Migration Options

### **Option A: Quick Fix - Disable Prisma Features** ⚡
**Time:** 30 minutes  
**Impact:** Temporary loss of some features

**What to disable:**
1. ✅ Background refresh (already done)
2. Parlay generator page
3. Props enhancement features
4. Validation system
5. Live data updates

**Pros:**
- Stops errors immediately
- No complex migration work
- Can re-enable features gradually

**Cons:**
- Users lose access to these features temporarily
- Not a permanent solution

---

### **Option B: Full Supabase Migration** 🔧
**Time:** 8-12 hours  
**Impact:** Complete replacement of Prisma

**Migration Steps:**

#### **Phase 1: Core Data Layer (2-3 hours)**
Migrate `lib/db.js` and `lib/data-manager.js`:
- Replace all `prisma.*` calls with Supabase queries
- Update `createOdds()`, `createGame()`, etc.
- Test with existing endpoints

#### **Phase 2: API Endpoints (2-3 hours)**
Migrate all `/api/*` routes:
- `/api/data/route.js` (most important!)
- `/api/live/*` routes
- `/api/cron/*` routes  
- `/api/nfl/*`, `/api/nhl/*` routes

#### **Phase 3: Feature Libraries (3-4 hours)**
Migrate feature-specific files:
- `lib/parlay-generator.js`
- `lib/validation.js`
- `lib/player-props*.js`
- `lib/nfl-props*.js`, `lib/nhl-props*.js`
- `lib/live-data.js`, `lib/live-scoring-manager.js`

#### **Phase 4: Testing & Cleanup (1-2 hours)**
- Test all features
- Remove Prisma dependencies
- Update documentation

**Pros:**
- Permanent solution
- No more Prisma errors
- Cleaner codebase
- Better for Vercel deployment

**Cons:**
- Time-intensive
- Risk of breaking features
- Need thorough testing

---

### **Option C: Hybrid Approach** ⚙️
**Time:** 2-4 hours  
**Impact:** Minimal feature loss

**What to do:**
1. Keep Prisma for **read-only** operations (no errors)
2. Use Supabase for **all writes** (create/update/delete)
3. Gradually migrate read operations over time

**Migration Priority:**
1. ✅ `lib/db.js` - `createOdds()` (already partially done)
2. ✅ `lib/vendors/odds.js` - remove invalid fields (done)
3. `lib/data-manager.js` - `refreshOdds()` function
4. `/api/data/route.js` - Use cached data only, no refresh
5. Other endpoints as needed

**Pros:**
- Quick wins (2-4 hours)
- Features keep working
- Errors stop immediately

**Cons:**
- Temporary hybrid state
- Still need full migration eventually

---

## **Recommended Approach: Option C (Hybrid)**

### **Immediate Actions (Next 30 min):**

1. **Disable `/api/data` refresh**:
   ```javascript
   // In app/api/data/route.js
   // Don't call getAllData() - return cached data only
   ```

2. **Update Parlay page** to use `/api/games/today` instead of `/api/data`

3. **Test homepage** - should work fine (already using Supabase)

### **Next Session Actions (2-3 hours):**

1. Migrate `lib/data-manager.js` core functions to Supabase
2. Test parlay generator with new data source
3. Verify props system still works

### **Future Session Actions (4-6 hours):**

1. Full Supabase migration of all lib files
2. Remove Prisma entirely
3. Update all documentation

---

## **What Features Still Work During Migration?**

✅ **Working Now:**
- Homepage (games list)
- Game cards with scores
- Today's slate page

⚠️ **Partially Working:**
- Player props (using cache, not refreshing)
- NHL/NFL games display

❌ **Broken/Disabled:**
- Background data refresh
- Parlay generation (triggers Prisma errors)
- Live odds updates (triggers Prisma errors)

---

## **Next Steps**

### **RIGHT NOW:**
1. Disable `/api/data` or make it read-only
2. Update parlay page to not trigger refresh
3. Test to confirm errors stop

### **THIS SESSION:**
1. Choose migration approach (A, B, or C)
2. Execute immediate fixes
3. Document what's working/broken

### **NEXT SESSION:**
1. Begin Phase 1 of chosen approach
2. Migrate critical functions
3. Re-enable features gradually

---

## **Decision Time!**

**Which approach do you want to take?**

- **A:** Disable features, stop errors, migrate slowly
- **B:** Full migration now (8-12 hours)
- **C:** Hybrid approach (2-4 hours to stop errors)

Let me know and I'll execute the plan immediately!

