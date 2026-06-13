-- ============================================================================
-- FIX: Supabase Security Advisor "RLS Policy Always True" warnings
-- ============================================================================
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- WHY:
--   Some tables have policies like:
--     CREATE POLICY "Allow all for service role" ON "X" FOR ALL USING (true);
--   Despite the name, FOR ALL with no "TO" clause applies to EVERY role
--   (including the public anon key) and USING/WITH CHECK (true) means
--   unrestricted read AND write. That bypasses RLS for those tables.
--
--   These tables (archives, parlay history, box scores) are internal — the
--   browser never needs to read or write them. All app writes happen through
--   the service_role key, which bypasses RLS automatically and does NOT need
--   any policy. So the correct state is: RLS enabled, no permissive policies.
--
-- WHAT THIS DOES:
--   Drops every non-SELECT policy in the public schema (FOR ALL / INSERT /
--   UPDATE / DELETE). It intentionally KEEPS dedicated SELECT policies like
--   "Allow public read on Game", which power the public site and are safe.
-- ============================================================================

-- STEP 1 (optional preview): see exactly what will be dropped before running.
-- SELECT schemaname, tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND cmd <> 'SELECT'
-- ORDER BY tablename, policyname;

-- STEP 2: drop the overly permissive (non-SELECT) policies.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd <> 'SELECT'   -- keep public read-only SELECT policies intact
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    RAISE NOTICE 'Dropped policy "%" on %.%', r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- STEP 3 (verify): this should return ZERO rows after the fix.
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND cmd <> 'SELECT';

-- ============================================================================
-- RESULT:
--   - RLS stays ENABLED on all tables.
--   - anon (browser) can still READ tables that have a SELECT policy.
--   - anon can no longer write anything directly.
--   - Scripts/API using SUPABASE_SECRET_KEY (service_role) still read AND
--     write everything (bypasses RLS).
--   - Security Advisor "RLS Policy Always True" warnings clear.
-- ============================================================================
