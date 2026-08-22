import { notFound } from 'next/navigation'
import { GlossaryArticle } from '../GlossaryArticle.js'
import { getAllTerms, getTerm, glossaryCanonical } from '../../../lib/glossary.js'

export function generateStaticParams() {
  return getAllTerms().map((term) => ({ slug: term.slug }))
}

export function generateMetadata({ params }) {
  const term = getTerm(params.slug)
  if (!term) {
    return { title: 'Glossary' }
  }
  return {
    title: term.title,
    description: term.definition,
    alternates: {
      canonical: glossaryCanonical(term.slug),
    },
  }
}

export default function GlossaryTermPage({ params }) {
  const term = getTerm(params.slug)
  if (!term) notFound()
  return <GlossaryArticle slug={term.slug} />
}