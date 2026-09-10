// Jest setup file for global test configuration

// Mock environment variables for tests
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.ODDS_API_KEY = 'test_key'
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key'

// Mock Prisma Client for tests
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    team: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    player: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    game: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    odds: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    edgeSnapshot: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $disconnect: jest.fn(),
  })),
}))

// Mock fetch for API tests
global.fetch = jest.fn()

