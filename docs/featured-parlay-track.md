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

`/api/parlays/validate` (admin) and the existing `validate:parlays` script
settle legs from `PropValidation`. Featured does **not** insert a second
prop row — that would double-count the Published ROI card. Grades reuse
the Published persist (`record:published` / odds-fetch sweep).

A lost leg settles the parlay immediately. Push only when every leg is
decided and at least one pushed.

## Honest empty

History and validate stats query `notes` for `cohort:featured`. Untagged
historical Builder rows stay out. No Featured-cleared cards → empty list,
not filler.

## Remaining gaps

1. **Live Featured can still churn.** The `/parlays` Featured section is
   still generated live. Mid-day line moves can change or empty the card
   on screen while the tracked snapshot stays the morning write. Serving
   the snapshot as the public Featured card is not in this phase.
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
