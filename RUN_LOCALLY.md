# Run Odds on Deck Locally with SQLite

## ✅ Why SQLite for Local Development?

- **FREE** - No monthly limits
- **UNLIMITED** - Query as much as you want
- **FAST** - No network latency
- **SIMPLE** - Just a file on your computer

---

## 🚀 Quick Start

### 1. **Reset Database (One Time)**

```bash
npx prisma migrate reset --force
```

This will:
- Delete old database
- Create fresh `prisma/dev.db`
- Run all migrations
- Set up tables

### 2. **Start Development Server**

```bash
npm run dev
```

The app will run at `http://localhost:3000`

### 3. **Fetch Fresh Game Data**

Visit in your browser:
- **NHL**: `http://localhost:3000/api/nhl/fix-and-fetch`
- **MLB**: Auto-fetches on page load
- **NFL**: Auto-fetches on page load

---

## 📊 Testing Today's Games

### Option 1: Homepage
```
http://localhost:3000
```

Should show:
- ⚾ MLB: 1 game (if there's a game tonight)
- 🏈 NFL: Games this week
- 🏒 NHL: 3 games for Oct 31

### Option 2: Today's Slate
```
http://localhost:3000/games
```

Full list of all games with odds, scores, status.

### Option 3: Direct ESPN Check (No Database)
```
http://localhost:3000/api/live/todays-games-direct
```

Shows what ESPN says is happening today (bypasses database).

---

## 🔧 Useful Commands

### View Database in Prisma Studio
```bash
npx prisma studio
```

Opens GUI at `http://localhost:5555` to browse/edit data.

### Check Database
```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Game WHERE sport='nhl';"
```

### Clear Just NHL Games
```bash
sqlite3 prisma/dev.db "DELETE FROM Game WHERE sport='nhl';"
```

### See All Games
```bash
sqlite3 prisma/dev.db "SELECT id, sport, date, status FROM Game ORDER BY date DESC LIMIT 20;"
```

---

## 🐛 Troubleshooting

### "Database locked" Error
```bash
# Kill any processes using the database
npx prisma studio  # Close if open
# Then restart dev server
```

### Games Not Showing
1. Check what's in database:
   ```bash
   npx prisma studio
   ```
2. Manually fetch NHL games:
   ```
   http://localhost:3000/api/nhl/fix-and-fetch
   ```
3. Check timezone logic is working:
   ```
   http://localhost:3000/api/debug/check-game-dates
   ```

### Wrong Date/Time
The app uses **Eastern Time** for "today". If you're in a different timezone, games might appear at unexpected times. This is correct - sports schedules use ET.

---

## 📝 Key Differences: SQLite vs PostgreSQL

| Feature | SQLite (Local) | PostgreSQL (Vercel) |
|---------|----------------|---------------------|
| Cost | FREE, unlimited | FREE with limits |
| Location | `prisma/dev.db` file | Remote server |
| Speed | FAST (local) | Slower (network) |
| Queries | UNLIMITED | 100K/month free |
| Perfect For | Development | Production |

---

## 🚀 When Ready for Production

To deploy to Vercel with PostgreSQL:

1. **Change schema back:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

2. **Commit and push:**
```bash
git add prisma/schema.prisma
git commit -m "Switch to PostgreSQL for production"
git push origin main
```

3. **Wait for Prisma limits to reset** (usually 1st of the month)

4. **Or upgrade Prisma plan** (paid tier has higher limits)

---

## 💡 Best Practice

**For Development:** Use SQLite (what we just did)  
**For Production:** Use PostgreSQL on Vercel (when limits reset)

This way you can:
- Develop and test locally with unlimited queries
- Deploy to production when ready
- Avoid hitting API/database limits during development

---

## 🎯 Current Status

✅ **SQLite is now configured**  
✅ **Excessive logging removed**  
✅ **Timezone fixes in place**  
✅ **Game filtering logic updated**  

**Next:** Run `npx prisma migrate reset --force` and `npm run dev` to start!


