import SportHub from '../../components/SportHub'

const SITE_URL = 'https://oddsondeck.com'

export const metadata = {
  title: 'NFL Player Props & Odds This Week',
  description: "This week's NFL player props, odds, and matchups. See the Thursday–Monday slate with ranked props from the market — informational only, not betting advice.",
  alternates: {
    canonical: `${SITE_URL}/nfl`,
  },
}

export const dynamic = 'force-dynamic'

export default function NFLPage() {
  return <SportHub sport="nfl" />
}
