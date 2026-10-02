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

## New functions after 006

Postgres grants `EXECUTE` on new functions to `PUBLIC` by default.
`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ... FROM PUBLIC`
does **not** remove that built-in grant — per-schema default ACLs can
only add privileges. 006 therefore also runs the global form:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

That is safe on Supabase: it only binds objects **created by `postgres`**
(SQL Editor). `supabase_admin` / extension owners are unchanged. Functions
created later by some other role still need an explicit
`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`.

Rollback must restore the built-in default. Before 006 there is usually
**no** `pg_default_acl` row for `postgres` / global / functions — Postgres
just uses `{postgres=X/postgres,=X/postgres}`. 006 inserts
`postgres/-/f {postgres=X/postgres}`. The pre-snapshot therefore emits
`ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`
when that row is missing. Replaying it deletes the 006 row so new
functions get `=X/postgres` again.

## Runbook

1. Confirm `SUPABASE_SECRET_KEY` in Vercel Production **and** Vercel Build
   (`sitemap.xml` is prerendered).
2. Merge and deploy the PR-E code. Do not paste 006 yet.
3. Verify `GET https://oddsondeck.com/api/health` has
   `supabaseAdmin.usingSecret: true`. Hit `/`, `/picks`, `/parlays`,
   `/api/picks`.
4. **Step 0:** paste `006_pre_snapshot.sql` (read-only, **one** `UNION ALL`
   statement). The SQL Editor shows only the last grid — export or copy
   the **full** `(section, ordinal, restore_ddl)` grid. That is the rollback.
   Policy rows emit `DROP POLICY IF EXISTS` then `CREATE POLICY` so replay
   is rerunnable. `PUBLIC` is unquoted; function rows include identity
   args and `ON ROUTINE` / `ON PROCEDURE`. If `postgres` has no global
   function `pg_default_acl` row (the usual pre-006 state — built-in
   PUBLIC EXECUTE), section `E` emits
   `ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`
   Replay of that statement deletes the 006 `postgres/-/f {postgres=X/postgres}`
   row so new functions get `=X/postgres` again. Section `F` captures real
   column ACLs via `aclexplode(pg_attribute.attacl)` for anon, authenticated,
   and PUBLIC on user schemas. It does **not** use
   `information_schema.column_privileges`, which expands table-level grants
   into one row per column and would invent column ACLs on replay.
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

**Watch health after setting that flag.** With `SUPABASE_REQUIRE_SECRET_KEY=1`
and no secret, pages render empty (the admin client is unconfigured) and
`GET /api/health` shows `degraded: true` / `configured: false`. Confirm
`usingSecret: true` before and after flipping the flag.
