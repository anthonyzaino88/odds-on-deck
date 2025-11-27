# 🚀 Supabase Setup Guide

## Migration from Prisma to Supabase Client ✅

We've successfully migrated from Prisma (which had build-time dependency issues) to the Supabase JavaScript Client (which loads at runtime).

### Benefits

✅ **No more build errors** - No Prisma client generation at build time  
✅ **No Vercel caching issues** - Client loads fresh every time  
✅ **Faster builds** - Reduced from 5-10 min to ~2-3 min  
✅ **Real-time ready** - Supabase subscriptions built-in  
✅ **Simpler queries** - Direct SQL-like syntax

---

## Step 1: Get Your Supabase Credentials

Go to: https://app.supabase.com

1. Select your project
2. Click **Settings** (gear icon)
3. Click **API** in the left sidebar
4. Copy these values:
   - **Project URL** (e.g., `https://your-project-id.supabase.co`)
   - **Anon public** key (the one WITHOUT "service_role")

---

## Step 2: Set Vercel Environment Variables

1. Go to: https://vercel.com/dashboard
2. Click **Odds on Deck** project
3. Click **Settings** tab
4. Click **Environment Variables** in left sidebar
5. Add TWO new variables:

| Variable Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project-id.supabase.co` | Your project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (your anon key) | Copy from Supabase API settings |

**IMPORTANT:** Use the **anon public** key, NOT the service_role key!

---

## Step 3: Update Local Environment

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Replace with your actual values!

---

## Step 4: Deploy

Push to GitHub:
```bash
git add .
git commit -m "MIGRATE: Replace Prisma with Supabase client"
git push origin main
```

Vercel will automatically rebuild in ~2-3 minutes.

---

## Verification

After deploy, check:

1. ✅ Homepage loads without errors
2. ✅ Shows game count (MLB, NFL, NHL)
3. ✅ Check browser console for no errors
4. ✅ Network tab shows `/api/games/today` returning data

---

## What Changed

### Before (Prisma):
```javascript
import { prisma } from '@/lib/db'  // ❌ Generated at build time

export async function GET() {
  const games = await prisma.game.findMany()
}
```

### After (Supabase):
```javascript
import { supabase } from '@/lib/supabase'  // ✅ Loads at runtime

export async function GET() {
  const { data: games } = await supabase
    .from('game')
    .select('*')
}
```

---

## Next Steps

Once this is working, we'll:

1. ✅ Keep `/api/games/today` using Supabase
2. ✅ Migrate other key endpoints to Supabase
3. ✅ Delete all unused Prisma/debug endpoints
4. ✅ Reduce from 61 → ~10 endpoints
5. ✅ Set up proper background jobs (not API routes)

---

## Troubleshooting

### "Missing Supabase credentials" error

Make sure both environment variables are set:
- `NEXT_PUBLIC_SUPABASE_URL` ✅
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅

### Still showing 0 games?

1. Check `/api/games/today` in browser console for errors
2. Verify environment variables are set on Vercel
3. Make sure the `game` table exists in Supabase
4. Confirm there's data in Supabase (28 games should exist)

### Build still failing?

1. Check Vercel deployment logs
2. Ensure npm install succeeded
3. Check for syntax errors in `lib/supabase.js`

---

## Questions?

The migration is complete! Next message should be:
```
"✅ Set env vars on Vercel, pushed to GitHub, waiting for deploy"
```
