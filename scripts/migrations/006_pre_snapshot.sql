-- ============================================================================
-- STEP 0 (required, READ-ONLY): snapshot public grants / RLS / policies
-- ============================================================================
-- Run this in the Supabase SQL Editor BEFORE 006_rls_lockdown.sql.
--
-- THIS FILE IS ONE STATEMENT. The SQL Editor shows only the last result
-- grid — export or copy the FULL grid (section, ordinal, restore_ddl).
-- Replay restore_ddl in order (section, ordinal) for rollback.
-- Policy rows emit DROP POLICY IF EXISTS then CREATE POLICY (rerunnable).
-- Section F is information_schema.column_privileges for anon/authenticated/PUBLIC.
--
-- DO NOT run from CI, Vercel, or this PR. This file writes nothing.
-- ============================================================================

SELECT section, ordinal, restore_ddl
FROM (
  SELECT
    '0'::text AS section,
    0 AS ordinal,
    '-- Export or copy this entire result grid. Replay restore_ddl ORDER BY section, ordinal.'::text AS restore_ddl

  UNION ALL

  -- A. RLS enablement
  SELECT
    'A'::text,
    row_number() OVER (ORDER BY tablename)::int,
    format(
      'ALTER TABLE %I.%I %s ROW LEVEL SECURITY;',
      schemaname,
      tablename,
      CASE WHEN rowsecurity THEN 'ENABLE' ELSE 'DISABLE' END
    )
  FROM pg_tables
  WHERE schemaname = 'public'

  UNION ALL

  -- B. Policies. Role {public} must emit PUBLIC unquoted, never quote_ident.
  --    DROP POLICY IF EXISTS makes restore_ddl rerunnable.
  SELECT
    'B'::text,
    row_number() OVER (ORDER BY tablename, policyname)::int,
    format(
      E'DROP POLICY IF EXISTS %I ON %I.%I;\nCREATE POLICY %I ON %I.%I AS %s FOR %s%s%s%s;',
      policyname,
      schemaname,
      tablename,
      policyname,
      schemaname,
      tablename,
      CASE WHEN permissive = 'RESTRICTIVE' THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END,
      CASE WHEN cmd = '*' THEN 'ALL' ELSE cmd END,
      CASE
        WHEN roles IS NULL OR cardinality(roles) = 0 THEN ''
        ELSE ' TO ' || array_to_string(
          ARRAY(
            SELECT CASE
              WHEN lower(x::text) IN ('public', '"public"') THEN 'PUBLIC'
              ELSE quote_ident(x::text)
            END
            FROM unnest(roles) AS x
          ),
          ', '
        )
      END,
      CASE WHEN qual IS NOT NULL THEN format(' USING (%s)', qual) ELSE '' END,
      CASE WHEN with_check IS NOT NULL THEN format(' WITH CHECK (%s)', with_check) ELSE '' END
    )
  FROM pg_policies
  WHERE schemaname = 'public'

  UNION ALL

  -- C. Table + sequence grants for PUBLIC, anon, authenticated
  SELECT
    'C'::text,
    row_number() OVER (ORDER BY kind, relname, grantee_label, privilege_type)::int,
    format(
      'GRANT %s ON %s %I.%I TO %s;',
      privilege_type,
      obj,
      nspname,
      relname,
      grantee_sql
    )
  FROM (
    SELECT
      1 AS kind,
      n.nspname,
      c.relname,
      'TABLE'::text AS obj,
      a.privilege_type,
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE r.rolname END AS grantee_label,
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a ON true
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'PUBLIC'))

    UNION ALL

    SELECT
      2 AS kind,
      n.nspname,
      c.relname,
      'SEQUENCE'::text,
      a.privilege_type,
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE r.rolname END,
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) a ON true
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'PUBLIC'))
  ) grants

  UNION ALL

  -- D. Routine EXECUTE. Identity args required. PROCEDURE vs ROUTINE.
  --    PUBLIC is unquoted; never format %I for it.
  SELECT
    'D'::text,
    row_number() OVER (ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), COALESCE(r.rolname, 'PUBLIC'))::int,
    format(
      'GRANT %s ON %s %I.%I(%s) TO %s;',
      a.privilege_type,
      CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'ROUTINE' END,
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid),
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    )
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE n.nspname = 'public'
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'PUBLIC'))

  UNION ALL

  -- E. Default ACLs. Global (defaclnamespace = 0) must NOT gain IN SCHEMA public.
  SELECT
    'E'::text,
    row_number() OVER (
      ORDER BY pg_get_userbyid(d.defaclrole), d.defaclnamespace, d.defaclobjtype, COALESCE(r.rolname, 'PUBLIC'), a.privilege_type
    )::int,
    format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s GRANT %s ON %s TO %s;',
      pg_get_userbyid(d.defaclrole),
      CASE
        WHEN d.defaclnamespace = 0 THEN ''
        ELSE format(' IN SCHEMA %I', n.nspname)
      END,
      a.privilege_type,
      CASE d.defaclobjtype
        WHEN 'r' THEN 'TABLES'
        WHEN 'S' THEN 'SEQUENCES'
        WHEN 'f' THEN 'FUNCTIONS'
        WHEN 'T' THEN 'TYPES'
        WHEN 'n' THEN 'SCHEMAS'
        ELSE format('/* unknown defaclobjtype %s */', d.defaclobjtype)
      END,
      CASE WHEN a.grantee = 0 OR r.rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    )
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE d.defaclnamespace = 0
     OR n.nspname = 'public'

  UNION ALL

  -- F. Column-level grants for PUBLIC, anon, authenticated.
  --    information_schema.column_privileges also lists table-level GRANTs
  --    exploded per column; replaying GRANT (col) is idempotent.
  SELECT
    'F'::text,
    row_number() OVER (
      ORDER BY cp.table_name, cp.column_name, cp.grantee, cp.privilege_type
    )::int,
    format(
      'GRANT %s (%I) ON TABLE %I.%I TO %s;',
      cp.privilege_type,
      cp.column_name,
      cp.table_schema,
      cp.table_name,
      CASE
        WHEN upper(cp.grantee) = 'PUBLIC' THEN 'PUBLIC'
        ELSE quote_ident(cp.grantee)
      END
    )
  FROM information_schema.column_privileges cp
  WHERE cp.table_schema = 'public'
    AND (
      cp.grantee IN ('anon', 'authenticated', 'PUBLIC')
      OR upper(cp.grantee) = 'PUBLIC'
    )
) snap
ORDER BY section, ordinal;
