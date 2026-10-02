// Empty on purpose. Next.js still treats `import 'server-only'` as a
// client-boundary error at compile time. Official server-only throws in
// Node, which would break laptop `node scripts/*.js` that import
// lib/supabase-admin.js / lib/supabase.js / lib/validation.js.
export {}
