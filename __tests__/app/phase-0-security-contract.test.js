import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

function walkJs(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files.push(...walkJs(full))
    else if (name.endsWith('.js')) files.push(full)
  }
  return files
}

describe('PR-E phase 0 security contracts', () => {
  test('public request paths do not persist PropValidation or Featured cards', () => {
    const picks = read('lib/picks.js')
    const hook = read('lib/homepage-hook.js')
    const picksApi = read('app/api/picks/route.js')
    const generate = read('app/api/parlays/generate/route.js')

    expect(picks).not.toMatch(/persistPublishedEligibleProps/)
    expect(picks).not.toMatch(/persistGameLines/)
    expect(picks).toMatch(/record:published/)
    expect(picks).toMatch(/record:game-lines/)

    expect(hook).not.toMatch(/persistPublishedEligibleProps/)
    expect(hook).toMatch(/record:published/)

    expect(picksApi).toMatch(/generateEditorPicks/)
    expect(picksApi).toMatch(/generateGameLines/)
    expect(picksApi).not.toMatch(/persistPublishedEligibleProps/)
    expect(picksApi).not.toMatch(/persistGameLines/)

    expect(generate).toMatch(/allowPersist: isAuthorizedAdmin\(request\)/)
    expect(generate).toMatch(/Request body must be valid JSON/)
    expect(generate).not.toMatch(/details: error\.message/)
  })

  test('scheduled persist scripts still own the writes', () => {
    const pkg = read('package.json')
    expect(pkg).toMatch(/"record:published": "node scripts\/record-published-props\.js"/)
    expect(pkg).toMatch(/"record:featured": "node scripts\/record-featured-parlays\.js"/)
    expect(pkg).toMatch(/"record:game-lines": "node scripts\/record-game-lines\.js"/)

    const gameLines = read('scripts/record-game-lines.js')
    expect(gameLines).toMatch(/persistGameLines/)
    expect(gameLines).toMatch(/does not call The Odds API/)
    expect(gameLines).toMatch(/Homepage \/ \/api\/picks no longer persist/)

    const validate = read('scripts/validate-pending-props.js')
    expect(validate).toMatch(/gradePendingGameLines/)

    const odds = read('scripts/fetch-live-odds.js')
    expect(odds).toMatch(/persistPublishedEligibleProps/)
  })

  test('RLS SQL is checked in and is not referenced by deploy config', () => {
    expect(existsSync(join(process.cwd(), 'scripts/migrations/006_pre_snapshot.sql'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'scripts/migrations/006_rls_lockdown.sql'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'scripts/migrations/006_rls_lockdown_rollback.sql'))).toBe(true)
    const snapshot = read('scripts/migrations/006_pre_snapshot.sql')
    const sql = read('scripts/migrations/006_rls_lockdown.sql')
    const rollback = read('scripts/migrations/006_rls_lockdown_rollback.sql')
    const vercel = read('vercel.json')
    const pkg = read('package.json')

    expect(snapshot).toMatch(/READ-ONLY/)
    expect(snapshot).toMatch(/THIS FILE IS ONE STATEMENT/)
    expect(snapshot).toMatch(/export or copy the FULL grid/)
    expect(snapshot).toMatch(/SELECT section, ordinal, restore_ddl/)
    expect(snapshot).toMatch(/UNION ALL/)
    expect(snapshot).toMatch(/pg_get_function_identity_arguments/)
    expect(snapshot).toMatch(/WHEN 'p' THEN 'PROCEDURE' ELSE 'ROUTINE'/)
    expect(snapshot).toMatch(/relkind = 'S'/)
    expect(snapshot).toMatch(/WHEN 'n' THEN 'SCHEMAS'/)
    expect(snapshot).toMatch(/defaclnamespace = 0 THEN ''/)
    expect(snapshot).toMatch(/THEN 'PUBLIC' ELSE quote_ident/)
    expect(snapshot).not.toMatch(/routine_privileges/)
    expect(snapshot).not.toMatch(/quote_ident\(.*PUBLIC/)
    expect(sql).toMatch(/STEP 0 \(required, read-only\): run 006_pre_snapshot\.sql/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/)
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated/)
    expect(sql).toMatch(/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role/)
    expect(sql).toMatch(/GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO service_role/)
    expect(sql).toMatch(/REVOKE EXECUTE ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role/)
    expect(sql).toMatch(/GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTIONS TO service_role/)
    expect(sql).toMatch(/Does not change ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/)
    expect(sql).toMatch(/SELECT proname, prokind, proacl/)
    expect(sql).toMatch(/^BEGIN;/m)
    expect(sql).toMatch(/^COMMIT;/m)
    expect(sql).toMatch(/FROM pg_policies/)
    expect(sql).toMatch(/role_table_grants/)
    expect(sql).toMatch(/DO NOT run from CI/)
    expect(rollback).toMatch(/Restore from the snapshot output you saved/)
    expect(rollback).toMatch(/This file intentionally has no executable GRANT/)
    expect(rollback).toMatch(/EMERGENCY ONLY/)
    expect(rollback).not.toMatch(/^\s*GRANT /m)
    expect(rollback).not.toMatch(/^\s*CREATE POLICY/m)
    expect(rollback).not.toMatch(/^\s*ALTER TABLE /m)
    expect(rollback).not.toMatch(/pr_e_rollback_public_read/)
    expect(vercel).not.toMatch(/006_rls_lockdown/)
    expect(pkg).not.toMatch(/006_rls_lockdown/)
  })

  test('admin client is lazy and health never constructs it', () => {
    const admin = read('lib/supabase-admin.js')
    const key = read('lib/supabase-admin-key.js')
    const health = read('app/api/health/route.js')
    const supabase = read('lib/supabase.js')

    expect(admin).toMatch(/import 'server-only'/)
    expect(admin).toMatch(/new Proxy/)
    expect(admin).toMatch(/getOrCreateSupabaseAdmin/)
    expect(admin).not.toMatch(/export const supabaseAdmin = createSupabaseAdminClient\(\)/)
    expect(supabase).toMatch(/import 'server-only'/)
    expect(key).not.toMatch(/from '@supabase\/supabase-js'/)
    expect(key).not.toMatch(/import 'server-only'/)
    expect(health).toMatch(/supabase-admin-key\.js/)
    expect(health).not.toMatch(/supabase-admin\.js/)
  })

  test('client components and pages do not import Supabase clients', () => {
    const roots = ['components', 'app']
    for (const root of roots) {
      for (const file of walkJs(join(process.cwd(), root))) {
        const src = readFileSync(file, 'utf8')
        if (!src.includes("'use client'") && !src.includes('"use client"')) continue
        expect(src).not.toMatch(/from ['"].*supabase-admin/)
        expect(src).not.toMatch(/from ['"].*\/supabase['"]/)
        expect(src).not.toMatch(/SUPABASE_SECRET_KEY/)
        expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)
      }
    }
  })

  test('server reads go through the admin client module', () => {
    const supabase = read('lib/supabase.js')
    expect(supabase).toMatch(/supabaseAdmin as supabase/)
    expect(supabase).toMatch(/supabase-admin/)
    expect(supabase).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)

    const history = read('app/api/parlays/history/route.js')
    expect(history).toMatch(/supabase-admin/)
    expect(history).not.toMatch(/createClient/)
    expect(history).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  })

  test('ops README requires calculate-game-edges before record-game-lines', () => {
    const ops = read('operations/README.md')
    expect(ops).toMatch(/REQUIRED: calculate game edges before record-game-lines/)
    expect(ops).toMatch(/Vercel Build also needs/)
    expect(ops).toMatch(/sitemap\.xml/)
    expect(ops).toMatch(/Before running 006/)
    expect(ops).toMatch(/006_pre_snapshot\.sql/)
    expect(ops).toMatch(/calculate-prop-edges\.js/)
    expect(ops).toMatch(/update-scores-safely\.js/)
    expect(ops).toMatch(/follow-up PR/)
    expect(ops).toMatch(/node -e "require\('dotenv'\)\.config\(\{path:'\.env\.local'\}\);console\.log\(!!process\.env\.SUPABASE_SECRET_KEY\)"/)
    expect(ops).not.toMatch(/test -n "\$SUPABASE_SECRET_KEY"/)
  })

  test('dead if (!supabase) guards are replaced on the lazy Proxy paths', () => {
    const files = [
      'lib/homepage-hook.js',
      'lib/todays-games.js',
      'lib/top-props.js',
      'lib/validation.js',
      'lib/simple-parlay-generator.js',
      'lib/picks.js',
      'lib/score-updater.js',
      'lib/db.js',
      'app/sitemap.js',
      'app/api/picks/route.js',
      'app/api/props/route.js',
      'app/api/refresh-status/route.js',
    ]
    for (const file of files) {
      const src = read(file)
      expect(src).not.toMatch(/if\s*\(\s*!supabase\b/)
      expect(src).toMatch(/isSupabaseAdminConfigured|isUsableSupabase/)
    }
    expect(read('lib/supabase-admin-key.js')).toMatch(/export function isSupabaseAdminConfigured/)
    expect(read('lib/supabase-admin.js')).toMatch(/SUPABASE_ADMIN_PROXY/)
  })

  test('rate-limit follow-up stays a TODO hook', () => {
    const security = read('lib/api-security.js')
    expect(security).toMatch(/TODO\(phase-0-follow-up\): replace with Upstash Redis/)
    expect(security).toMatch(/UPSTASH_REDIS_REST_URL/)
  })

  test('jest stubs server-only so the admin client can load in tests', () => {
    const jestConfig = read('jest.config.js')
    expect(jestConfig).toMatch(/server-only/)
    expect(jestConfig).toMatch(/__tests__\/stubs\/server-only\.js/)
    expect(existsSync(join(process.cwd(), '__tests__/stubs/server-only.js'))).toBe(true)
  })
})
