# Validation System Quick Reference

## ✅ What's Working

### MLB
✅ All prop types validated automatically  
✅ Player name matching (handles accents)  
✅ Pitching stats (innings, earned runs, strikeouts, etc.)  
✅ Batting stats (hits, runs, RBIs, etc.)  

### NFL  
✅ All prop types validated automatically  
✅ ESPN API integration working  

### NHL
⚠️ 140 old props marked "invalid" (from bug in old code)  
✅ Future props will validate correctly  

---

## 🔄 How Validation Works

1. **Automatic:** Runs every 5 minutes via auto-refresh cron job
2. **Checks:** All "pending" props where game is "final" or date is yesterday or earlier
3. **Updates:** Marks props as "completed" with actual value and win/loss result

---

## 🎯 Manual Validation

```powershell
# PowerShell
Invoke-WebRequest -Method POST -Uri http://localhost:3000/api/validation/check

# Git Bash / Linux
curl -X POST http://localhost:3000/api/validation/check
```

---

## 📊 View Validation Stats

```powershell
# PowerShell
Invoke-WebRequest -Uri http://localhost:3000/api/validation/check

# Git Bash / Linux
curl http://localhost:3000/api/validation/check
```

Returns:
```json
{
  "success": true,
  "pending": 37,
  "completed": 263,
  "correct": 78,
  "accuracy": 0.296
}
```

---

## 🐛 Troubleshooting

### Props stuck as "pending"?
1. Check if game is marked "final": `SELECT * FROM Game WHERE id = 'GAME_ID'`
2. Check if game has `mlbGameId` (MLB) or `espnGameId` (NFL/NHL)
3. Run manual validation: `Invoke-WebRequest -Method POST -Uri http://localhost:3000/api/validation/check`

### Props marked "needs_review"?
- **MLB:** Check if player name matches (might need accent normalization)
- **NFL/NHL:** Check if player was in the game (might be inactive/injured)
- **All:** Can manually verify by checking game stats online

### Reset a prop to re-validate:
```javascript
await prisma.propValidation.update({
  where: { id: 'PROP_ID' },
  data: {
    status: 'pending',
    actualValue: null,
    result: null,
    notes: null,
    completedAt: null
  }
})
```

---

## 📝 Recent Fixes (Oct 19, 2025)

1. ✅ Added `earned_runs` stat mapping for MLB
2. ✅ Fixed `innings_pitched` data type (string → number)
3. ✅ Added player name accent normalization for MLB

**Result:** All October 18th MLB props validated successfully!

---

## 📈 Export Validation Data

```powershell
# Export parlays to CSV
Invoke-WebRequest -Uri "http://localhost:3000/api/export/parlays?format=csv" -OutFile "parlays.csv"

# Export validation stats to CSV
Invoke-WebRequest -Uri "http://localhost:3000/api/export/stats?format=csv" -OutFile "stats.csv"

# Or run backup script
npm run backup
```

---

**Need more details?** See:
- `MLB_VALIDATION_FIX_SUMMARY.md` - Recent MLB fixes
- `VALIDATION_MATH_EXPLAINED.md` - How the learning system works
- `HOW_VALIDATION_TRACKING_WORKS.md` - Complete validation guide



