export const SITE_URL = 'https://oddsondeck.com'

export const GLOSSARY_TERMS = [
  {
    slug: 'edge',
    title: 'Edge',
    definition:
      "The percentage difference between one book's implied probability and the vig-removed market consensus. A positive edge means that book is offering a better price than the rest of the market.",
    example:
      'If consensus is 55% but one book implies only 48%, that book is paying more than the market thinks it should.',
    body: [
      "Edge on Odds on Deck is a comparison, not a proprietary model pick. We take one book's implied probability and subtract it from the vig-removed consensus of the rest of the market. When a book is paying more than that consensus says the number is worth, the gap shows up as a positive edge.",
      "A positive edge only means that book's price is better than the field. It does not mean the bet will win, and it is not a recommendation. Lines move, the market can be wrong, and a better price can still lose.",
      'Use edge to line-shop: sort the props board to see where one book is out of line with the others, then decide for yourself whether the number is worth tracking.',
    ],
    related: ['implied-probability', 'vig', 'win-probability'],
    tool: { href: '/props', label: 'Compare props' },
  },
  {
    slug: 'implied-probability',
    title: 'Implied Probability',
    definition:
      'The break-even win rate embedded in the odds. American odds of -110 imply ~52.4% — you need to win more than that to profit long-term.',
    example:
      "+150 odds imply 40% probability. If the true chance is 50%, that's a value bet.",
    body: [
      "Every posted price encodes a required win rate. American odds of -110 imply about 52.4%. That is the break-even point after the book takes its cut — you need to be right more often than that just to get back to even over time.",
      "We convert every book's number to implied probability so you can compare prices on the same scale. +150 implies 40%. If you think the real chance is higher than the number on the board, the price is theoretically better than break-even. That is a statement about the posted odds, not a forecast from a hidden model.",
      'Implied probability still includes vig until we strip it. Edge and win probability on this site are computed after that step, so they are not the same as one book\'s raw conversion.',
    ],
    related: ['vig', 'edge', 'win-probability'],
    tool: { href: '/props', label: 'See implied probabilities on props' },
  },
  {
    slug: 'vig',
    title: 'Vig',
    definition:
      "The sportsbook's built-in margin. Both sides of a bet add up to more than 100%. We strip the vig to see the true market probability.",
    example: '-110 on both sides = ~104.8% total. The extra 4.8% is the book\'s cut.',
    body: [
      "Vig (also called juice) is the sportsbook's built-in margin. On a two-way market the two implied probabilities add up to more than 100%. That extra is not anyone's true chance of winning — it is the book's cut.",
      'A standard -110 / -110 market totals about 104.8%. The extra 4.8% is vig. A juicier market (-115 / -115, or worse) hides more margin and makes the raw implied probabilities look more certain than they are.',
      "We strip the vig so the two sides sum to 100% and you can compare books without the margin baked in. Edge and win probability on Odds on Deck are both computed after that step.",
    ],
    related: ['implied-probability', 'edge', 'win-probability'],
    tool: { href: '/props', label: 'See vig-removed numbers' },
  },
  {
    slug: 'quality-score',
    title: 'Quality Score',
    definition:
      "A sorting aid (0-10) combining line deviation from consensus, the number of books offering the prop, and implied probability. It's context, not a recommendation.",
    example:
      'Scores above 7 typically mean strong agreement across books and a meaningful gap from consensus.',
    body: [
      'Quality score is a 0–10 sort key, not a pick and not a recommendation. It mixes three things already on the board: how far one line sits from consensus, how many books offer the prop, and the implied probability of the number.',
      'A high score (often 7+) usually means books agree and one number still stands off consensus. A low score can mean thin books, a noisy market, or a line that is already in line with the field.',
      'Use it to order the table so unusual lines float up. Do not treat a high score as "bet this." You still have to read the matchup, the line, and the price.',
    ],
    related: ['edge', 'line-shopping', 'implied-probability'],
    tool: { href: '/picks', label: "See editor's picks" },
  },
  {
    slug: 'line-shopping',
    title: 'Line Shopping',
    definition:
      'Comparing the same bet across multiple sportsbooks to find the best price. A half-point or +10 in odds compounds over hundreds of bets.',
    example: 'Player Over 2.5 hits might be -130 on DraftKings but -110 on BetRivers.',
    body: [
      'Line shopping is comparing the same bet across books: same player, same stat, same side. One shop might post -130; another -110. Over hundreds of bets, a half-point or +10 in odds is the difference between grinding and leaking.',
      'Odds on Deck puts 10+ books next to each other so the better number is visible without opening six apps. That is the whole point of the props board.',
      'A better price is still just a price. Line shopping does not make a bad number good — it only makes sure you are not paying extra juice for the same bet.',
    ],
    related: ['edge', 'vig', 'quality-score'],
    tool: { href: '/props', label: 'Shop lines on the props board' },
  },
  {
    slug: 'win-probability',
    title: 'Win Probability',
    definition:
      'The market-implied chance the bet wins, derived from stripping the vig from the consensus line. This is what the collective market thinks, not a proprietary model.',
    example: null,
    body: [
      "Win probability here is the market's number, not a secret model. We take the consensus line, strip the vig, and show the implied chance that side wins. It is what the collective books are pricing — averaged and de-vigged.",
      "It will not match any one book's posted implied probability, because those still include juice. It is also not our \"true\" projection of whether the player goes over. If you want a proprietary forecast, this is not that page.",
      'Read it as market context next to edge: win probability is the consensus chance; edge is how far one book sits from that consensus.',
    ],
    related: ['implied-probability', 'vig', 'edge'],
    tool: { href: '/validation', label: 'See the public record' },
  },
]

export function getAllTerms() {
  return GLOSSARY_TERMS
}

export function getTerm(slug) {
  return GLOSSARY_TERMS.find((term) => term.slug === slug) || null
}

export function getSiblingTerms(slug) {
  return GLOSSARY_TERMS.filter((term) => term.slug !== slug)
}

export function glossaryPath(slug) {
  return `/glossary/${slug}`
}

export function glossaryCanonical(slug) {
  return slug ? `${SITE_URL}/glossary/${slug}` : `${SITE_URL}/glossary`
}