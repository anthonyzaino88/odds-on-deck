// NFL Games API - Get this week's NFL games
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getThisWeeksNFLGames } from '../../../../lib/nfl-db.js'

export async function GET() {
  try {
    const games = await getThisWeeksNFLGames()
    return NextResponse.json(games)
  } catch (error) {
    console.error('Error fetching NFL games:', error)
    return NextResponse.json(
      { error: 'Failed to fetch NFL games' },
      { status: 500 }
    )
  }
}
