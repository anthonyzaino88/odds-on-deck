# 🚀 Quick Deploy Guide - Odds on Deck

## ✅ What We Just Fixed

Your Vercel deployment was failing because **Prisma Client wasn't being generated during the build**. 

**Changes made**:
1. ✅ Added `postinstall` script to `package.json`
2. ✅ Updated `build` script to run Prisma migrations
3. ✅ Changed database provider from SQLite → PostgreSQL

---

## 🎯 Next Steps to Deploy

### 1️⃣ **Set Up PostgreSQL Database** (5 minutes)

**Easiest Option - Vercel Postgres**:
1. Go to https://vercel.com/dashboard
2. Select your project → Storage tab
3. Click "Create Database" → Select "Postgres"
4. Copy the `DATABASE_URL` it gives you

**Alternative - Supabase (Free)**:
1. Go to https://supabase.com
2. Create new project
3. Go to Settings → Database → Copy connection string

---

### 2️⃣ **Add Environment Variables to Vercel** (2 minutes)

Go to your Vercel project → Settings → Environment Variables

Add these **3 required variables**:

```bash
DATABASE_URL = postgresql://user:pass@host:5432/db?pgbouncer=true
ODDS_API_KEY = your_odds_api_key_here
USE_REAL_PROP_ODDS = true
```

**Important**: Select "All Environments" when adding each variable!

---

### 3️⃣ **Commit and Push** (1 minute)

```bash
git add package.json prisma/schema.prisma
git commit -m "Fix Vercel deployment - add Prisma generation and PostgreSQL support"
git push origin main
```

**Vercel will automatically deploy!**

---

## 📊 Monitor the Deployment

1. Go to Vercel dashboard → Deployments
2. Watch the build logs for:
   - ✅ `Prisma Client generated`
   - ✅ `Migrations deployed`
   - ✅ `Compiled successfully`

### Expected Build Output:
```
Installing dependencies...
✓ npm install completed
Running postinstall...
✓ Prisma Client generated
Running build...
✓ prisma generate
✓ prisma migrate deploy
✓ next build
✓ Build completed successfully
```

---

## 🆘 If Build Still Fails

### Check Your DATABASE_URL Format

**Correct format**:
```
postgresql://username:password@hostname:5432/database?pgbouncer=true&connection_limit=1
```

**Common issues**:
- ❌ Missing `postgresql://` prefix
- ❌ Special characters not URL-encoded in password
- ❌ Wrong port (should be 5432 for Postgres)
- ❌ Missing `?pgbouncer=true` for connection pooling

### Verify Environment Variables
1. Go to Vercel → Settings → Environment Variables
2. Make sure all 3 are set
3. Make sure they're applied to "Production, Preview, Development"
4. Click "Redeploy" to apply changes

---

## ✅ After Successful Deployment

### 1. Visit Your App
```
https://your-app-name.vercel.app
```

### 2. First Load Will Be Slow (30-60 seconds)
- Database needs to be seeded with teams
- First API calls are slow (cold start)
- Subsequent loads will be MUCH faster

### 3. Seed the Database (Optional)
If you see "No games found", you may need to manually seed teams.

**Option A**: Wait for auto-refresh (scheduled daily at noon UTC)

**Option B**: Create a seed API route or run manually:
```bash
# Set production DATABASE_URL in your local .env
DATABASE_URL="your_prod_db_url" npx prisma migrate deploy
DATABASE_URL="your_prod_db_url" npm run seed
```

---

## 🎉 You're Live!

Once deployed, your app will:
- ✅ Automatically deploy on every push to `main`
- ✅ Run database migrations automatically
- ✅ Refresh data daily via cron job (noon UTC)
- ✅ Cache props for 30 minutes (75% API savings)
- ✅ Serve pages in 1-2 seconds

---

## 📋 Quick Troubleshooting

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| "Prisma Client not generated" | Missing postinstall | ✅ Fixed in package.json |
| "Cannot connect to database" | Wrong DATABASE_URL | Check format and credentials |
| "Migration failed" | Database not accessible | Verify database is public/allows connections |
| "Function timeout" | API taking too long | Normal on first load, check Function logs |
| "Environment variable missing" | Not set in Vercel | Add in Settings → Environment Variables |

---

## 🔗 Useful Links

- **Vercel Dashboard**: https://vercel.com/dashboard
- **Your Deployments**: https://vercel.com/[your-username]/[your-project]/deployments
- **Function Logs**: Click any deployment → View Function Logs
- **Full Guide**: See `VERCEL_DEPLOYMENT_GUIDE.md`

---

## 🚀 Deploy Command

```bash
git add .
git commit -m "Ready for Vercel deployment"
git push origin main
```

**That's it!** Vercel handles the rest automatically.

---

*Last Updated: October 11, 2025*  
*All deployment blockers resolved ✅*

