# 🔄 Auto-Refresh System

## Overview
The auto-refresh system keeps your Odds on Deck application data current and accurate by automatically updating:
- **MLB Games & Teams**: Schedule, rosters, and team data
- **Live Scores**: Real-time game scores and status
- **Betting Odds**: Current odds from multiple sportsbooks
- **Edge Calculations**: Updated betting edge analysis
- **NFL Data**: Games, rosters, and live scores

## 🚀 How It Works

### 1. **Automatic Backend Refresh**
- **Endpoint**: `/api/cron/auto-refresh`
- **Frequency**: Every 5 minutes (configurable)
- **Updates**: Teams, games, odds, edges, live scores, NFL data

### 2. **Frontend Auto-Refresh**
- **Component**: `AutoRefresh` (30-60 second intervals)
- **Pages**: Dashboard and Games page
- **Features**: 
  - Manual refresh button
  - Auto-refresh toggle
  - Countdown timer
  - Last update timestamp

### 3. **Live Score Updates**
- **Component**: `LiveScoreDisplay`
- **Frequency**: Every 30 seconds for active games
- **Features**:
  - Real-time score updates
  - Inning/status display
  - Manual refresh button
  - No full page reload needed

## 🛠️ Setup & Usage

### **Option 1: Use Built-in Frontend Auto-Refresh**
The frontend automatically refreshes data every 30-60 seconds. Users can:
- Toggle auto-refresh on/off
- Manually refresh data
- See countdown timer
- View last update time

### **Option 2: Run Cron Job Script**
```bash
# Start the cron job script
node scripts/setup-cron.js
```

This will:
- Refresh data every 5 minutes
- Log all updates to console
- Run continuously until stopped

### **Option 3: Manual API Calls**
```bash
# Refresh all data
curl http://localhost:3000/api/cron/auto-refresh

# Refresh only live scores
curl http://localhost:3000/api/live-scores/refresh
```

## 📊 What Gets Updated

### **Every 5 Minutes:**
- ✅ **30 MLB Teams** - Roster and team data
- ✅ **4 MLB Games** - Schedule and game info
- ✅ **Betting Odds** - Current odds from sportsbooks
- ✅ **Edge Calculations** - Updated betting analysis
- ✅ **3 Live Scores** - Real-time game scores
- ✅ **14 NFL Games** - NFL schedule and data

### **Every 30 Seconds (Frontend):**
- ✅ **Live Game Scores** - Active games only
- ✅ **Game Status** - Inning, outs, baserunners
- ✅ **Final Scores** - Completed games

## 🎯 Benefits

### **For Users:**
- **Always Current Data**: No stale information
- **Real-time Scores**: Live game updates
- **Accurate Odds**: Current betting lines
- **Fresh Edges**: Updated betting analysis

### **For Developers:**
- **Automated Maintenance**: No manual intervention needed
- **Error Handling**: Robust error recovery
- **Logging**: Detailed update logs
- **Configurable**: Adjustable refresh intervals

## 🔧 Configuration

### **Refresh Intervals:**
```javascript
// Frontend auto-refresh (milliseconds)
<AutoRefresh refreshInterval={30000} /> // 30 seconds

// Live score updates (milliseconds)
<LiveScoreDisplay refreshInterval={30000} /> // 30 seconds

// Cron job interval (milliseconds)
const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes
```

### **Error Handling:**
- Failed API calls are logged but don't stop the system
- Individual game/team errors don't affect others
- Automatic retry on next refresh cycle

## 📈 Monitoring

### **Check System Status:**
```bash
# Test auto-refresh endpoint
curl http://localhost:3000/api/cron/auto-refresh

# Check live scores
curl http://localhost:3000/api/live-scores/refresh

# View current games
curl http://localhost:3000/api/games/today
```

### **Logs:**
- Console logs show update counts
- Error logs for failed operations
- Timestamp for each refresh cycle

## 🎉 Result

Your Odds on Deck application now has:
- ✅ **Always current data** - No more stale information
- ✅ **Real-time updates** - Live scores and odds
- ✅ **Automatic maintenance** - No manual intervention needed
- ✅ **User-friendly interface** - Clear refresh controls
- ✅ **Robust error handling** - System keeps running even with errors

The Reds game (and all other games) will now show accurate, up-to-date information automatically!
