// Verify data freshness after refresh

const { PrismaClient } = require('@prisma/client');

async function verifyDataFreshness() {
  const prisma = new PrismaClient();
  
  try {
    const now = new Date();
    const games = await prisma.game.findMany({
      where: { sport: 'mlb' },
      include: { home: true, away: true, lineups: true },
      orderBy: { date: 'asc' }
    });
    
    console.log('📊 UPDATED DATA STATUS:');
    games.forEach(game => {
      const lastUpdate = game.lastUpdate ? new Date(game.lastUpdate) : null;
      const timeSinceUpdate = lastUpdate ? Math.round((now - lastUpdate) / 1000 / 60) : 'Never';
      console.log(`  ${game.away.abbr} @ ${game.home.abbr}`);
      console.log(`    Status: ${game.status}`);
      console.log(`    Lineups: ${game.lineups.length}`);
      console.log(`    Live Data: ${game.homeScore !== null ? 'YES' : 'NO'}`);
      console.log(`    Last Update: ${timeSinceUpdate} minutes ago`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDataFreshness();
