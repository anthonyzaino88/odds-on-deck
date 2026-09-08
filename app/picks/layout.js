import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/picks',
  },
  title: "Editor's Picks — Published-shaped bets we'd take",
  description: "Editor's picks use the same Published / Pile B bar as the homepage board: MLB + NFL, American −200 to +250, edge > 0, quality ≥ 40, no juice traps. Short or empty is honest.",
  openGraph: {
    title: "Editor's Picks — Published-shaped bets we'd take | Odds on Deck",
    description: "The bets we'd take for best ROI — same Published filters as Today's picks and the validation ROI card. We don't pad with juice favorites.",
    images: [OG_IMAGE],
  },
}

export default function PicksLayout({ children }) {
  return children
}
