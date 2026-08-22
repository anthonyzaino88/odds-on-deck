import { GlossaryIndex } from './GlossaryArticle.js'
import { glossaryCanonical } from '../../lib/glossary.js'

export const metadata = {
  title: 'Glossary',
  description:
    'Plain-language definitions of edge, implied probability, vig, quality score, line shopping, and win probability — the terms used on Odds on Deck.',
  alternates: {
    canonical: glossaryCanonical(),
  },
}

export default function GlossaryPage() {
  return <GlossaryIndex />
}