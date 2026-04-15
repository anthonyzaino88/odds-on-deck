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
  ]

  let gamePages = []
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Only include games from the last 7 days — older games have low search value
    // and waste Google's crawl budget
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: games } = await supabase
      .from('Game')
      .select('id, date, status')
      .gte('date', sevenDaysAgo.toISOString())
      .order('date', { ascending: false })

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    gamePages = (games || []).map(game => {
      const gameDate = new Date(game.date)
      const isToday = gameDate.toISOString().split('T')[0] === todayStr
      return {
        url: `${SITE_URL}/game/${game.id}`,
        lastModified: gameDate,
        changeFrequency: isToday ? 'hourly' : 'daily',
        priority: isToday ? 0.7 : 0.5,
      }
    })
  } catch {
    // Supabase unavailable at build time — static pages only
  }

  return [...staticPages, ...gamePages]
}
