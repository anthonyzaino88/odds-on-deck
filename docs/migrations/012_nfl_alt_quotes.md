# NFL alternate-line shop

Executable SQL: `scripts/migrations/012_nfl_alt_quotes.sql`.
Rollback: `scripts/migrations/012_nfl_alt_quotes_rollback.sql`.
Both set `lock_timeout = '5s'`.

Do **not** run these from CI, a cloud agent, or a production refresh job.
Anthony applies them in the Supabase SQL editor.

`altQuotes` / `altQuoteUpdatedAt` are **not** on Prisma — same reason
007 close columns and 011 `OddsSnapshot` stay SQL-only.
`altQuoteUpdatedAt` is the fetch time. Per-book `lastUpdate` stays
inside `altQuotes`.
`prisma.playerPropCache.findMany()` without an explicit `select` must
not request them.

`PlayerPropCache` already has RLS from 006. 012 re-enables it
(idempotent) and grants `service_role`. It does **not** `REVOKE` on
this existing table.

Writers degrade on `PGRST204` / `42703` with a warning. They do not
crash. `/api/props` returns `altLines: null` when the columns are
absent.

A cache miss for a Published `propId` may insert a non-playable
placeholder row that only holds `altQuotes`. That row is `isStale:
true` with `confidence: 'low'` (a normal cache value, not a special
token) and `category = alt-placeholder`. Public prop queries
(`/api/props`, homepage, Editor's, Published) select `isStale = false`,
so the placeholder is not a play. Morning cleanup keeps
`alt-placeholder` rows until `gameTime` has passed, then `past_game`
archives and deletes them. A placeholder with no parseable kickoff is
kept only until `fetchedAt` + 7 days. Public boards also require
`fetchedAt` within 24 hours; a longer `expiresAt` only keeps the row
for cleanup and close, it does not keep an old price on the board.

## How to apply (do not run from this PR)

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/012_nfl_alt_quotes.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` /
   additive and can be re-run.
4. Confirm with the checks in that file:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'PlayerPropCache'
  AND column_name IN ('altQuotes', 'altQuoteUpdatedAt')
ORDER BY column_name;

SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'PlayerPropCache';
```

`relrowsecurity` should be `true`.

Do **not** apply from CI. Do not backfill. Do not regrade. Do not
change CLV (`implied(close) − implied(recorded)` at the posted line).

Rollback (same editor, do not run from CI):
`scripts/migrations/012_nfl_alt_quotes_rollback.sql` drops the two
columns. Posted quotes, Published odds, closes, and grades stay.

## Credits

`scripts/fetch-published-nfl-alt-lines.js` uses the existing budget
guard and `regions=us`. It does not change the morning fetch, close
capture, or snapshot routines. Alt lines are informational only.
