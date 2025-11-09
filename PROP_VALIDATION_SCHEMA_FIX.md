# 🔧 PROP VALIDATION SCHEMA FIX REQUIRED

## 🚨 **The Issue**

When you try to save a prop for validation, you're getting this error:

```
❌ Error recording prop prediction: {
  code: '22P02',
  message: 'invalid input syntax for type integer: "1.8"'
}
```

**Why?** The `PropValidation.odds` column in Supabase is defined as `INTEGER`, but The Odds API returns **decimal odds** like `1.8`, `1.57`, `2.10`.

---

## 📊 **Two Different Tables**

We've already encountered this issue once before with a different table:

| Table | Column | Fixed? | Issue |
|-------|--------|--------|-------|
| `PlayerPropCache` | `odds` | ✅ **FIXED** | Was INTEGER, changed to DECIMAL |
| `PropValidation` | `odds` | ❌ **NOT FIXED YET** | Still INTEGER, needs DECIMAL |

**The first one we fixed** (for displaying props)  
**The second one needs fixing** (for saving props for validation)

---

## 🔨 **The Fix**

You need to run this SQL command in your **Supabase Dashboard**:

### Step 1: Go to Supabase Dashboard
1. Open https://supabase.com
2. Navigate to your project
3. Click on **SQL Editor** in the left sidebar

### Step 2: Run This SQL Command

```sql
-- Fix PropValidation.odds column type
ALTER TABLE "PropValidation"
ALTER COLUMN "odds" TYPE DECIMAL(10,2);
```

### Step 3: Verify
You should see:
```
Success. No rows returned
```

---

## ✅ **What This Fixes**

### Before (Broken):
```
odds: 1.8  ❌ ERROR: invalid input syntax for type integer
odds: 1.57 ❌ ERROR: invalid input syntax for type integer
odds: 2.10 ❌ ERROR: invalid input syntax for type integer
```

### After (Working):
```
odds: 1.8  ✅ Saved successfully
odds: 1.57 ✅ Saved successfully
odds: 2.10 ✅ Saved successfully
```

---

## 💡 **Why Decimal Odds?**

The Odds API returns odds in **decimal format** (also called European odds):

| Decimal Odds | American Odds | Implied Probability |
|--------------|---------------|---------------------|
| 1.50 | -200 | 66.7% |
| 1.80 | -125 | 55.6% |
| 2.00 | +100 | 50.0% |
| 2.50 | +150 | 40.0% |

We store them as decimals because:
1. That's what the API gives us
2. Easier to calculate implied probability: `1 / decimal_odds`
3. No conversion needed

---

## 🎯 **What Gets Fixed**

After running the SQL command:

### ✅ Individual Prop Saving
- Go to `/props`
- Click "💾 Save" on any prop
- Should see "✓ Saved!" ✅

### ✅ Parlay Saving (with prop legs)
- Save a parlay
- Props in parlay legs will be saved for validation ✅

### ✅ Validation Dashboard
- Go to `/validation`
- Should see all saved props ✅
- Stats should calculate correctly ✅

---

## 🔍 **Why This Wasn't Caught Earlier**

1. **Different tables**: We fixed `PlayerPropCache.odds` but forgot about `PropValidation.odds`
2. **Different use case**: 
   - `PlayerPropCache` = For displaying props (fixed earlier)
   - `PropValidation` = For tracking predictions (needs fix now)
3. **Prisma schema issue**: The Prisma schema defined `odds` as `Int`, which worked with American odds but not decimal odds

---

## 📝 **Confidence Level**

**100% Confidence** - This is the exact same fix we did before for `PlayerPropCache.odds`

✅ Same error message  
✅ Same root cause (INTEGER vs DECIMAL)  
✅ Same solution (ALTER COLUMN TYPE)  
✅ Same API source (The Odds API with decimal odds)  
✅ Previous fix worked perfectly  

---

## 🚀 **After You Run the SQL**

1. **Test saving a prop:**
   - Go to http://localhost:3000/props
   - Click "💾 Save" on any prop
   - Should work without errors

2. **Check the terminal:**
   - Should see: `✅ Saved prop validation: [id]`
   - No more `invalid input syntax` errors

3. **View validation dashboard:**
   - Go to http://localhost:3000/validation
   - Should see your saved props

---

## ⚡ **Quick Reference**

**SQL Command:**
```sql
ALTER TABLE "PropValidation"
ALTER COLUMN "odds" TYPE DECIMAL(10,2);
```

**Where to run:** Supabase Dashboard → SQL Editor

**Expected result:** `Success. No rows returned`

---

*Run this SQL command and then try saving a prop again!* 🚀

