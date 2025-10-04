# PostgreSQL Setup Guide for Vercel Deployment

## 🎯 **3 EASY OPTIONS (Recommended Order)**

### **Option 1: Vercel Postgres (EASIEST)** ⭐
**Best for: Seamless integration, zero configuration**

#### Steps:
1. **Go to Vercel Dashboard**
   - Visit [vercel.com](https://vercel.com)
   - Sign in to your account

2. **Create New Project**
   - Click "New Project"
   - Import your GitHub repository

3. **Add Vercel Postgres**
   - In project dashboard, go to "Storage" tab
   - Click "Create Database" → "Postgres"
   - Choose "Hobby" plan (free tier)
   - Name it: `odds-on-deck-db`

4. **Get Connection String**
   - Go to "Storage" → Your database
   - Copy the `DATABASE_URL` (starts with `postgresql://`)

5. **Add to Environment Variables**
   - Go to "Settings" → "Environment Variables"
   - Add: `DATABASE_URL` = your connection string
   - Add: `ODDS_API_KEY` = `065843404dbb936f13929a104de407f3`

**Cost**: Free (Hobby plan)
**Setup Time**: 5 minutes

---

### **Option 2: PlanetScale (POPULAR)** ⭐
**Best for: MySQL compatibility, great free tier**

#### Steps:
1. **Create Account**
   - Go to [planetscale.com](https://planetscale.com)
   - Sign up with GitHub

2. **Create Database**
   - Click "Create database"
   - Name: `odds-on-deck`
   - Choose "Hobby" plan (free)

3. **Get Connection String**
   - Go to your database
   - Click "Connect" → "Connect with Prisma"
   - Copy the connection string

4. **Update Prisma Schema**
   ```prisma
   // prisma/schema.prisma
   datasource db {
     provider = "mysql"  // PlanetScale uses MySQL
     url      = env("DATABASE_URL")
   }
   ```

**Cost**: Free (Hobby plan)
**Setup Time**: 10 minutes

---

### **Option 3: Supabase (FEATURE-RICH)** ⭐
**Best for: Full-featured database with dashboard**

#### Steps:
1. **Create Account**
   - Go to [supabase.com](https://supabase.com)
   - Sign up with GitHub

2. **Create Project**
   - Click "New Project"
   - Name: `odds-on-deck`
   - Choose "Free" plan
   - Set password for database

3. **Get Connection String**
   - Go to "Settings" → "Database"
   - Copy "Connection string" (URI format)
   - Replace `[YOUR-PASSWORD]` with your password

4. **Add to Vercel**
   - In Vercel dashboard → "Environment Variables"
   - Add: `DATABASE_URL` = your connection string

**Cost**: Free (up to 500MB)
**Setup Time**: 10 minutes

---

## 🔧 **AFTER SETTING UP DATABASE**

### **Step 1: Update Prisma Schema**
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"  // or "mysql" for PlanetScale
  url      = env("DATABASE_URL")
}
```

### **Step 2: Deploy to Vercel**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables (if not done in dashboard)
vercel env add DATABASE_URL
vercel env add ODDS_API_KEY
```

### **Step 3: Run Migrations**
```bash
# Pull production environment
vercel env pull .env.production

# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### **Step 4: Test Deployment**
```bash
# Visit your deployed app
# Check that data is loading correctly
# Verify cron jobs are running
```

---

## 🎯 **RECOMMENDED: Vercel Postgres**

**Why Vercel Postgres is best:**
- ✅ **Zero configuration** - works out of the box
- ✅ **Integrated billing** - no separate account needed
- ✅ **Automatic scaling** - handles traffic spikes
- ✅ **Built-in monitoring** - see usage in Vercel dashboard
- ✅ **Free tier** - 1GB storage, 1 billion reads/month

**Connection String Format:**
```
postgresql://username:password@host:port/database?sslmode=require
```

---

## 🚨 **TROUBLESHOOTING**

### **Issue: "Database not found"**
**Solution**: Make sure you've run migrations:
```bash
npx prisma migrate deploy
```

### **Issue: "Connection timeout"**
**Solution**: Check your connection string and network access

### **Issue: "SSL required"**
**Solution**: Add `?sslmode=require` to your DATABASE_URL

### **Issue: "Migration failed"**
**Solution**: Reset and re-run:
```bash
npx prisma migrate reset
npx prisma migrate deploy
```

---

## 💰 **COST COMPARISON**

| Provider | Free Tier | Paid Plans | Best For |
|----------|-----------|------------|----------|
| **Vercel Postgres** | 1GB, 1B reads | $20/month | Vercel users |
| **PlanetScale** | 1GB, 1B reads | $29/month | MySQL users |
| **Supabase** | 500MB, 50K reads | $25/month | Full features |

---

## 🎉 **QUICK START (5 MINUTES)**

1. **Go to Vercel Dashboard**
2. **Create new project** from your GitHub repo
3. **Add Vercel Postgres** in Storage tab
4. **Copy DATABASE_URL** to Environment Variables
5. **Deploy** with `vercel` command
6. **Run migrations** with `npx prisma migrate deploy`

**That's it! Your app will be live with a production database!** 🚀
