# RLS lockdown (PR-E Phase 0)

Executable SQL: `scripts/migrations/006_rls_lockdown.sql`  
Rollback: `scripts/migrations/006_rls_lockdown_rollback.sql`

This repo applies SQL in the Supabase SQL Editor. It does **not** run
this file from Vercel, CI, or `prisma migrate`.

## Why revoke all anon SELECT

After the PR-E code deploy, every server read uses `SUPABASE_SECRET_KEY`
(service role), which bypasses RLS. A completed-only `PropValidation`
policy would still be a second source of truth and is easy to get wrong
(pending future picks leak). The simplest safe option is: no anon
privileges, no policies.

## Runbook

1. Confirm `SUPABASE_SECRET_KEY` in Vercel Production (not Preview only).
2. Merge and deploy this PR. Do not paste SQL yet.
3. Verify `GET https://oddsondeck.com/api/health` has
   `supabaseAdmin.usingSecret: true`. Hit `/`, `/picks`, `/parlays`,
   `/api/picks`.
4. Owner pastes `scripts/migrations/006_rls_lockdown.sql` in the SQL Editor.
5. Verify with the read-only queries in that file, then anon PostgREST
   reads return no rows. Pages still 200.
6. If the site breaks, paste `006_rls_lockdown_rollback.sql`, then
   leave the code deploy in place (reads still work via the secret key
   once it is set; rollback only re-opens anon SELECT).

Optional follow-up, only after step 3 stays green: set
`SUPABASE_REQUIRE_SECRET_KEY=1` in Vercel so a later missing secret
fails closed instead of falling back to anon.
