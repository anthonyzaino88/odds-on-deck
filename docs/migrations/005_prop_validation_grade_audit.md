# PropValidation grade audit

Executable SQL lives at `scripts/migrations/005_prop_validation_grade_audit.sql`.

Do **not** add these columns to the Prisma `PropValidation` model until the SQL has been applied. Prisma `findMany()` without an explicit `select` would request the new scalars and fail on a pre-migration database.

## How to apply (do not run from this PR)

1. Open Supabase → SQL Editor.
2. Paste `scripts/migrations/005_prop_validation_grade_audit.sql`.
3. Run it in a planned ops window. The script is `IF NOT EXISTS` / additive and can be re-run.
4. Confirm with the `information_schema.columns` check in that file.

Do **not** apply from CI. Do not backfill. Do not regrade historical rows.

## What the app does before and after

`lib/grade-audit.js` attaches `updatedAt`, `gradedAt`, `gradedBy`, and `gradeSource` on PropValidation grade writes. If PostgREST returns a missing-column error (`PGRST204` / `42703`), the same write retries without those fields.

Writers:

- `lib/validation.js` `updatePropResult` (`gradeSource=update_prop_result`)
- `lib/validation.js` `gradePendingGameLines` (`gradeSource=grade_pending_game_lines`)
- `scripts/validate-pending-props.js` (`gradeSource=validate_pending_props`)

Parlay / ParlayLeg already have `updatedAt` and Featured grade patches already write it.
