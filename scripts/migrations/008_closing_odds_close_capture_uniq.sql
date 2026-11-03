-- ============================================================================
-- ClosingOdds close-capture uniqueness
-- ============================================================================
-- APPLY MANUALLY in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- DO NOT run from CI, this PR, or a production refresh job.
-- Safe to re-run (IF NOT EXISTS, report SELECT, exact-duplicate extras only).
-- Never deletes a non-duplicate. Does not touch T-30 snapshot-closing-lines
-- rows (ids that do not start with clvclose:).
-- DELETE of exact-duplicate extras is NOT undone by the rollback file.
-- Rollback only drops the index; deleted rows stay deleted.
--
-- WHY:
--   Close capture writes ClosingOdds with deterministic clvclose: ids.
--   There is no unique (game, book, market) key, so overlapping applies
--   or mixed book casing can leave two close-capture rows for one pick.
--
-- WHAT THIS DOES:
--   1. Reports close-capture groups that share lower(game_id, book, market).
--   2. Deletes extras only when every row in the group is an exact
--      duplicate (same price_home, price_away, total, spread). Keeps the
--      canonical clvclose: id when present, else oldest snapshot_at, else
--      smallest id.
--   3. Creates a partial unique index on those keys WHERE id LIKE
--      'clvclose:%' — only if no mixed (non-exact) groups remain.
--
-- WHAT THIS DOES NOT DO:
--   Does not delete snapshot-closing-lines rows.
--   Does not delete a group that has two different prices for the same
--   game/book/market. Those are reported; the unique index is skipped
--   until an operator inspects them. Re-run this file after that.
--   Does not rewrite PropValidation closeOdds.
--
-- VERIFY:
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'ClosingOdds'
--     AND indexname = 'ClosingOdds_close_capture_uniq';
-- ============================================================================

SET lock_timeout = '5s';

-- Report remaining close-capture collisions (read-only).
SELECT
  lower(game_id) AS game_id,
  lower(book) AS book,
  lower(market) AS market,
  COUNT(*) AS rows,
  COUNT(DISTINCT (price_home, price_away, total, spread)) AS distinct_quotes
FROM "ClosingOdds"
WHERE id LIKE 'clvclose:%'
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY rows DESC, game_id, book, market;

-- Exact-duplicate extras only: the whole group shares one quote.
DELETE FROM "ClosingOdds" AS doomed
WHERE doomed.id LIKE 'clvclose:%'
  AND doomed.id IN (
    SELECT ranked.id
    FROM (
      SELECT
        id,
        COUNT(*) OVER (
          PARTITION BY lower(game_id), lower(book), lower(market)
        ) AS grp_count,
        COUNT(*) OVER (
          PARTITION BY lower(game_id), lower(book), lower(market),
            price_home, price_away, total, spread
        ) AS exact_count,
        ROW_NUMBER() OVER (
          PARTITION BY lower(game_id), lower(book), lower(market),
            price_home, price_away, total, spread
          ORDER BY
            CASE
              WHEN id = 'clvclose:' || lower(game_id) || '|' || lower(book) || '|' || lower(market)
                THEN 0
              ELSE 1
            END,
            snapshot_at ASC NULLS LAST,
            id ASC
        ) AS rn
      FROM "ClosingOdds"
      WHERE id LIKE 'clvclose:%'
    ) ranked
    WHERE ranked.grp_count > 1
      AND ranked.exact_count = ranked.grp_count
      AND ranked.rn > 1
  );

DO $$
DECLARE
  mixed_count integer;
BEGIN
  SELECT COUNT(*) INTO mixed_count
  FROM (
    SELECT 1
    FROM "ClosingOdds"
    WHERE id LIKE 'clvclose:%'
    GROUP BY lower(game_id), lower(book), lower(market)
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT (price_home, price_away, total, spread)) > 1
  ) mixed;

  IF mixed_count > 0 THEN
    RAISE NOTICE
      'Skipping unique index: % mixed (non-exact) close-capture groups remain. Inspect the report SELECT above; do not delete those rows from this file.',
      mixed_count;
  ELSE
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS "ClosingOdds_close_capture_uniq"
      ON "ClosingOdds" (lower(game_id), lower(book), lower(market))
      WHERE id LIKE 'clvclose:%'
    $idx$;
    RAISE NOTICE 'ClosingOdds_close_capture_uniq is present (or was already present).';
  END IF;
END $$;
