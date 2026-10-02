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
    expect(existsSync(join(process.cwd(), 'scripts/migrations/006_rls_lockdown.sql'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'scripts/migrations/006_rls_lockdown_rollback.sql'))).toBe(true)
    const sql = read('scripts/migrations/006_rls_lockdown.sql')
    const rollback = read('scripts/migrations/006_rls_lockdown_rollback.sql')
    const vercel = read('vercel.json')
    const pkg = read('package.json')

    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/)
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated/)
    expect(sql).toMatch(/FROM pg_policies/)
    expect(sql).toMatch(/role_table_grants/)
    expect(sql).toMatch(/DO NOT run from CI/)
    expect(rollback).toMatch(/pr_e_rollback_public_read/)
    expect(rollback).toMatch(/ClosingOdds/)
    expect(vercel).not.toMatch(/006_rls_lockdown/)
    expect(pkg).not.toMatch(/006_rls_lockdown/)
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

  test('rate-limit follow-up stays a TODO hook', () => {
    const security = read('lib/api-security.js')
    expect(security).toMatch(/TODO\(phase-0-follow-up\): replace with Upstash Redis/)
    expect(security).toMatch(/UPSTASH_REDIS_REST_URL/)
  })
})
