# Featured parlay track (Phase B)

Featured quality is unchanged from Phase A: Published-eligible props only,
exactly 3 legs, MLB + NFL, `#20` integrity on. This note is the persist /
grade cohort that sits on top of that bar.

## What is persisted

- Only cards that pass `isFeaturedWorthyParlay` (`lib/parlay-integrity.js`).
- Written to the existing `Parlay` / `ParlayLeg` tables.
- Tagged `notes = cohort:featured snapshot:featured:{sport}:{sgp|multi}:{YYYY-MM-DD}`.
- One snapshot slot per sport + kind + ET slate day. First Featured-cleared
  write wins. Later live regenerates do not replace the tracked card.
- Featured **multi** is actually multi-game (2+ distinct `gameId`s). A
  same-game trio belongs only in the SGP slot so `/parlays` cannot show
  two identical SGP cards.
- Persist re-reads the slot after insert and retracts pending losers so
  overlapping generates cannot keep two rows for the same key.
- `/parlays` serves the snapped card for a filled slot (stored
  `totalOdds`), not a live regenerate. Explorer Builder is unchanged.
- Explorer Builder combinations are rejected from `/api/parlays/save` and
  never written by `/api/parlays/generate` unless `featured=1`.

No schema migration. `Parlay.notes` is the cohort tag, same pattern as
`cohort:published` on `PropValidation`.

## How a card lands on the track

1. Visiting `/parlays` (Featured GET generate) or `npm run record:featured`.
2. Explicit save of a card that still clears the Featured bar.
3. Persist does **not** call The Odds API. It reads the same PlayerPropCache
   Featured already uses.

## How it is graded

`validate:all` grades **player props first** (`validate` /
`run-validation-check.js` → `validate-pending-props.js`), then parlays
(`validate:parlays` / `auto-validate-parlays.js`). Featured needs a
numeric `PropValidation.actualValue` before a leg can settle.

`/api/parlays/validate` (admin) and `validate:parlays` settle Featured
legs from `PropValidation` via `gradeFeaturedParlayFromValidations`
(`lib/featured-parlays.js`). Featured does **not** insert a second
prop row — that would double-count the Published ROI card. Grades reuse
the Published persist (`record:published` / odds-fetch sweep).

Fail-closed: pending, `needs_review`, or a completed row without a
numeric actual (and without a settled result) leaves the card
**pending**. Do not treat “pending” as actual 0. A real DNP / zero
from the box score is only used when Published validation wrote
`status=completed` with `actualValue=0`. Missing box / `needs_review`
stays honestly empty until a number exists.

A lost leg settles the parlay immediately. Push only when every leg is
decided and at least one pushed.

### Regrade already-written Featured cards (local)

After a bad run (parlays before props, or assumed-0 legs), recompute
from current `PropValidation` without hitting a remote agent DB:

```bash
npm run regrade:featured
# or one card:
node scripts/auto-validate-parlays.js --regrade --id <parlayId>
```

`--regrade` includes settled Featured rows so a false loss can be
corrected. Cards that still lack numeric actuals stay (or return to)
pending.

## Honest empty

History and validate stats query `notes` for `cohort:featured`. Untagged
historical Builder rows stay out. No Featured-cleared cards → empty list,
not filler.

## Remaining gaps

1. **Snapshot is the public Featured card.** `/parlays` reads the snapped
   cohort row for a filled sport+kind+ET-day slot. Live generate only
   fills an empty slot. Mid-day line moves no longer replace the tracked
   card on screen.
2. **Snapshot timing.** First visit / `record:featured` after a card
   clears wins that slot. There is no pinned “board lock” clock (e.g.
   10:00 ET). A late first persist uses that later card.
3. **Homepage teaser / social.** Phase C/D. Out of scope.
4. **Builder Published-mode.** Explorer stays exploratory. A later toggle
   could reuse this same persist gate without forking it.
5. **Cross-sport Featured display.** Generator can build `sport=mixed`;
   the page still asks MLB then NFL separately.
6. **NHL.** Off Featured until the public Published card includes it.
7. **Public NFL sides/totals.** Still disabled. Featured is props-only.
8. **Historical untagged parlays.** Pre-Phase-B Builder rows are not
   backfilled and do not appear on this track.

## Duplicate snapshot rows (optional cleanup)

Overlapping Featured writes (page SGP + multi fetch, two visitors)
could insert two `Parlay` rows with the same `snapshot:featured:...`
key before the claim-after-insert guard existed. History now hides
later copies. To remove leftover pending/settled dupes from the DB:

```bash
node scripts/cleanup-duplicate-featured-parlays.js          # dry-run
node scripts/cleanup-duplicate-featured-parlays.js --apply  # delete later copies + legs
```

Keeps the earliest `createdAt` (then `id`) per snapshot key. Does not
touch unique slots. Not a silent migration — dry-run is the default.
