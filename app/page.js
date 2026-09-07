import { Suspense } from 'react'
import HomeHero from '../components/HomeHero'
import HomeMarketing from '../components/HomeMarketing'
import HomeFreshness from '../components/HomeFreshness'
import {
  BoardSkeleton,
  HomeBoard,
  HomeMatchups,
  HomeProof,
  MatchupsSkeleton,
  ProofStripSkeleton,
} from './HomeStream'
import { OG_IMAGE, SITE_URL } from '../lib/site-meta'

const HOME_OG_TITLE = 'Sports props with a public track record | Odds on Deck'
const HOME_DESCRIPTION = 'Curated picks, graded from box scores, ROI first — not vanity win rate.'

export const metadata = {
  alternates: {
    canonical: SITE_URL,
  },
  title: 'Sports props with a public track record',
  description: HOME_DESCRIPTION,
  openGraph: {
    title: HOME_OG_TITLE,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    images: [OG_IMAGE],
  },
  twitter: {
    title: HOME_OG_TITLE,
    description: HOME_DESCRIPTION,
    images: [OG_IMAGE],
  },
}

export const dynamic = 'force-dynamic'

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <Suspense fallback={<ProofStripSkeleton />}>
        <HomeProof />
      </Suspense>
      <Suspense fallback={<BoardSkeleton />}>
        <HomeBoard />
      </Suspense>
      <Suspense fallback={<MatchupsSkeleton />}>
        <HomeMatchups />
      </Suspense>
      <HomeFreshness />
      <HomeMarketing />
    </>
  )
}
