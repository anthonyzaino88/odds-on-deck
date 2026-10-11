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
4. The clock is inside the recording hours below (and not `:05–:15`).

NFL (and NHL) recording is unchanged. Morning `record:published` and
`record:featured` still run for NFL.

Player names use the PR #45 matcher: NFD + strip diacritics, then the
usual Jr / initial fold. `José Ramírez` matches `Jose Ramirez`.

## What the owner schedules

Keep the existing :09 ET hourly job as-is. **Do not write to the DB
during :05–:15 ET.**

Add **two** tasks, at **:16 ET and :46 ET**, during:

| Season | Hours (ET) |
| --- | --- |
| Regular | **11–22** |
| Postseason | **12–22** (`--postseason`) |

A 7:05 ET first pitch then gets a look at 5:46, 6:16, and 6:46 after
lineups usually post — not a single :16 that can miss.

```
node scripts/record-mlb-window-props.js
node scripts/record-mlb-window-props.js --postseason
```

or `npm run record:mlb-window` (add `-- --postseason` only in bash;
on PowerShell use the `node scripts/...` form).

If it is accidentally invoked at :09, it no-ops and exits 0.

The script:

- Does **not** call The Odds API
- Fetches confirmed starters from the MLB Stats API
  (`hydrate=probablePitcher,lineups`) and boxscore batting order
- Falls back to ESPN summary probables (same source as `lib/db.js`)
- Records Published-eligible cache props for in-window games
- Builds Featured **single-game** cards **per in-window gameId**
- Builds Featured **multi-game** only from those same in-window,
  confirmed games (not the whole morning cache)
- First write still wins the sport+kind+ET-day slot — an afternoon
  SGP can lock the day's single-game card before a night game

## Doubleheaders

`fetch-fresh-games` collapses a same-day doubleheader into **one**
`Game.id` (`away_at_home_YYYY-MM-DD`) and keeps the first `gamePk`.
Examples: `CHC_at_BOS_2026-09-25`, `TB_at_NYY_2026-09-22`.

The schedule call `fetchMlbConfirmedLineup` already makes returns
`doubleHeader` and `gameNumber`. When `doubleHeader` is `Y`
(scheduled) or `S` (split), that game is skipped. We do not record
it. Two-row leftovers (`_g2` / two gamePks) are still skipped too.

## Why 90 minutes + :16 / :46

A 90-minute window plus two looks an hour apart always has a run
inside about an hour of first pitch. We never write after first
pitch. If lineups are still missing at the last :16/:46 before start,
that game is skipped — honest miss, not a no-play.

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
