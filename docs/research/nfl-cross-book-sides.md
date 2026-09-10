# NFL cross-book moneyline and totals (research only)

**Not a public-board switch. `eligibleForPublic` stays false.**

This is Plan B: a model-free cross-book **price gap** for NFL moneyline and totals that mirrors the props board. It does not enable live NFL sides, write production Supabase, regrade picks, or change MLB / NHL / props behavior.

| Constraint | Value |
| --- | --- |
| `eligibleForPublic` | `false` |
| Production DB writes | `false` |
| The Odds API (this evaluator) | `false` — local JSON only |
| Regrade picks | `false` |
| Merge | `false` |

## Why this exists

Production NFL moneyline / totals still use an unvalidated selection heuristic and stay dark. Props already publish a **line-shopping gap**, not a proprietary forecast:

> Edge = how much better the best available price is versus a vig-removed multi-book consensus.

This research path applies that same idea to NFL `h2h` and `totals` so we can measure a market-structure signal **separately** from `nfl-selection-v1.0.1`.

## Formula (aligned with props)

Implementation: `lib/research/nfl-cross-book-sides.js`  
Prop reference: `scripts/fetch-live-odds.js` `buildLineShoppingEdges`.

For each two-way market (moneyline home/away, or totals over/under at one line):

1. **Per book, de-vig.** Pair both sides from the same book. Proportional de-vig via `removeMlVig` / `removeTotalVig` in `lib/implied.js`.
2. **Consensus fair.** Mean of those per-book vig-free probabilities for the side.
3. **Best available price.** Highest decimal odds on that side (best payout). Convert to **raw** implied probability `1 / decimal` (vig still in).
4. **Price gap (relative):**

```
price_gap = (consensus_fair − best_implied) / consensus_fair
```

Worked language (same as the props glossary example): if consensus fair is 55% and the best book implies 48%, `price_gap = (0.55 − 0.48) / 0.55 ≈ 12.7%`.

Also stored, never mixed into the relative gap:

| Field | Meaning |
| --- | --- |
| `priceGapPp` | `consensus_fair − best_implied` (percentage points; glossary wording) |
| `priceGapFloored` | `max(0, price_gap)` (props UI floors at 0; research keeps the signed gap) |
| `modelGap` | `modelP − consensus_fair` if a model probability is injected; otherwise `null` |

`modelGap` is a **different number**. Injecting a model probability does not change `priceGap`. Do not present a price gap as a model edge.

### Totals lines

Books often disagree on the total (47.5 vs 48). Mixing those implieds is not a two-way market. The evaluator:

- groups over/under pairs by `point`
- uses the **modal** line (most books) as the primary totals market
- ignores off-line books for that consensus

A half-point move is a different bet.

### Minimum books

Default `minBooks = 2`. A single quote is not a consensus.

## What this is not

- Not `nfl-selection-v1.0.1` win-probability versus a stored quote (`modelVersusTwoWayMarketGap`).
- Not a public NFL board, shortlist, or social card.
- Not CLV. Closing-line value needs two timestamps; that is the separate historical pilot.
- Not a claim that a positive gap is +EV. It only says one book is off the others.

## How to run

```bash
# Bundled fixture (no network)
node scripts/research/nfl-cross-book-sides.js --fixture

# Any Odds API-shaped snapshot (historical wrapper or event array)
node scripts/research/nfl-cross-book-sides.js \
  --input scripts/research/fixtures/nfl-cross-book-sides-snapshot.json \
  --phase early \
  --json /tmp/nfl-cross-book.json
```

npm alias: `npm run research:nfl-cross-book -- --fixture`

## Tests

`__tests__/research/nfl-cross-book-sides.test.js` checks the fixture math and that `eligibleForPublic` stays false. Jest mocks `fetch`; this path does not call it.

## Recommendation

Keep public NFL moneyline / totals **dark**. Use this evaluator to inspect live or historical snapshots as research. Enabling the public board still requires an independent, pre-registered beat of the close — see `docs/research/nfl-historical-clv-pilot.md` and `docs/nfl-selection-model.md`.
