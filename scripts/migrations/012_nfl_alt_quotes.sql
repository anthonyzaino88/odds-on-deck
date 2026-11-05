-- ============================================================================
-- NFL alternate-line shop (Published player props)
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Additive / IF NOT EXISTS — safe to re-run. Does not backfill.
--
-- WHY:
--   Morning fetch stores one best price at the posted line. Published NFL
--   picks also need the alternate-line ladder (e.g. Over 64.5 −110 vs
--   Over 62.5 −135) so the public board can shop line+price, not only
--   juice at the recorded number.
--
-- WHAT THIS DOES:
--   PlayerPropCache.altQuotes JSONB — best book per alternate line for
--   that cache row's player + side.
--   PlayerPropCache.altQuoteUpdatedAt — newest book last_update on that
--   alt snapshot. Historical rows stay NULL.
--
-- WHAT THIS DOES NOT DO:
--   Does not change clvProb (posted/entry vs consensus close at the
--   same line). Does not change quotes / quoteUpdatedAt / entryBook.
--   Does not add Odds API regions. The alt-line script uses regions=us
--   and only events with Published NFL picks.
--
-- PlayerPropCache already has RLS from 006. ENABLE is idempotent.
-- Do not REVOKE here — that would rewrite grants on an existing table.
--
-- VERIFY:
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'PlayerPropCache'
--     AND column_name IN ('altQuotes', 'altQuoteUpdatedAt')
--   ORDER BY column_name;
--
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'PlayerPropCache';
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE "PlayerPropCache"
  ADD COLUMN IF NOT EXISTS "altQuotes" JSONB,
  ADD COLUMN IF NOT EXISTS "altQuoteUpdatedAt" TIMESTAMPTZ;

ALTER TABLE "PlayerPropCache" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "PlayerPropCache" TO service_role;

COMMENT ON COLUMN "PlayerPropCache"."altQuotes" IS
  'Best book per alternate line for this player+side: [{line, side, price, book, lastUpdate}]. NULL until 012 is applied and the alt-line script writes it.';
COMMENT ON COLUMN "PlayerPropCache"."altQuoteUpdatedAt" IS
  'Fetch time of this alt-line snapshot (not newest book last_update). Per-book lastUpdate stays on altQuotes. NULL if none.';
