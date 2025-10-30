# ⚡ Switch to Demo Mode (30 Seconds)

You have TWO API keys:
- **FREE (Demo):** `0437577781a9c1944c96cf470cf4e35d` ← Use this for portfolio
- **PAID (Dev):** `065843404dbb936f13929a104de407f3` ← Currently active

---

## 🎨 **Enable Demo Mode:**

### **Edit `env.local` file:**

Change these lines:

```bash
# FROM (current - production):
ODDS_API_KEY="065843404dbb936f13929a104de407f3"

# TO (demo):
ODDS_API_KEY="0437577781a9c1944c96cf470cf4e35d"
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

### **Full `env.local` for demo:**

```bash
# App Configuration
APP_NAME="Odds on Deck - Demo"

# Database
DATABASE_URL="file:./prisma/dev.db"

# APIs - FREE TIER for demo (500 requests/month)
ODDS_API_KEY="0437577781a9c1944c96cf470cf4e35d"

# Demo Mode
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
USE_REAL_PROP_ODDS=true

# Next.js
NEXTAUTH_SECRET="test_secret_for_development"
NEXTAUTH_URL="http://localhost:3000"
```

---

## ✅ **Test Demo Mode:**

```bash
npm run dev
```

Visit `http://localhost:3000` - You should see:
- 🎨 Demo banner at the top
- "Portfolio Demo Version" text  
- API usage stats (0/500)
- Link to GitHub

---

## 🚀 **Deploy Demo to Vercel:**

```bash
vercel --prod
```

**Set these environment variables in Vercel dashboard:**
```
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
ODDS_API_KEY=0437577781a9c1944c96cf470cf4e35d
USE_REAL_PROP_ODDS=true
DATABASE_URL=file:./prisma/dev.db
```

---

## 🔄 **Switch Back to Production:**

Edit `env.local`:

```bash
# Switch back to paid key
ODDS_API_KEY="065843404dbb936f13929a104de407f3"
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false
```

---

## 📊 **Your Setup:**

| Mode | API Key | Requests/Month | Cost | Use For |
|------|---------|----------------|------|---------|
| **Demo** | `0437...e35d` | 500 | FREE | Portfolio |
| **Production** | `0658...07f3` | 20,000 | $30 | Development |

---

## 💡 **Recommendation:**

1. **Keep production key** for local development
2. **Use demo key** only for Vercel deployment
3. **Separate Vercel projects:**
   - Production: `odds-on-deck` (paid key)
   - Demo: `odds-on-deck-demo` (free key)

This way you get:
- ✅ Full API access for development
- ✅ Free demo for portfolio
- ✅ No switching needed locally

---

## 🎯 **Quick Deploy Demo:**

```bash
# Create separate demo deployment
vercel --prod --name odds-on-deck-demo

# Add env vars in dashboard:
DEMO_MODE=true
ODDS_API_KEY=0437577781a9c1944c96cf470cf4e35d
```

**Done!** You now have two deployments:
- Production (for you)
- Demo (for recruiters)

---

**Want me to help set this up?** Just let me know!

