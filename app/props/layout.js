import { OG_IMAGE } from '../../lib/site-meta'

export const metadata = {
  alternates: {
    canonical: 'https://oddsondeck.com/props',
  },
  title: 'Player Props — Rankings & Edge Detection',
  description: 'Real-time player prop rankings for MLB, NFL, and NHL. Find mispriced lines, compare odds across sportsbooks, and spot edges with data-driven analysis.',
  openGraph: {
    title: 'Player Props — Rankings & Edge Detection | Odds on Deck',
    description: 'Real-time player prop rankings. Find mispriced lines and spot edges with data-driven analysis.',
    images: [OG_IMAGE],
  },
}

export default function PropsLayout({ children }) {
  return children
}
