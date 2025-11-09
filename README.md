# 🎲 Odds on Deck - AI Sports Analytics Platform

> **Portfolio Demo Version** - AI-powered sports analytics for MLB, NFL & NHL with player props, betting edges, and real-time odds tracking.

![Next.js](https://img.shields.io/badge/Next.js-13-black)
![React](https://img.shields.io/badge/React-18-blue)
![Prisma](https://img.shields.io/badge/Prisma-ORM-green)
![The Odds API](https://img.shields.io/badge/The%20Odds%20API-Live%20Data-orange)

**Live Demo:** [Coming Soon - Nov 1st] *(API quota resets)*

---

## 🎯 Features

### **🎯 Editor's Picks**
- Top recommended plays across all sports
- Multi-tier quality filtering (Safe, Balanced, Value)
- AI-generated insights for each pick
- Separate picks by sport (NHL, NFL, MLB)
- Moneyline, totals, and player prop recommendations

### **📊 Player Prop Analytics**
- Real-time odds from The Odds API
- Advanced filtering by sport, confidence, edge, quality
- Live odds display with bookmaker info
- Projection vs. line comparison
- 200+ props analyzed daily

### **🎲 Smart Parlay Generator**
- AI-powered prop pick selection
- Quality score calculation (0-100)
- Edge detection and probability analysis
- Multi-sport parlay builder

### **📈 Validation System**
- Multi-tier prop tracking (Elite, High, Good quality)
- Automatic result validation via ESPN API
- Win rate and ROI tracking by sport
- Performance analytics by prop type
- 1,400+ props validated weekly

### **💡 Performance Insights**
- Sport-specific accuracy metrics
- Best/worst performing prop types
- ROI analysis and recommendations
- Historical trend tracking

---

## 🛠️ Tech Stack

- **Frontend:** Next.js 13, React 18, TailwindCSS
- **Backend:** Next.js API Routes
- **Database:** Supabase (PostgreSQL)
- **APIs:** 
  - The Odds API (betting odds & player props for MLB, NFL, NHL)
  - ESPN API (live scores, game stats & validation for all sports)
  - MLB Stats API (historical baseball data)
  - Supabase Realtime (live data updates)

---

## 📊 Architecture Highlights

### **Aggressive Caching Strategy**
- Frontend: 5-minute game data cache (90% API reduction)
- Backend: 5-minute prop cache with smart refresh
- Database: Cached odds with incremental updates

### **Validation Pipeline**
```
1. Prop Generated → 2. Saved to DB → 3. Game Completes 
→ 4. Auto-Validation → 5. Performance Analysis → 6. ML Feedback Loop
```

### **Quality Score Algorithm**
```javascript
QualityScore = (
  probability * 0.35 +
  edge * 0.30 +
  confidence * 0.25 +
  bookmakerReliability * 0.10
) * 100
```

---

## 🚀 Getting Started

### **Prerequisites**
- Node.js 18+
- npm or yarn

### **Installation**

```bash
# Clone repository
git clone https://github.com/yourusername/odds-on-deck.git
cd odds-on-deck

# Install dependencies
npm install

# Set up environment variables
cp env.demo.example .env.local

# Add your API key to .env.local
ODDS_API_KEY=your_key_here

# Initialize database
npx prisma generate
npx prisma db push

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔑 API Keys

This project uses **The Odds API** for live betting data:
- **Free Tier:** 500 requests/month (perfect for demos)
- **Get your key:** https://the-odds-api.com

---

## 📸 Screenshots

### Parlay Builder
Generate optimized parlays with AI-selected props:
![Parlay Builder](#)

### Player Props Dashboard
Filter and analyze thousands of props:
![Props Dashboard](#)

### Validation Analytics
Track performance and improve predictions:
![Validation Dashboard](#)

---

## 🎓 Learning Highlights

**What I Built:**
- End-to-end sports betting analytics platform
- Bayesian learning system for prediction improvement
- Complex API integration with rate limiting
- Automated validation and performance tracking

**Key Challenges Solved:**
- ⚡ Reduced API calls by 85% through aggressive caching
- 🎯 Implemented quality scoring algorithm for prop selection
- 🔄 Built automatic validation system with ESPN/MLB APIs
- 📊 Created CSV/JSON export pipeline for data analysis

---

## 📝 Available Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run backup       # Export all data (CSV/JSON)
npm run studio       # Open Prisma Studio (DB viewer)
```

---

## 🔮 Future Enhancements

- [x] Multi-sport support (MLB, NFL, NHL) ✅
- [x] Editor's Picks with AI insights ✅
- [x] Comprehensive validation system ✅
- [ ] Add historical trend analysis
- [ ] Implement user accounts & saved parlays
- [ ] Build mobile app (React Native)
- [ ] Add more sports (NBA, soccer)
- [ ] Live betting odds updates
- [ ] Bankroll management tools

---

## 📄 License

MIT License - Feel free to use this project as inspiration!

---

## 👤 Contact

**Anthony Zaino**  
- Portfolio: https://anthony-zaino-portfolio.vercel.app/
- GitHub: https://github.com/anthonyzaino88

---

## 🙏 Acknowledgments

- [The Odds API](https://the-odds-api.com) - Real-time betting odds
- [ESPN API](https://www.espn.com) - Game stats and results
- [MLB Stats API](https://statsapi.mlb.com) - Baseball data

---

**⭐ Star this repo if you find it interesting!**
