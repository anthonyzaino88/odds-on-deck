# Honest Published record: legacy NFL rows

The public Published card (`summarizePublishedPicks` /
`getPublishedPicksStats`) no longer counts 81 NFL rows from an older
generator. Those rows stay in `PropValidation`. Nothing is deleted.

## The rule

**Drop NFL Published-track rows whose record time is before
`2026-03-01` 00:00 America/New_York (`2026-03-01T05:00:00.000Z`).**

Record time is `PropValidation.timestamp` (insert), then `completedAt`.
A row with neither timestamp is kept — no evidence, so we do not
exclude it.

Helper: `isLegacyNflPublishedRow` in `lib/published-picks.js`.
Constant: `PUBLISHED_PIPELINE_START`.

This applies only to the **graded public record** (`isPublishedPick`).
Today's board and persist (`isPublishedEligibleProp`) are unchanged.

## Why this cutoff

The Oct 2026 read-only profitability review (PropValidation dump)
found:

- Published after DNP voids: 740 decided, +12.31u.
- 81 of those are NFL from the weeks of 2025-10-27 and 2025-11-03.
- They add about +9.79u. Excluding them (and the already-voided DNPs)
  leaves 659, +2.52u.

Those 81 are the **only** pre-2026 Published rows. They share an
old-generator fingerprint the current persist path does not produce:

- probability 0.50–0.515
- edges 15–49% (line-shopping today is typically 1–7%)
- American +125 to +180

The current persist (`toPublishedValidationFields` /
`recordPublishedEligibleProp` / `notes=cohort:published`) first
produced modern MLB Published weeks starting 2026-03-23, and modern
NFL weeks starting 2026-09-07 (avg NFL edge ~1.4%, not 24%).

Midnight ET on 2026-03-01 sits after the Nov 2025 cluster and before
the first modern Published week. A date rule is reversible and does
not depend on reconstructing the old generator.

The preview script also prints how many excluded rows still match
the old-generator fingerprint. That is corroboration, not the gate.

## What we considered and rejected

- **Deleting rows.** Irreversible. The owner asked for a filter or a
  flag, never deletes.
- **A flag column + `--apply`.** Useful if the set were ambiguous.
  Here the 81 rows are exactly "NFL recorded before the current
  pipeline." A code-level filter is enough and needs no migration.
- **`notes = cohort:published` only.** Some 2026 rows may have been
  written by an older auto-save (`tier:elite,auto-saved`) and later
  graded. Requiring the tag would drop real 2026 picks.
- **Fingerprint-only (prob / edge / odds).** Precise to the 2025
  cluster, but a future honest +150 NFL pick with a 15% model edge
  would disappear. The date rule will not.

## Preview (read-only)

On the ops laptop, with `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SECRET_KEY`):

```
node scripts/preview-legacy-nfl-published.js
```

or `npm run preview:legacy-nfl`.

Prints the Published record before and after, every excluded row,
and the fingerprint overlap. Never writes. `--apply` exits 2 on
purpose.

## How to undo

Revert or delete `isLegacyNflPublishedRow` from `isPublishedPick`,
or move `PUBLISHED_PIPELINE_START` earlier. Rows are untouched.
