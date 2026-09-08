import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/picks',
  },
  title: "Editor's Picks — Props we'd actually bet",
  description: "A short MLB and NFL list we'd actually bet — prices roughly −200 to +250, a model edge, quality of at least 40. Same standard as Today's picks and the public record. Short or empty is the honest count.",
  openGraph: {
    title: "Editor's Picks — Props we'd actually bet | Odds on Deck",
    description: "Curated player props we'd put money on. Same standard as Today's picks and the public track record — we don't pad the list with bad prices.",
    images: [OG_IMAGE],
  },
}

export default function PicksLayout({ children }) {
  return children
}
