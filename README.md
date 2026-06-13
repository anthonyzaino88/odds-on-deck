# 🎲 Odds on Deck - AI Sports Analytics Platform

> **Portfolio Demo** - AI-powered sports analytics for MLB, NFL & NHL with player props, betting edges, and real-time odds tracking.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![React](https://img.shields.io/badge/React-18-blue)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green)
![The Odds API](https://img.shields.io/badge/The%20Odds%20API-Live%20Data-orange)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-black)

---

## 🎯 Features

### **🏠 Live Dashboard**
- Real-time game counts across MLB, NFL, NHL
- Live score tracking with status indicators
- Quick navigation to sport-specific views
- Mobile-responsive design

### **🎯 Editor's Picks**
- AI-curated betting recommendations
- Multi-tier quality filtering:
  - 🛡️ **Safe Mode** - 52%+ win probability
  - ⚖️ **Balanced** - Optimal quality score
  - 💰 **Value** - Best expected value (EV)
  - 🎰 **All** - Complete list sorted by quality
- Separate picks by sport (NHL, NFL, MLB)
- Moneyline, totals, and player prop recommendations

### **📊 Player Props Analytics**
- Real-time odds from The Odds API
- Advanced filtering by sport, confidence, edge
- Live odds display with bookmaker info
- Projection vs. line comparison
- Quality score tiering (Elite, Premium, Solid, Speculative, Longshot)

### **🎲 Smart Parlay Generator**
- AI-powered prop selection algorithm
- Quality score calculation (0-100)
- Multi-sport parlay building
- Save & track parlays for validation
- Parlay history with performance tracking

### **📈 Validation System**
- Automatic result validation via ESPN API
- Win rate and ROI tracking by sport
- Performance analytics by prop type
- Source tracking (User Saved, Parlay Legs, System Generated)
- Real odds-based ROI calculation

### **💡 Performance Insights**
- Sport-specific accuracy metrics (NFL, NHL, MLB)
- Best/worst performing prop types grouped into System, Prop Type, and Player tiers
- Actionable recommendations with search and filtering
- Historical trend analysis
- Break-even tracking (52.4% for standard -110 odds)

### **💰 DFS Rankings** *(Coming Soon)*
- Daily Fantasy Sports player values
- Projection-based value rankings
- Salary optimization tools

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Frontend** | Next.js 14 (App Router), React 18, TailwindCSS |
| **Design system** | Custom "terminal" UI (data-dense, dark-first), Geist Sans/Mono |
| **Backend** | Next.js API Routes |
| **Database** | Supabase (PostgreSQL) with Row Level Security |
| **Server access** | Supabase secret key for server-side writes (never exposed to the client) |
| **Deployment** | Vercel |

### **APIs Integrated**
- **The Odds API** - Real-time betting odds & player props for MLB, NFL, NHL
- **ESPN API** - Live scores, game stats & result validation
- **MLB Stats API** - Historical baseball data

---

## 📊 Architecture Highlights

### **Database Layer**
- Supabase PostgreSQL with Row Level Security (RLS)
- Admin client for write operations
- Efficient query patterns with joins
- Auto-generated unique IDs

### **Quality Score Algorithm**
```javascript
QualityScore = (
  probability * 0.70 +    // Win likelihood (most important)
  confidence * 0.20 +     // Consistency/reliability
  edge * 0.10             // Bonus when available from real data
) * 100
```

### **Honest Edge System**
- Most props have edge=0 (honest - no fake edges)
- Real edge only from line shopping or projection models
- Quality based primarily on WIN PROBABILITY
- Expected Value (EV) sorting for value plays

### **Validation Pipeline**
```
1. Prop Generated → 2. Saved to DB → 3. Game Completes 
→ 4. ESPN API Validation → 5. Result Updated → 6. Performance Analysis
```

### **Security & Compliance**
- Row Level Security enabled on all tables; internal archive tables are locked to the secret key only
- Admin/cron write endpoints protected by a shared `CRON_SECRET`
- Strict Content Security Policy and security headers (HSTS, X-Frame-Options, etc.); `unsafe-eval` is dev-only
- No debug/diagnostic endpoints in production
- Privacy Policy and Terms & Disclaimer pages with responsible-gambling notices

---

## 🚀 Getting Started

### **Prerequisites**
- Node.js 18+
- npm or yarn
- Supabase account (free tier works)

### **Installation**

```bash
# Clone repository
git clone https://github.com/anthonyzaino88/odds-on-deck.git
cd odds-on-deck

# Install dependencies
npm install

# Set up environment variables
cp env.example .env.local

# Add your keys to .env.local
DATABASE_URL=postgresql://user:password@host:port/db
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_supabase_secret_key
ODDS_API_KEY=your_odds_api_key
CRON_SECRET=a_long_random_string

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔑 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string (Prisma) | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (browser) key — RLS enforced | ✅ |
| `SUPABASE_SECRET_KEY` | Supabase secret key for server-side writes (bypasses RLS) | ✅ |
| `ODDS_API_KEY` | The Odds API key | ✅ |
| `CRON_SECRET` | Shared secret protecting admin/cron write endpoints | ✅ |

### **API Keys**
- **The Odds API** - Free Tier: 500 requests/month → [Get Key](https://the-odds-api.com)
- **Supabase** - Free tier available → [Get Started](https://supabase.com)

---

## 📱 Pages Overview

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Dashboard with game counts & navigation |
| Games | `/games` | Today's slate with live scores |
| Game Detail | `/game/[id]` | Individual game analysis |
| Editor's Picks | `/picks` | AI-curated recommendations |
| Player Props | `/props` | Comprehensive prop analytics |
| Parlays | `/parlays` | Parlay generator & history |
| Validation | `/validation` | Accuracy tracking dashboard |
| Insights | `/insights` | Performance analysis |
| DFS | `/dfs` | Daily fantasy rankings |
| Privacy | `/privacy` | Privacy policy |
| Terms | `/terms` | Terms & disclaimer |

---

## 📝 Available Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run Jest tests

# Validation & Data
npm run validate     # Validate pending props
npm run validate:parlays  # Validate saved parlays
npm run validate:all      # Run all validations
npm run backup       # Export all data (CSV/JSON)

# Export
npm run export:csv   # Export parlays to CSV
npm run export:stats # Export performance stats
```

---

## 🔮 Future Enhancements

- [x] Multi-sport support (MLB, NFL, NHL) ✅
- [x] Editor's Picks with AI insights ✅
- [x] Comprehensive validation system ✅
- [x] Supabase database migration ✅
- [x] Performance insights dashboard ✅
- [x] Security hardening (RLS, CSP headers, privacy/terms) ✅
- [x] Terminal-style design system & brand refresh ✅
- [ ] Add NBA, Soccer support
- [ ] User accounts & saved preferences
- [ ] Mobile app (React Native)
- [ ] Live betting odds updates
- [ ] Full DFS integration
- [ ] Bankroll management tools
- [ ] Historical trend analysis

---

## 🎓 Technical Highlights

**What I Built:**
- End-to-end sports betting analytics platform
- Quality scoring algorithm for prop selection
- Complex multi-API integration with error handling
- Automated validation and performance tracking
- Real-time data caching and optimization

**Key Challenges Solved:**
- ⚡ Efficient caching strategy to minimize API costs
- 🎯 Honest edge system avoiding fake/inflated edges
- 🔄 Automatic validation with ESPN/MLB APIs
- 📊 ROI calculation using actual recorded odds
- 🏠 Live score tracking with status normalization
- 📱 Mobile-responsive dark theme UI

---

## 📄 License

MIT License - Feel free to use this project as inspiration!

---

## 👤 Contact

**Anthony Zaino**  
- Portfolio: [anthony-zaino-portfolio.vercel.app](https://anthony-zaino-portfolio.vercel.app/)
- GitHub: [github.com/anthonyzaino88](https://github.com/anthonyzaino88)

---

## 🙏 Acknowledgments

- [The Odds API](https://the-odds-api.com) - Real-time betting odds
- [ESPN API](https://www.espn.com) - Game stats and results
- [MLB Stats API](https://statsapi.mlb.com) - Baseball data
- [Supabase](https://supabase.com) - Database & authentication
- [Vercel](https://vercel.com) - Deployment platform

---

**⭐ Star this repo if you find it interesting!**
