import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/props',
  },
  title: 'Player Props — Rankings & Edge Detection',
  description: 'Daily morning player prop rankings for MLB, NFL, and NHL. Compare the best stored number against consensus, with the as-of time shown on the board.',
  openGraph: {
    title: 'Player Props — Rankings & Edge Detection | Odds on Deck',
    description: 'Daily morning player prop rankings. Best stored number vs consensus, with the as-of time on the board.',
    images: [OG_IMAGE],
  },
}

export default function PropsLayout({ children }) {
  return children
}
