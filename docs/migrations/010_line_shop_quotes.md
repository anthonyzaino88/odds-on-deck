# Line-shop quote ladder + Published entry book

Executable SQL: `scripts/migrations/010_line_shop_quotes.sql`.
Rollback: `scripts/migrations/010_line_shop_quotes_rollback.sql`.
Both set `lock_timeout = '5s'`.

Do **not** run these from CI, a cloud agent, or a production refresh job.
Anthony applies them in the Supabase SQL editor.

`PlayerPropCache.quotes` / `quoteUpdatedAt` are on the Prisma model as
optional scalars. `PropValidation.entryBook` is **not** on Prisma until
this SQL has been applied — `prisma.propValidation.findMany()` without
an explicit `select` would request it and fail on a pre-migration
database (same reason 007 close columns stay SQL-only).

Writers retry without the new columns on `PGRST204` / `42703`.

## How to apply (do not run from this PR)

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/010_line_shop_quotes.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` /
   additive and can be re-run.
4. Confirm with the `information_schema.columns` check in that file.

Do **not** apply from CI. Do not backfill discarded ladders. Do not
regrade. Do not change CLV (`implied(close) − implied(recorded)`).

Rollback (same editor, do not run from CI):
`scripts/migrations/010_line_shop_quotes_rollback.sql` drops the three
columns. Cached best-book rows and recorded Published odds stay.

## Credits

No extra Odds API regions or daily refetches. Morning fetch still uses
`regions=us`. The ladder is persisted from the payload already paid for.
