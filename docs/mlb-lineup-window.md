# MLB lineup-window recording

Morning ops (~8:10 AM ET) used to persist Published and Featured MLB
props about 8.5 hours before first pitch, before lineups post. That is
how no-play (0 PA / 0 BF) picks landed on the public track, and the
prices were stale.

## New rule

MLB Published / Featured rows are recorded only when **all** of these
are true:

1. The game is in the **90-minute window before first pitch**.
2. The game has **not started** (`Game.date` still in the future and
   status is not live / final / postponed).
3. The player is in the **confirmed batting order**, or is the
   **confirmed probable / starting pitcher**.

NFL (and NHL) recording is unchanged. Morning `record:published` and
`record:featured` still run for NFL.

## What the owner schedules

Keep the existing :09 ET hourly job as-is. **Do not write to the DB
during :05–:15 ET.**

Add a second hourly task at **:16 ET** (or later):

```
npm run record:mlb-window
```

or `node scripts/record-mlb-window-props.js`.

If it is accidentally invoked at :09, it no-ops and exits 0.

The script:

- Does **not** call The Odds API
- Fetches confirmed starters from the MLB Stats API
  (`hydrate=probablePitcher,lineups`) and boxscore batting order
- Falls back to ESPN summary probables (same source as `lib/db.js`)
- Records Published-eligible cache props for in-window games
- Tries Featured MLB (`single_game` / `multi_game`) only if a 3-leg
  card clears with confirmed legs; first write still wins the slate slot

## Why 90 minutes + :16 ET

A 90-minute window plus an hourly :16 job always has at least one
run about 54 minutes before first pitch (lineups are usually posted
by then). We never write after first pitch. If lineups are still
missing at T−54 and the next :16 is after first pitch, that game is
skipped — honest miss, not a no-play.

## Morning path

`persistPublishedEligibleProps` skips MLB unless the caller passes
`mlbGate` (games + lineups + now). `fetch-live-odds` and
`npm run record:published` omit the gate, so morning MLB is skipped.

`npm run record:featured` loops NFL only. Persist also rejects MLB
cards without `mlbGate`, so a stale morning Featured cannot lock the
day’s slot.

## Tests

See `__tests__/lib/mlb-recording-window.test.js` and
`__tests__/lib/record-mlb-window-props.test.js`.
