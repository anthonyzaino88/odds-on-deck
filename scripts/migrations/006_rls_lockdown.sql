-- ============================================================================
-- PR-E Phase 0: RLS lockdown (anon cannot read unreleased picks or write)
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, Vercel, this PR, or any production refresh job.
-- Nothing in package.json / vercel.json applies this file.
--
-- STEP 0 (required, read-only): run 006_pre_snapshot.sql first and save
-- its full output. That output is the exact rollback. Do not run 006
-- until the snapshot is saved.
--
-- PRECONDITION (site stays up):
--   1. SUPABASE_SECRET_KEY is set in Vercel Production AND Vercel Build
--      (sitemap.xml is prerendered and reads Game via the admin client).
--   2. The PR-E code is deployed.
--   3. GET https://oddsondeck.com/api/health shows
--        supabaseAdmin.usingSecret = true
--        supabaseAdmin.fallbackToAnon = false
--   4. Public pages still 200 after that deploy.
--   If usingSecret is false, STOP. This migration would hide every row
--   from the server fallback client and take the site down.
--
-- WHY (simplest safe option):
--   After PR-E, no server code path needs the anon key. The service-role
--   client bypasses RLS. Leaving any anon SELECT (even status='completed')
--   would still leak future pending picks via PostgREST if a policy is
--   wrong. Revoke all anon/authenticated table privileges and enable RLS
--   with no policies.
--
-- WHAT THIS DOES:
--   - ENABLE ROW LEVEL SECURITY on every public table
--   - DROP every existing public-schema policy (including USING(true) SELECT)
--   - REVOKE SELECT/INSERT/UPDATE/DELETE/TRUNCATE from PUBLIC, anon, authenticated
--   - REVOKE EXECUTE on public functions from PUBLIC, anon, authenticated
--     (repo has no .rpc( callers; still close the grant)
--   - Revoke default privileges so new tables / functions do not re-open anon
--
-- WHAT THIS DOES NOT DO:
--   Does not rewrite rows. Does not disable the service_role. Does not
--   FORCE RLS on table owners (SQL Editor / postgres still works).
-- ============================================================================

-- 1. Enable RLS on every public table
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    RAISE NOTICE 'RLS enabled on public.%', r.tablename;
  END LOOP;
END $$;

-- 2. Drop leftover policies (USING(true) SELECT would re-open reads if
--    someone later GRANTs SELECT to anon).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    RAISE NOTICE 'Dropped policy "%" on %.%', r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- 3. Revoke table privileges from browser-facing roles
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 4. Future tables / functions created by postgres stay closed to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- VERIFY (read-only — paste after the statements above, or as a second query)
-- ============================================================================
-- Every public table should have rowsecurity = true:
--   SELECT schemaname, tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
--
-- No policies should remain:
--   SELECT schemaname, tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- anon / authenticated should have no table grants:
--   SELECT grantee, table_name,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND grantee IN ('anon', 'authenticated')
--   GROUP BY 1, 2
--   ORDER BY 2, 1;
--
-- PostgREST smoke (from a laptop, anon key only — expect empty / 401 / 42501):
--   curl -sS "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/PropValidation?select=id,status&limit=5" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
-- ============================================================================
