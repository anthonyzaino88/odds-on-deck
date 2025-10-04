# ⚾ Odds on Deck

An MLB matchup analytics web application that ingests live MLB data and betting odds to compute pitcher-hitter and team matchup edges, surfacing insights for betting and fantasy sports.

## 🚀 Features

- **Today's Slate**: View all MLB games with market odds, model projections, and edge calculations
- **Game Detail**: Deep-dive into individual matchups with batter vs pitcher analysis
- **DFS Rankings**: Daily Fantasy Sports player value rankings based on projections vs salary
- **Real-time Data**: Live MLB stats and betting odds integration
- **Edge Detection**: Automated calculation of betting value across moneyline and totals markets

## 🛠 Tech Stack

- **Frontend**: Next.js 14 (App Router) + JavaScript + Tailwind CSS
- **Backend**: Node.js + Next.js API Routes
- **Database**: PostgreSQL + Prisma ORM
- **Data Sources**: MLB Stats API + The Odds API
- **Deployment**: Vercel (with Vercel Cron for scheduled jobs)

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL database
- The Odds API key (sign up at [the-odds-api.com](https://the-odds-api.com/))

## ⚡ Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd odds-on-deck
npm install
```

### 2. Environment Setup

Copy the example environment file and configure your settings:

```bash
cp env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# App Configuration
APP_NAME="Odds on Deck"

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/oddsondeck"

# APIs
ODDS_API_KEY="your_odds_api_key_here"

# Next.js
NEXTAUTH_SECRET="your_secret_here"
NEXTAUTH_URL="http://localhost:3000"
```

### 3. Database Setup

Generate Prisma client and run migrations:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Seed the database with initial team data:

```bash
npm run seed
```

### 4. Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

### 5. Initial Data Load

Load today's games and odds data:

```bash
curl http://localhost:3000/api/cron/refresh-slate
```

Or visit the endpoint in your browser to trigger the data refresh manually.

## 📊 Usage

### Today's Slate

Navigate to `/games` to see:
- All scheduled MLB games for today
- Probable starting pitchers
- Market totals vs model projections
- Moneyline and total betting edges
- Last updated timestamps

### Game Details

Click on any game to view:
- Detailed team and pitcher information
- Park factors and environmental conditions
- Batter vs pitcher matchup analysis
- Odds movement history from multiple books

### DFS Rankings

Visit `/dfs` for:
- Hitter and pitcher value rankings
- Projected fantasy points
- Value calculations (projection ÷ salary)
- Team contexts and matchup notes

## 🔄 Data Pipeline

The application runs automated data collection via the refresh-slate cron job:

1. **Teams & Players**: Fetches MLB rosters and basic player data
2. **Schedule**: Gets today's games with probable pitchers
3. **Odds**: Collects real-time betting lines from US sportsbooks
4. **Edge Calculation**: Runs matchup model to compute betting edges
5. **Storage**: Persists all data with timestamps for historical analysis

### Manual Refresh

Trigger data updates manually:

```bash
# Development
curl http://localhost:3000/api/cron/refresh-slate

# Production
curl https://your-domain.vercel.app/api/cron/refresh-slate
```

## 🧪 Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

Test coverage includes:
- Utility functions (odds conversion, edge calculation)
- API endpoints (data ingestion, game details)
- Core business logic (matchup modeling)

## 🗄 Database Schema

Key models:

- **Team**: MLB teams with park factors
- **Player**: Players with handedness and position data
- **Game**: Individual games with probable pitchers
- **Odds**: Betting lines with timestamps for history
- **SplitStat**: Player performance splits (vs L/R, recent form)
- **PitchMix**: Pitcher repertoire and effectiveness data
- **EdgeSnapshot**: Model outputs and betting edges

View the database:

```bash
npx prisma studio
```

## 🔧 Configuration

### Vercel Cron Setup

For production deployment, add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-slate",
      "schedule": "0 */15 * * *"
    }
  ]
}
```

This runs data updates every 15 minutes during game days.

### API Rate Limits

The Odds API has usage limits on free plans:
- 500 requests/month (free tier)
- Consider caching strategies for production use
- Monitor usage in The Odds API dashboard

### Vendor Layer

The application uses a vendor abstraction layer in `lib/vendors/` for easy API swapping:

- **Current**: MLB Stats API (free) + The Odds API
- **Upgrade Path**: Sportradar, SportsDataIO, or other premium providers
- **Interface**: Consistent data mapping regardless of source

To swap providers, implement the same interface in new vendor files.

## 📱 Mobile Support

The application is fully responsive and works on mobile devices:
- Touch-friendly navigation
- Responsive tables with horizontal scrolling
- Optimized layouts for small screens
- Fast loading with SSR

## 🎯 Roadmap

### Immediate Enhancements
- [ ] Weather impact modeling
- [ ] Bullpen usage and fatigue tracking
- [ ] Enhanced player projection models
- [ ] Real-time odds movement alerts

### Advanced Features
- [ ] User authentication and watchlists
- [ ] Historical performance tracking
- [ ] CSV export functionality
- [ ] Slack/Discord notifications
- [ ] Mobile app (React Native)

### Data Enhancements
- [ ] Pitch-by-pitch data integration
- [ ] Advanced metrics (xwOBA, Statcast)
- [ ] Injury report integration
- [ ] Line movement analysis

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use Prettier for formatting: `npm run format`
- Follow ESLint rules: `npm run lint`
- Write tests for new features
- Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Common Issues

**Database Connection Error**
- Verify PostgreSQL is running
- Check DATABASE_URL format
- Ensure database exists and user has permissions

**Odds API Errors**
- Verify API key is correct
- Check remaining quota at the-odds-api.com
- Ensure proper API endpoint permissions

**Missing Game Data**
- Run manual refresh: `/api/cron/refresh-slate`
- Check MLB Stats API availability
- Verify game dates and scheduling

### Getting Help

- Open an issue on GitHub
- Check existing issues for solutions
- Review API documentation for vendor services

---

Built with ❤️ for the baseball analytics community

