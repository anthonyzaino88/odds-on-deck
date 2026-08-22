import SportHub from '../../components/SportHub'

const SITE_URL = 'https://oddsondeck.com'

export const metadata = {
  title: 'MLB Player Props & Odds Today',
  description: "Today's MLB player props, odds, and matchups. See the live slate with ranked props from the market — informational only, not betting advice.",
  alternates: {
    canonical: `${SITE_URL}/mlb`,
  },
}

export const dynamic = 'force-dynamic'

export default function MLBPage() {
  return <SportHub sport="mlb" />
}
