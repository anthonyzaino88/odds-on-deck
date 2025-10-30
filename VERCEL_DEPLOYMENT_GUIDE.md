# Vercel Deployment Guide - Odds on Deck

## ✅ Issue Fixed

The deployment error was caused by Prisma Client not being generated during the Vercel build process. This has been fixed by adding a `postinstall` script to `package.json`.

---

## 🚀 Pre-Deployment Checklist

### 1. **Set Up PostgreSQL Database**

Vercel doesn't support SQLite in production. You need a PostgreSQL database.

**Recommended Options**:
- **Vercel Postgres** (easiest, integrated)
- **Supabase** (free tier available)
- **Railway** (free tier available)
- **Neon** (serverless Postgres, free tier)

#### Option A: Vercel Postgres (Recommended)
```bash
# In your Vercel project dashboard
1. Go to Storage tab
2. Click "Create Database"
3. Select "Postgres"
4. Copy the DATABASE_URL connection string
```

#### Option B: Supabase
```bash
1. Go to https://supabase.com
2. Create a new project
3. Go to Settings > Database
4. Copy the "Connection string" (Transaction mode)
```

### 2. **Set Environment Variables on Vercel**

Go to your Vercel project settings → Environment Variables and add:

```bash
# Required
DATABASE_URL="postgresql://username:password@host:5432/database?pgbouncer=true&connection_limit=1"
ODDS_API_KEY="your_odds_api_key_here"
USE_REAL_PROP_ODDS="true"

# Optional
NODE_ENV="production"
```

**Important**: Make sure to add these variables for all environments (Production, Preview, Development).

### 3. **Update Prisma Schema for PostgreSQL**

Your `prisma/schema.prisma` needs to be updated for PostgreSQL:

```prisma
datasource db {
  provider = "postgresql"  // Changed from "sqlite"
  url      = env("DATABASE_URL")
}
```

**Note**: Some SQLite-specific syntax may need adjustments. I'll help with this if needed.

---

## 🔧 What Was Fixed in package.json

### Before:
```json
"scripts": {
  "build": "next build"
}
```

### After:
```json
"scripts": {
  "build": "prisma generate && prisma migrate deploy && next build",
  "postinstall": "prisma generate"
}
```

**What this does**:
1. `postinstall`: Runs `prisma generate` after npm install (fixes the error)
2. `build`: Generates Prisma Client, runs migrations, then builds Next.js

---

## 📋 Deployment Steps

### Step 1: Commit the Changes
```bash
git add package.json
git commit -m "Fix Prisma Client generation for Vercel deployment"
git push origin main
```

### Step 2: Set Up Database

Choose one of the PostgreSQL options above and get your `DATABASE_URL`.

### Step 3: Update Prisma Schema

Edit `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Step 4: Update Schema for PostgreSQL Compatibility

Some changes needed for PostgreSQL:

**1. Remove `@map("PropValidation")` if it exists**
PostgreSQL is case-sensitive for table names.

**2. Update any SQLite-specific features**
- `cuid()` works fine
- `@default(now())` works fine
- String IDs work fine

### Step 5: Commit Schema Changes
```bash
git add prisma/schema.prisma
git commit -m "Update Prisma schema for PostgreSQL"
git push origin main
```

### Step 6: Configure Environment Variables on Vercel

1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to Settings → Environment Variables
4. Add all required variables (see checklist above)
5. **Important**: Click "Apply to all environments"

### Step 7: Trigger Deployment

Either:
- Push to GitHub (auto-deploys)
- Or click "Redeploy" in Vercel dashboard

---

## 🐛 Common Deployment Errors & Fixes

### Error 1: "Prisma Client not generated"
**Fix**: Already fixed with `postinstall` script ✅

### Error 2: "Cannot find module '@prisma/client'"
**Cause**: Prisma Client not in dependencies
**Fix**: Make sure `@prisma/client` is in `dependencies` (not `devDependencies`) ✅

### Error 3: "Database connection failed"
**Cause**: Wrong DATABASE_URL or database not accessible
**Fix**: 
- Verify DATABASE_URL is correct
- Check database is publicly accessible
- Use connection pooling: `?pgbouncer=true&connection_limit=1`

### Error 4: "Migration failed"
**Cause**: Database schema doesn't match migrations
**Fix**: In Vercel dashboard, go to Deployments → select deployment → Function logs, and check what's failing. You may need to manually run migrations on your database.

### Error 5: "Function timeout"
**Cause**: Initial data fetch takes too long
**Fix**: Already configured in `vercel.json` with `maxDuration: 60` ✅

---

## 🔍 Verifying Deployment

### Check 1: Build Logs
Look for these success messages:
```
✓ Prisma Client generated
✓ Migrations deployed
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
```

### Check 2: Runtime Logs
After deployment, visit your app and check Function logs in Vercel:
- Should see database connections succeeding
- Should see data fetching successfully
- Should NOT see Prisma errors

### Check 3: Test the App
1. Visit your Vercel URL
2. Check homepage loads
3. Navigate to `/games` (Today's Slate)
4. Navigate to `/props` (Player Props)
5. Try generating a parlay at `/dfs`

---

## ⚙️ Database Migration on Vercel

When you deploy, the build script will run:
```bash
prisma migrate deploy
```

This applies all migrations in `prisma/migrations/` to your production database.

**Important**: This is non-interactive and safe for production.

### If migrations fail:

**Option 1**: Manually run migrations on your database
```bash
# Connect to your database and run:
psql $DATABASE_URL

# Then manually apply the SQL from prisma/migrations/
```

**Option 2**: Reset and reseed (development only!)
```bash
# This will DELETE ALL DATA - only for testing!
npx prisma migrate reset --force
```

---

## 🚨 Important Vercel Considerations

### 1. **Serverless Functions**
- Each API route is a serverless function
- Cold starts can take 1-2 seconds
- Database connections are pooled

### 2. **Connection Pooling**
Your DATABASE_URL should include:
```
?pgbouncer=true&connection_limit=1
```

This prevents "too many connections" errors.

### 3. **Environment Variables**
- Set in Vercel dashboard
- Applied per environment (Production/Preview/Development)
- Changes require redeployment

### 4. **File System**
- Vercel is read-only at runtime
- No SQLite in production (use PostgreSQL)
- No file uploads (use external storage if needed)

### 5. **Cron Jobs**
Your `vercel.json` already configures a cron job:
```json
"crons": [
  {
    "path": "/api/cron/refresh-slate",
    "schedule": "0 12 * * *"  // Runs daily at 12:00 UTC
  }
]
```

**Note**: Cron jobs only available on Pro plan ($20/month).

---

## 📊 Post-Deployment Tasks

### 1. Seed the Database
After first deployment, you may need to seed teams:
```bash
# Create a script to seed via API
curl https://your-app.vercel.app/api/admin/seed
```

Or run locally against production:
```bash
DATABASE_URL="your_production_db_url" npm run seed
```

### 2. Test Validation System
- Save some props
- Wait for games to complete
- Check validation results

### 3. Monitor API Usage
- Check The Odds API dashboard
- Verify caching is working
- Monitor for excessive calls

### 4. Set Up Monitoring
- Vercel Analytics (built-in)
- Vercel Speed Insights
- Error tracking (Sentry, optional)

---

## 🆘 If Deployment Still Fails

### Step 1: Check Build Logs
Look for the exact error message in Vercel deployment logs.

### Step 2: Common Issues

**"Cannot find module X"**
- Missing dependency
- Add to `package.json` dependencies

**"Prisma migration failed"**
- Database connection issue
- Check DATABASE_URL is correct
- Verify database is accessible from Vercel

**"Function timeout"**
- Increase `maxDuration` in `vercel.json`
- Optimize slow API calls
- Check prop caching is working

### Step 3: Test Locally First
Before deploying, test with production settings:
```bash
# Use production database locally
DATABASE_URL="your_production_db_url" npm run dev

# Or use a staging database
DATABASE_URL="your_staging_db_url" npm run dev
```

### Step 4: Deploy Preview First
Push to a branch to create a preview deployment:
```bash
git checkout -b test-deploy
git push origin test-deploy
```

This creates a preview URL to test before production.

---

## ✅ Success Checklist

Before considering deployment complete:

- [ ] Build succeeds without errors
- [ ] All migrations applied to database
- [ ] Environment variables set correctly
- [ ] Homepage loads successfully
- [ ] Today's Slate shows games
- [ ] Player Props load (may take 30s first time)
- [ ] Parlay generator works
- [ ] Validation dashboard accessible
- [ ] No errors in Function logs
- [ ] Caching working (check console logs)
- [ ] API usage is reasonable

---

## 🔄 Updating Your Deployment

### For Code Changes:
```bash
git add .
git commit -m "Your changes"
git push origin main
# Auto-deploys to Vercel
```

### For Database Schema Changes:
```bash
# 1. Update schema
vim prisma/schema.prisma

# 2. Create migration
npx prisma migrate dev --name your_change_name

# 3. Commit and push
git add .
git commit -m "Update database schema"
git push origin main

# Vercel will run migrations during build
```

### For Environment Variables:
1. Update in Vercel dashboard
2. Redeploy to apply changes

---

## 📚 Additional Resources

- **Prisma on Vercel**: https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-vercel
- **Vercel Docs**: https://vercel.com/docs
- **Vercel Postgres**: https://vercel.com/docs/storage/vercel-postgres
- **Next.js Deployment**: https://nextjs.org/docs/deployment

---

## 🎉 You're Ready!

Your `package.json` is now configured correctly. The next steps are:

1. ✅ Commit the changes (done)
2. 🗄️ Set up PostgreSQL database
3. 🔐 Add environment variables to Vercel
4. 📝 Update Prisma schema for PostgreSQL
5. 🚀 Push to GitHub and deploy!

Good luck! 🍀

---

*Last Updated: October 11, 2025*
*Status: Ready for Deployment*

