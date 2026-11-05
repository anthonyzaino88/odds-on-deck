# Published-pick price snapshots

Executable SQL: `scripts/migrations/011_odds_snapshots.sql`.
Rollback: `scripts/migrations/011_odds_snapshots_rollback.sql`.
Both set `lock_timeout = '5s'`.

Do **not** run these from CI, a cloud agent, or a production refresh job.
Anthony applies them in the Supabase SQL editor.

`OddsSnapshot` is **not** on Prisma — same reason 007 close columns stay
SQL-only. `prisma.propValidation.findMany()` without an explicit
`select` must not request snapshot fields.

Writers and readers degrade on `PGRST204` / `42703` / `42P01` (missing
table or column) with a warning. They do not crash.

## How to apply (do not run from this PR)

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/011_odds_snapshots.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` /
   additive and can be re-run.
4. Confirm with the `information_schema.columns` check in that file:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'OddsSnapshot'
ORDER BY ordinal_position;
```

Do **not** apply from CI. Do not backfill. Do not regrade. Do not
change CLV (`implied(close) − implied(recorded)`).

Rollback (same editor, do not run from CI):
`scripts/migrations/011_odds_snapshots_rollback.sql` drops the table.
Published odds, closes, and grades stay.

## Credits

`scripts/snapshot-published-odds.js` uses the existing budget guard and
`regions=us`. It does not change the morning fetch or close capture.
Snapshots are informational only.
