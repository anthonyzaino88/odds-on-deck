import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/picks',
  },
  title: "Editor's Picks — Today's Best Bets",
  description: "Curated daily betting picks with edge analysis. See today's highest-confidence plays across MLB, NFL, and NHL with transparent win rates.",
  openGraph: {
    title: "Editor's Picks — Today's Best Bets | Odds on Deck",
    description: "Curated daily betting picks with edge analysis. See today's highest-confidence plays across MLB, NFL, and NHL.",
    images: [OG_IMAGE],
  },
}

export default function PicksLayout({ children }) {
  return children
}
