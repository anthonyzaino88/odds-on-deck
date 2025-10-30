// Startup API - Ensures fresh data on application startup
// Called when the application starts to guarantee current data

import { NextResponse } from 'next/server'
import { initializeDataManager } from '../../../lib/data-manager.js'

export async function GET() {
  try {
    console.log('🚀 Application startup detected - initializing fresh data...')
    
    // Initialize data manager with fresh data
    await initializeDataManager()
    
    return NextResponse.json({
      success: true,
      message: 'Application initialized with fresh data',
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Startup initialization error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function POST() {
  return GET()
}

