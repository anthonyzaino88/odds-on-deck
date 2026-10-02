-- ============================================================================
-- ROLLBACK for 006_rls_lockdown.sql
-- ============================================================================
-- APPLY MANUALLY in Supabase SQL Editor if the lockdown breaks the site.
-- DO NOT run from CI or Vercel.
--
-- This restores anon/authenticated SELECT on public tables (except the two
-- archives that were already hidden: ClosingOdds, ArchivedGame). RLS stays
-- ENABLED so INSERT/UPDATE/DELETE remain blocked without a write policy —
-- the same shape as the 2026-10-02 audit (INSERT 42501, writes are no-ops).
--
-- It does NOT recreate every historical policy name. After rollback, confirm
-- GET https://oddsondeck.com returns 200 and /api/picks shows today's board.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('ClosingOdds', 'ArchivedGame')
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'pr_e_rollback_public_read', r.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      'pr_e_rollback_public_read', r.tablename
    );
    RAISE NOTICE 'Restored public SELECT on public.%', r.tablename;
  END LOOP;
END $$;

-- VERIFY:
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND grantee IN ('anon', 'authenticated')
--     AND privilege_type = 'SELECT'
--   ORDER BY table_name, grantee;
--
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public' AND policyname = 'pr_e_rollback_public_read'
--   ORDER BY tablename;
