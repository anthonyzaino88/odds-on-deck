# 🎯 Core Pages Implementation Plan

## Current Status

### ✅ Already Complete:
- **Editor's Picks** (`app/picks/page.js`) - Dark theme ✅, uses `getAllData()` 
- **Validation Dashboard** (`app/validation/page.js`) - Dark theme ✅, uses `lib/validation.js`

### ❌ Needs Implementation:
- **Player Props** (`app/props/page.js`) - Currently disabled, needs full rebuild
- **Parlay Generator** (`app/parlays/page.js`) - Currently disabled, needs full rebuild

### ⚠️ Needs Migration:
- **Validation Scripts** - Still use Prisma, need Supabase migration

---

## Implementation Order

### Phase 1: Player Props Page (Priority 1)
**Goal:** Re-implement Player Props page to query `PlayerPropCache` from Supabase

**Steps:**
1. Create API route `/api/props/route.js` to query `PlayerPropCache` table
2. Re-implement `app/props/page.js`:
   - Query props from Supabase (via API route)
   - Filter by sport, game, prop type
   - Display with dark theme
   - Use existing `PlayerPropsFilter` component
   - No direct API calls

**Files to Create/Update:**
- `app/api/props/route.js` (NEW)
- `app/props/page.js` (REBUILD)
- Verify `components/PlayerPropsFilter.js` works with Supabase data

---

### Phase 2: Parlay Generator (Priority 2)
**Goal:** Re-implement Parlay Generator to use database only

**Steps:**
1. Update `/api/parlays/generate/route.js`:
   - Query `PlayerPropCache` from Supabase
   - Query `Odds` table for game bets
   - Use `EdgeSnapshot` for calculated edges
   - No external API calls

2. Re-implement `app/parlays/page.js`:
   - Use `components/ParlayBuilder.js`
   - Use `components/ParlayResults.js`
   - Dark theme styling
   - Remove auto-refresh

**Files to Update:**
- `app/api/parlays/generate/route.js` (UPDATE - use Supabase)
- `app/parlays/page.js` (REBUILD)
- `lib/simple-parlay-generator.js` (UPDATE - use Supabase)

---

### Phase 3: Validation System Migration (Priority 3)
**Goal:** Migrate validation scripts to Supabase and ensure they work

**Steps:**
1. Update `scripts/validate-pending-props.js`:
   - Replace Prisma with Supabase queries
   - Query `PropValidation` table
   - Update validation records

2. Update `lib/validation.js`:
   - Replace Prisma with Supabase
   - Ensure `recordPropPrediction()` works
   - Ensure `getValidationStats()` works

**Files to Update:**
- `scripts/validate-pending-props.js` (MIGRATE)
- `scripts/check-pending-validations.js` (MIGRATE)
- `lib/validation.js` (MIGRATE)

---

## Data Sources

### PlayerPropCache Table Structure:
```sql
- id (String)
- propId (String, unique)
- gameId (String)
- playerName (String)
- team (String?)
- type (String) - "hits", "passing_yards", "goals", etc.
- pick (String) - "over" or "under"
- threshold (Float)
- odds (Int)
- probability (Float)
- edge (Float)
- confidence (String)
- qualityScore (Float)
- sport (String) - "mlb", "nfl", "nhl"
- category (String?) - "batting", "pitching", etc.
- reasoning (String?)
- projection (Float?)
- bookmaker (String?)
- gameTime (DateTime)
- fetchedAt (DateTime)
- expiresAt (DateTime)
- isStale (Boolean)
```

### PropValidation Table Structure:
```sql
- id (String)
- propId (String)
- gameIdRef (String)
- playerName (String)
- propType (String)
- pick (String) - "over" or "under"
- threshold (Float)
- odds (Int)
- probability (Float)
- edge (Float)
- actualValue (Float?) - Set after validation
- result (String?) - "correct", "incorrect", "push"
- status (String) - "pending", "completed", "needs_review"
- source (String) - "user_saved", "parlay_leg", "system_generated"
- timestamp (DateTime)
```

---

## Next Steps

1. **Start with Player Props Page** - This is the most visible missing feature
2. **Then Parlay Generator** - Users need this to create bets
3. **Finally Validation** - Critical for tracking accuracy but can work after props are saved

---

## Testing Checklist

After each phase:
- [ ] Page loads without errors
- [ ] Data displays correctly
- [ ] No API calls from frontend (check Network tab)
- [ ] Dark theme applied
- [ ] Responsive design works
- [ ] Links to game detail pages work

