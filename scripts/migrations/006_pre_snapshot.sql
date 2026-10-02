-- ============================================================================
-- STEP 0 (required, READ-ONLY): snapshot public grants / RLS / policies
-- ============================================================================
-- Run this in the Supabase SQL Editor BEFORE 006_rls_lockdown.sql.
-- Save the full result (every result grid, CSV or text) as the exact
-- rollback source. 006_rls_lockdown_rollback.sql is a procedure that
-- tells you to replay the restore_ddl column from this output.
--
-- DO NOT run from CI, Vercel, or this PR. This file writes nothing.
-- Each query emits a restore_ddl column of ready-to-run SQL.
-- ============================================================================

-- A. RLS enablement → ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY
SELECT
  schemaname,
  tablename,
  rowsecurity,
  format(
    'ALTER TABLE %I.%I %s ROW LEVEL SECURITY;',
    schemaname,
    tablename,
    CASE WHEN rowsecurity THEN 'ENABLE' ELSE 'DISABLE' END
  ) AS restore_ddl
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- B. Policies (full qual / with_check) → CREATE POLICY ...
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  format(
    'CREATE POLICY %I ON %I.%I AS %s FOR %s%s%s%s;',
    policyname,
    schemaname,
    tablename,
    CASE WHEN permissive = 'RESTRICTIVE' THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END,
    CASE WHEN cmd = '*' THEN 'ALL' ELSE cmd END,
    CASE
      WHEN roles IS NULL OR cardinality(roles) = 0 THEN ''
      ELSE ' TO ' || array_to_string(ARRAY(SELECT quote_ident(x) FROM unnest(roles) AS x), ', ')
    END,
    CASE WHEN qual IS NOT NULL THEN format(' USING (%s)', qual) ELSE '' END,
    CASE WHEN with_check IS NOT NULL THEN format(' WITH CHECK (%s)', with_check) ELSE '' END
  ) AS restore_ddl
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- C. Table grants for anon / authenticated → GRANT ...
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type,
  format(
    'GRANT %s ON TABLE %I.%I TO %I;',
    privilege_type,
    table_schema,
    table_name,
    grantee
  ) AS restore_ddl
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

-- D. Routine / EXECUTE grants for anon / authenticated → GRANT EXECUTE ...
SELECT
  n.nspname AS routine_schema,
  p.proname AS routine_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  COALESCE(r.rolname, 'PUBLIC') AS grantee,
  a.privilege_type,
  format(
    'GRANT %s ON FUNCTION %I.%I(%s) TO %s;',
    a.privilege_type,
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    CASE WHEN r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
  ) AS restore_ddl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public'
  AND a.privilege_type = 'EXECUTE'
  AND (
    r.rolname IN ('anon', 'authenticated')
    OR a.grantee = 0
  )
ORDER BY 1, 2, 4;

-- Same via information_schema (backup if aclexplode is empty)
SELECT
  grantee,
  routine_schema,
  routine_name,
  privilege_type,
  format(
    'GRANT %s ON FUNCTION %I.%I TO %I;',
    privilege_type,
    routine_schema,
    routine_name,
    grantee
  ) AS restore_ddl
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY routine_name, grantee, privilege_type;

-- E. Default ACLs → ALTER DEFAULT PRIVILEGES ...
SELECT
  pg_get_userbyid(d.defaclrole) AS for_role,
  COALESCE(n.nspname, 'public') AS schema_name,
  d.defaclobjtype,
  COALESCE(r.rolname, 'PUBLIC') AS grantee,
  a.privilege_type,
  format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %s;',
    pg_get_userbyid(d.defaclrole),
    COALESCE(n.nspname, 'public'),
    a.privilege_type,
    CASE d.defaclobjtype
      WHEN 'r' THEN 'TABLES'
      WHEN 'S' THEN 'SEQUENCES'
      WHEN 'f' THEN 'FUNCTIONS'
      WHEN 'T' THEN 'TYPES'
      ELSE 'TABLES'
    END,
    CASE WHEN r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
  ) AS restore_ddl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE COALESCE(n.nspname, 'public') = 'public'
ORDER BY 1, 2, 3, 4, 5;
