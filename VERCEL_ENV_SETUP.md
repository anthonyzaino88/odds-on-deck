# 🔧 Vercel Environment Variables Setup

## Issue
The Vercel deployment is not connecting to Supabase, causing:
- Wrong number of NHL games (10 instead of 5)
- Missing scores on the slate
- Data not syncing from database

## Required Environment Variables

You **MUST** set these in your Vercel dashboard:

### 1. Supabase Configuration
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 2. Optional (for scripts that run server-side)
```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 3. Other APIs (if needed)
```
ODDS_API_KEY=your-odds-api-key
```

## How to Set in Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add each variable:
   - **Key**: `NEXT_PUBLIC_SUPABASE_URL`
   - **Value**: Your Supabase project URL
   - **Environment**: Production, Preview, Development (select all)
4. Repeat for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. **Redeploy** after adding variables

## Verification

After setting variables, check:
1. Vercel deployment logs for Supabase connection errors
2. Visit your site and check browser console for errors
3. Check if games are loading correctly

## Common Issues

### Issue: "Missing Supabase credentials" error
**Solution**: Environment variables not set or not redeployed after setting

### Issue: Wrong number of games
**Possible causes**:
- Date filtering issue (timezone)
- Duplicate games in database
- Environment variables pointing to wrong database

### Issue: No scores showing
**Possible causes**:
- `homeScore` and `awayScore` fields not being updated
- Live scoring script not running
- Data not synced from local to production database

## Quick Fix Checklist

- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` in Vercel
- [ ] Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel
- [ ] Redeploy the application
- [ ] Check Vercel logs for errors
- [ ] Verify games are loading correctly
- [ ] Check if scores are updating

