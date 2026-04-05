const SITE_URL = 'https://oddsondeck.com'

export default async function sitemap() {
  const staticPages = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/games`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/picks`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/props`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/parlays`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/dfs`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/validation`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/insights`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/training`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ]

  let gamePages = []
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const { data: games } = await supabase
      .from('Game')
      .select('id, date')
      .order('date', { ascending: false })
      .limit(200)

    gamePages = (games || []).map(game => ({
      url: `${SITE_URL}/game/${game.id}`,
      lastModified: new Date(game.date),
      changeFrequency: 'daily',
      priority: 0.6,
    }))
  } catch {
    // Supabase unavailable at build time — static pages only
  }

  return [...staticPages, ...gamePages]
}
