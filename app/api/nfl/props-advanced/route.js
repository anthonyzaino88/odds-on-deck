// Advanced NFL Player Props API
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { 
  generateAdvancedNFLPlayerProps,
  getTopNFLPlayerProps 
} from '../../../../lib/nfl-props-advanced.js'

export async function GET() {
  try {
    console.log('🏈 Fetching top NFL player props...')
    
    const topProps = await getTopNFLPlayerProps(15)
    
    return NextResponse.json({
      props: topProps,
      count: topProps.length,
      message: `Found ${topProps.length} NFL player props with edge`
    })
    
  } catch (error) {
    console.error('Error fetching NFL player props:', error)
    return NextResponse.json(
      { error: 'Failed to fetch NFL player props' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    console.log('🏈 Generating advanced NFL player props...')
    
    const props = await generateAdvancedNFLPlayerProps()
    
    return NextResponse.json({
      message: 'NFL player props generated successfully',
      propsGenerated: props.length,
      topProps: props.slice(0, 10) // Return top 10 for preview
    })
    
  } catch (error) {
    console.error('Error generating NFL player props:', error)
    return NextResponse.json(
      { error: 'Failed to generate NFL player props' },
      { status: 500 }
    )
  }
}
