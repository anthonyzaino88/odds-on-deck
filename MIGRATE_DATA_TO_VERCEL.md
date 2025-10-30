# 📦 Migrate Validation Data to Vercel

Quick guide to migrate your local validated props to production.

---

## 🎯 What This Does

Exports your **1,700+ validated props** from local SQLite and imports them into Vercel PostgreSQL.

This gives your demo:
- ✅ Real historical data
- ✅ Actual win rate statistics
- ✅ Prop type performance data
- ✅ Validation insights

---

## 📋 Steps

### **Step 1: Export from Local Database**

Run this on your local machine:

```bash
node scripts/export-validation-data.js
```

**Output:**
- `validation-data.json` - JSON backup (upload this)
- `validation-data.sql` - SQL statements (alternative method)

---

### **Step 2: Upload to Vercel**

**Option A: Using curl (Quick)**

```bash
# Replace YOUR_VERCEL_URL with your actual Vercel URL
curl -X POST https://YOUR_VERCEL_URL.vercel.app/api/import/validation-data \
  -H "Content-Type: application/json" \
  -d @validation-data.json
```

**Option B: Using PowerShell**

```powershell
$data = Get-Content validation-data.json -Raw
Invoke-WebRequest -Method POST `
  -Uri "https://YOUR_VERCEL_URL.vercel.app/api/import/validation-data" `
  -ContentType "application/json" `
  -Body $data
```

**Option C: Split into batches (if file is too large)**

```bash
# Split JSON into smaller files first
node scripts/split-validation-data.js

# Then upload each batch
curl -X POST https://YOUR_VERCEL_URL.vercel.app/api/import/validation-data \
  -H "Content-Type: application/json" \
  -d @validation-data-part1.json

curl -X POST https://YOUR_VERCEL_URL.vercel.app/api/import/validation-data \
  -H "Content-Type: application/json" \
  -d @validation-data-part2.json
```

---

### **Step 3: Verify Import**

Check the import was successful:

```bash
curl https://YOUR_VERCEL_URL.vercel.app/api/import/validation-data
```

**Expected Response:**
```json
{
  "total": 1700,
  "completed": 1650,
  "correct": 890,
  "incorrect": 760,
  "accuracy": 53.9
}
```

Or visit your validation page:
```
https://YOUR_VERCEL_URL.vercel.app/validation
```

---

## 📊 What Gets Migrated

- **PropValidation records** - All your validated props
- **Game references** - Links to games (gameIdRef)
- **Parlay associations** - Which parlays props came from
- **Results** - Actual vs predicted values
- **Statistics** - Win rates, edge accuracy, etc.

**Not migrated** (not needed for demo):
- Games table - Will be populated with fresh data
- Teams table - Will be populated with fresh data
- Player data - Not needed for prop validation display

---

## 🔒 Security Note

The import endpoint is **public** (for demo purposes). In production:
- Add authentication
- Or run once and disable the endpoint
- Or use Vercel's direct database access

---

## 🎉 After Migration

Your demo will show:
- ✅ Real validation history
- ✅ Actual win rate: ~54%
- ✅ Performance by prop type
- ✅ ROI calculations
- ✅ Edge accuracy

**Much more impressive for your portfolio!** 🚀

---

## 🆘 Troubleshooting

**File too large?**
- Split the JSON into smaller files (500 props each)
- Upload in batches

**Timeout error?**
- Reduce batch size
- Try uploading at off-peak hours

**Duplicate errors?**
- Safe to ignore - the script uses `upsert` (updates existing, creates new)

---

## ⚡ Quick Commands

```bash
# 1. Export local data
node scripts/export-validation-data.js

# 2. Upload to production
curl -X POST https://odds-on-deck.vercel.app/api/import/validation-data \
  -H "Content-Type: application/json" \
  -d @validation-data.json

# 3. Check results
curl https://odds-on-deck.vercel.app/api/import/validation-data
```

Done! 🎊

