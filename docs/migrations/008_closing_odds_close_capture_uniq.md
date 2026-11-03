# ClosingOdds close-capture unique index

Executable SQL: `scripts/migrations/008_closing_odds_close_capture_uniq.sql`.
Rollback: `scripts/migrations/008_closing_odds_close_capture_uniq_rollback.sql`.
Both set `lock_timeout = '5s'`.

## How to apply (do not run from this PR)

This repo applies additive SQL in the Supabase SQL Editor. It does **not**
run `prisma migrate` in CI or against production from a pull request.

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/008_closing_odds_close_capture_uniq.sql`.
3. Run it in a planned ops window. The script is safe to re-run.
4. Read the report `SELECT` of colliding `clvclose:` groups (empty is fine).
5. Confirm:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ClosingOdds'
  AND indexname = 'ClosingOdds_close_capture_uniq';
```

Do **not** apply from CI. Do not run against production from this PR.

Rollback (same editor, do not run from CI):
`scripts/migrations/008_closing_odds_close_capture_uniq_rollback.sql` drops
the index. Exact-duplicate rows already deleted stay deleted.

## What it cleans

Only close-capture rows (`id LIKE 'clvclose:%'`).

- **Exact duplicates** (same `game_id` / `book` / `market` after lowercasing,
  and the same `price_home`, `price_away`, `total`, `spread`): keep one,
  delete the extras. Prefer the canonical `clvclose:game|book|market` id,
  then oldest `snapshot_at`, then smallest `id`.
- **Mixed groups** (same key, different quotes): reported, **not** deleted.
  The unique index is skipped until those groups are empty. Re-run this
  file after an operator inspects them.

T−30 `snapshot-closing-lines` rows (cuid ids, no `clvclose:` prefix) are
out of scope and stay insertable.

## Prisma

`ClosingOdds` stays without a table-wide `@@unique([gameId, book, market])`
because snapshot rows share that triple with close-capture rows. The
partial unique index lives in SQL only.
