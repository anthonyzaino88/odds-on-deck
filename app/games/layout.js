import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/games',
  },
  title: "Today's Slate — Live Games & Scores",
  description: "Today's MLB, NFL, and NHL games with live scores, real-time odds, and detailed matchup analytics. Track every game on the slate.",
  openGraph: {
    title: "Today's Slate — Live Games & Scores | Odds on Deck",
    description: "Today's games with live scores, real-time odds, and detailed matchup analytics.",
    images: [OG_IMAGE],
  },
}

export default function GamesLayout({ children }) {
  return children
}
