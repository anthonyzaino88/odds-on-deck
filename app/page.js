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

const SITE_URL = 'https://oddsondeck.com'

export const metadata = {
  alternates: {
    canonical: SITE_URL,
  },
  title: 'Sports props with a public track record',
  description: 'Curated picks, graded from box scores, ROI first — not vanity win rate.',
  openGraph: {
    title: 'Sports props with a public track record | Odds on Deck',
    description: 'Curated picks, graded from box scores, ROI first — not vanity win rate.',
    url: SITE_URL,
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
