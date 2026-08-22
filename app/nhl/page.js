import SportHub from '../../components/SportHub'

const SITE_URL = 'https://oddsondeck.com'

export const metadata = {
  title: 'NHL Player Props & Odds Today',
  description: "Today's NHL player props, odds, and matchups. See the live slate with ranked props from the market — informational only, not betting advice.",
  alternates: {
    canonical: `${SITE_URL}/nhl`,
  },
}

export const dynamic = 'force-dynamic'

export default function NHLPage() {
  return <SportHub sport="nhl" />
}
