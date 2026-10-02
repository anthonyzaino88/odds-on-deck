# RLS lockdown (PR-E Phase 0)

Step 0 (read-only): `scripts/migrations/006_pre_snapshot.sql`  
Lockdown: `scripts/migrations/006_rls_lockdown.sql`  
Rollback: `scripts/migrations/006_rls_lockdown_rollback.sql` (procedure — replay the snapshot `restore_ddl`, no blanket grants)

This repo applies SQL in the Supabase SQL Editor. It does **not** run
these files from Vercel, CI, or `prisma migrate`.

## Why revoke all anon SELECT

After the PR-E code deploy, every server read uses `SUPABASE_SECRET_KEY`
(service role), which bypasses RLS. A completed-only `PropValidation`
policy would still be a second source of truth and is easy to get wrong
(pending future picks leak). The simplest safe option is: no anon
privileges, no policies.

There are no `.rpc(` callers in this repo. The lockdown still revokes
`EXECUTE` on public functions so PostgREST cannot call them as anon.

## Runbook

1. Confirm `SUPABASE_SECRET_KEY` in Vercel Production **and** Vercel Build
   (`sitemap.xml` is prerendered).
2. Merge and deploy this PR. Do not paste 006 yet.
3. Verify `GET https://oddsondeck.com/api/health` has
   `supabaseAdmin.usingSecret: true`. Hit `/`, `/picks`, `/parlays`,
   `/api/picks`.
4. **Step 0:** paste `006_pre_snapshot.sql` (read-only, **one** `UNION ALL`
   statement). The SQL Editor shows only the last grid — export or copy
   the **full** `(section, ordinal, restore_ddl)` grid. That is the rollback.
   Policy / grant rows emit `PUBLIC` unquoted; function rows include
   identity args and `ON ROUTINE` / `ON PROCEDURE`.
5. Owner pastes `scripts/migrations/006_rls_lockdown.sql` in the SQL Editor
   (`BEGIN` … `COMMIT`, plus explicit `GRANT ALL` / `EXECUTE` to
   `service_role`). Defaults `FOR ROLE supabase_admin` are left alone.
6. Verify with the read-only queries in that file, then anon PostgREST
   reads return no rows. Pages still 200.
7. If the site breaks, follow `006_rls_lockdown_rollback.sql`: replay the
   saved `restore_ddl` rows in `(section, ordinal)` order (skip section
   `0`). Leave the code deploy in place.

Optional follow-up, only after step 3 stays green: set
`SUPABASE_REQUIRE_SECRET_KEY=1` in Vercel so a later missing secret
fails closed instead of falling back to anon. `/api/health` still 200s
and reports `requireSecret: true` / `usingSecret: false` because it
never constructs the client.
