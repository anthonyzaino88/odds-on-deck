# 🚀 Odds on Deck - Local Setup Guide

## Quick Start (Every Time)

### 1. Open Terminal/PowerShell
Navigate to your project:
```bash
cd "C:\Users\zaino\Desktop\Odds on Deck"
```

### 2. Start the Application
```bash
npm run dev
```

The app will start at: **http://localhost:3000**

---

## 🎯 What You Can Do Now

### View Today's Games
- Go to: http://localhost:3000/games
- See all today's MLB games with odds and edges

### View Game Lineups (1-9 Batting Order)
- Click on any game from the games page
- View complete batting lineups for both teams
- See player stats and handedness

### DFS Rankings
- Go to: http://localhost:3000/dfs
- View player value rankings for daily fantasy

---

## 🔄 Data Management

### Refresh Data Manually
If you want fresh data (odds, lineups, rosters):
```bash
# In browser, visit:
http://localhost:3000/api/cron/refresh-slate
```

### Force Refresh Rosters
If player assignments seem off:
```bash
# In browser, visit:
http://localhost:3000/api/debug/refresh-rosters
```

---

## 📊 Current Data Status

✅ **30 Teams** - All MLB teams loaded  
✅ **26 Games** - Today's schedule with lineups  
✅ **881 Players** - 840 assigned to current teams  
✅ **6,577 Odds** - Fresh betting lines (last update: just now)  
✅ **434 Edge calculations** - Betting advantages calculated  
✅ **Batting Lineups** - 1-9 order for active games  

---

## 🛠 Troubleshooting

### If the app won't start:
1. Make sure you're in the right directory
2. Run: `npm install`
3. Run: `npx prisma generate`
4. Run: `npm run dev`

### If data seems old:
Visit: http://localhost:3000/api/cron/refresh-slate

### If lineups are missing:
- Lineups are only available 2-3 hours before game time
- Some games may not have lineups announced yet

---

## 🎮 Ready to Use!

Your app is now running with:
- ✅ Current game data
- ✅ Live batting lineups (1-9)
- ✅ Fresh odds and edges
- ✅ Player stats and matchups

**Go to: http://localhost:3000** and explore your MLB data! 🏟️
