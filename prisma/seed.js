// Prisma seed file to populate initial data

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const teams = [
  { id: '108', name: 'Los Angeles Angels', abbr: 'LAA', parkFactor: 0.97 },
  { id: '109', name: 'Arizona Diamondbacks', abbr: 'ARI', parkFactor: 1.02 },
  { id: '110', name: 'Baltimore Orioles', abbr: 'BAL', parkFactor: 1.04 },
  { id: '111', name: 'Boston Red Sox', abbr: 'BOS', parkFactor: 1.08 },
  { id: '112', name: 'Chicago Cubs', abbr: 'CHC', parkFactor: 1.01 },
  { id: '113', name: 'Cincinnati Reds', abbr: 'CIN', parkFactor: 1.05 },
  { id: '114', name: 'Cleveland Guardians', abbr: 'CLE', parkFactor: 0.99 },
  { id: '115', name: 'Colorado Rockies', abbr: 'COL', parkFactor: 1.15 },
  { id: '116', name: 'Detroit Tigers', abbr: 'DET', parkFactor: 0.98 },
  { id: '117', name: 'Houston Astros', abbr: 'HOU', parkFactor: 0.98 },
  { id: '118', name: 'Kansas City Royals', abbr: 'KC', parkFactor: 1.01 },
  { id: '119', name: 'Los Angeles Dodgers', abbr: 'LAD', parkFactor: 0.99 },
  { id: '120', name: 'Washington Nationals', abbr: 'WSH', parkFactor: 1.02 },
  { id: '121', name: 'New York Mets', abbr: 'NYM', parkFactor: 0.98 },
  { id: '133', name: 'Oakland Athletics', abbr: 'OAK', parkFactor: 0.93 },
  { id: '134', name: 'Pittsburgh Pirates', abbr: 'PIT', parkFactor: 0.99 },
  { id: '135', name: 'San Diego Padres', abbr: 'SD', parkFactor: 0.95 },
  { id: '136', name: 'Seattle Mariners', abbr: 'SEA', parkFactor: 0.94 },
  { id: '137', name: 'San Francisco Giants', abbr: 'SF', parkFactor: 0.97 },
  { id: '138', name: 'St. Louis Cardinals', abbr: 'STL', parkFactor: 1.01 },
  { id: '139', name: 'Tampa Bay Rays', abbr: 'TB', parkFactor: 0.96 },
  { id: '140', name: 'Texas Rangers', abbr: 'TEX', parkFactor: 1.06 },
  { id: '141', name: 'Toronto Blue Jays', abbr: 'TOR', parkFactor: 1.02 },
  { id: '142', name: 'Minnesota Twins', abbr: 'MIN', parkFactor: 1.02 },
  { id: '143', name: 'Philadelphia Phillies', abbr: 'PHI', parkFactor: 1.03 },
  { id: '144', name: 'Atlanta Braves', abbr: 'ATL', parkFactor: 1.01 },
  { id: '145', name: 'Chicago White Sox', abbr: 'CWS', parkFactor: 1.01 },
  { id: '146', name: 'Miami Marlins', abbr: 'MIA', parkFactor: 0.92 },
  { id: '147', name: 'New York Yankees', abbr: 'NYY', parkFactor: 1.03 },
  { id: '158', name: 'Milwaukee Brewers', abbr: 'MIL', parkFactor: 0.99 },
]

const samplePlayers = [
  // Cubs (CHC - Team ID 112)
  {
    id: '663656',
    fullName: 'Ian Happ',
    bats: 'S',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '676664',
    fullName: 'Christopher Morel',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '608369',
    fullName: 'Cody Bellinger',
    bats: 'L',
    throws: 'L',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '642086',
    fullName: 'Seiya Suzuki',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '592518',
    fullName: 'Nico Hoerner',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '663993',
    fullName: 'Pete Crow-Armstrong',
    bats: 'L',
    throws: 'L',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '668804',
    fullName: 'Miguel Amaya',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '656941',
    fullName: 'Dansby Swanson',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: false,
  },
  {
    id: '680777',
    fullName: 'Jameson Taillon',
    bats: 'R',
    throws: 'R',
    teamId: '112',
    isPitcher: true,
  },
  // Cardinals (STL - Team ID 138)  
  {
    id: '622761',
    fullName: 'Paul Goldschmidt',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '571448',
    fullName: 'Nolan Arenado',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '664126',
    fullName: 'Jordan Walker',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '663611',
    fullName: 'Nolan Gorman',
    bats: 'L',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '665742',
    fullName: 'Masyn Winn',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '656849',
    fullName: 'Lars Nootbaar',
    bats: 'L',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '607208',
    fullName: 'Willson Contreras',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '641487',
    fullName: 'Brendan Donovan',
    bats: 'L',
    throws: 'R',
    teamId: '138',
    isPitcher: false,
  },
  {
    id: '595978',
    fullName: 'Michael McGreevy',
    bats: 'R',
    throws: 'R',
    teamId: '138',
    isPitcher: true,
  },
  // Dodgers (LAD - Team ID 119)
  {
    id: '592450',
    fullName: 'Mookie Betts',
    bats: 'R',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '596059',
    fullName: 'Freddie Freeman',
    bats: 'L',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '518692',
    fullName: 'Max Muncy',
    bats: 'L',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '660670',
    fullName: 'Will Smith',
    bats: 'R',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '665487',
    fullName: 'Tommy Edman',
    bats: 'S',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '608700',
    fullName: 'Teoscar Hernandez',
    bats: 'R',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '686823',
    fullName: 'Andy Pages',
    bats: 'R',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '621020',
    fullName: 'Gavin Lux',
    bats: 'L',
    throws: 'R',
    teamId: '119',
    isPitcher: false,
  },
  {
    id: '686613',
    fullName: 'Yoshinobu Yamamoto',
    bats: 'R',
    throws: 'R',
    teamId: '119',
    isPitcher: true,
  },
  // Yankees (NYY - Team ID 147)
  {
    id: '592450',
    fullName: 'Aaron Judge',
    bats: 'R',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '596019',
    fullName: 'Juan Soto',
    bats: 'L',
    throws: 'L',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '622491',
    fullName: 'Gleyber Torres',
    bats: 'R',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '608324',
    fullName: 'Anthony Rizzo',
    bats: 'L',
    throws: 'L',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '596748',
    fullName: 'Giancarlo Stanton',
    bats: 'R',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '642771',
    fullName: 'Jazz Chisholm Jr.',
    bats: 'L',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '665871',
    fullName: 'Austin Wells',
    bats: 'L',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '665750',
    fullName: 'Anthony Volpe',
    bats: 'R',
    throws: 'R',
    teamId: '147',
    isPitcher: false,
  },
  {
    id: '671096',
    fullName: 'Gerrit Cole',
    bats: 'R',
    throws: 'R',
    teamId: '147',
    isPitcher: true,
  },
  // Orioles (BAL - Team ID 110)
  {
    id: '666158',
    fullName: 'Adley Rutschman',
    bats: 'S',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '663728',
    fullName: 'Gunnar Henderson',
    bats: 'L',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '668805',
    fullName: 'Anthony Santander',
    bats: 'S',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '641343',
    fullName: 'Ryan Mountcastle',
    bats: 'R',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '663994',
    fullName: 'Cedric Mullins',
    bats: 'L',
    throws: 'L',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '592519',
    fullName: 'Adam Frazier',
    bats: 'L',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '663657',
    fullName: 'Colton Cowser',
    bats: 'L',
    throws: 'L',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '676665',
    fullName: 'Jordan Westburg',
    bats: 'R',
    throws: 'R',
    teamId: '110',
    isPitcher: false,
  },
  {
    id: '680778',
    fullName: 'Corbin Burnes',
    bats: 'R',
    throws: 'R',
    teamId: '110',
    isPitcher: true,
  },
  // Mets (NYM - Team ID 121)
  {
    id: '596020',
    fullName: 'Francisco Lindor',
    bats: 'S',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '592451',
    fullName: 'Pete Alonso',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '622492',
    fullName: 'Jesse Winker',
    bats: 'L',
    throws: 'L',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '608325',
    fullName: 'Starling Marte',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '596749',
    fullName: 'Brandon Nimmo',
    bats: 'L',
    throws: 'L',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '642772',
    fullName: 'Mark Vientos',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '665872',
    fullName: 'Francisco Alvarez',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '665751',
    fullName: 'Jose Iglesias',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: false,
  },
  {
    id: '671097',
    fullName: 'Luis Severino',
    bats: 'R',
    throws: 'R',
    teamId: '121',
    isPitcher: true,
  },
  // Marlins (MIA - Team ID 146)
  {
    id: '666159',
    fullName: 'Jake Burger',
    bats: 'R',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '663729',
    fullName: 'Jazz Chisholm Jr.',
    bats: 'L',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '668806',
    fullName: 'Jesus Sanchez',
    bats: 'L',
    throws: 'L',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '641344',
    fullName: 'Nick Fortes',
    bats: 'R',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '663995',
    fullName: 'Xavier Edwards',
    bats: 'S',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '592520',
    fullName: 'Connor Norby',
    bats: 'R',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '663658',
    fullName: 'Jonah Bride',
    bats: 'R',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '676666',
    fullName: 'Otto Lopez',
    bats: 'S',
    throws: 'R',
    teamId: '146',
    isPitcher: false,
  },
  {
    id: '680779',
    fullName: 'Sandy Alcantara',
    bats: 'R',
    throws: 'R',
    teamId: '146',
    isPitcher: true,
  }
]

async function main() {
  console.log('Seeding database...')

  // Seed teams
  console.log('Seeding teams...')
  for (const team of teams) {
    await prisma.team.upsert({
      where: { id: team.id },
      update: team,
      create: team,
    })
  }
  console.log(`Seeded ${teams.length} teams`)

  // Seed sample players
  console.log('Seeding sample players...')
  for (const player of samplePlayers) {
    await prisma.player.upsert({
      where: { id: player.id },
      update: player,
      create: player,
    })
  }
  console.log(`Seeded ${samplePlayers.length} sample players`)

  // Create sample split stats with more realistic data
  console.log('Creating sample split stats...')
  const currentYear = new Date().getFullYear()
  
  // Player-specific stats for more realistic matchups
  const playerStats = {
    // Cubs players
    '663656': { vsR: { wOBA: 0.340, ISO: 0.205 }, vsL: { wOBA: 0.365, ISO: 0.225 } }, // Ian Happ
    '676664': { vsR: { wOBA: 0.315, ISO: 0.195 }, vsL: { wOBA: 0.295, ISO: 0.175 } }, // Christopher Morel
    '608369': { vsR: { wOBA: 0.355, ISO: 0.240 }, vsL: { wOBA: 0.320, ISO: 0.185 } }, // Cody Bellinger
    '642086': { vsR: { wOBA: 0.345, ISO: 0.185 }, vsL: { wOBA: 0.340, ISO: 0.180 } }, // Seiya Suzuki
    '592518': { vsR: { wOBA: 0.325, ISO: 0.145 }, vsL: { wOBA: 0.315, ISO: 0.135 } }, // Nico Hoerner
    '663993': { vsR: { wOBA: 0.310, ISO: 0.155 }, vsL: { wOBA: 0.295, ISO: 0.140 } }, // Pete Crow-Armstrong
    '668804': { vsR: { wOBA: 0.305, ISO: 0.165 }, vsL: { wOBA: 0.290, ISO: 0.150 } }, // Miguel Amaya
    '656941': { vsR: { wOBA: 0.330, ISO: 0.175 }, vsL: { wOBA: 0.320, ISO: 0.165 } }, // Dansby Swanson
    
    // Cardinals players
    '622761': { vsR: { wOBA: 0.340, ISO: 0.195 }, vsL: { wOBA: 0.365, ISO: 0.220 } }, // Paul Goldschmidt
    '571448': { vsR: { wOBA: 0.335, ISO: 0.205 }, vsL: { wOBA: 0.340, ISO: 0.210 } }, // Nolan Arenado
    '664126': { vsR: { wOBA: 0.320, ISO: 0.185 }, vsL: { wOBA: 0.310, ISO: 0.175 } }, // Jordan Walker
    '663611': { vsR: { wOBA: 0.325, ISO: 0.215 }, vsL: { wOBA: 0.350, ISO: 0.245 } }, // Nolan Gorman
    '665742': { vsR: { wOBA: 0.315, ISO: 0.155 }, vsL: { wOBA: 0.305, ISO: 0.145 } }, // Masyn Winn
    '656849': { vsR: { wOBA: 0.335, ISO: 0.175 }, vsL: { wOBA: 0.360, ISO: 0.195 } }, // Lars Nootbaar
    '607208': { vsR: { wOBA: 0.345, ISO: 0.225 }, vsL: { wOBA: 0.340, ISO: 0.220 } }, // Willson Contreras
    '641487': { vsR: { wOBA: 0.325, ISO: 0.135 }, vsL: { wOBA: 0.350, ISO: 0.155 } }, // Brendan Donovan
    
    // Dodgers players
    '592450': { vsR: { wOBA: 0.370, ISO: 0.250 }, vsL: { wOBA: 0.365, ISO: 0.245 } }, // Mookie Betts
    '596059': { vsR: { wOBA: 0.355, ISO: 0.210 }, vsL: { wOBA: 0.320, ISO: 0.180 } }, // Freddie Freeman
    '518692': { vsR: { wOBA: 0.345, ISO: 0.235 }, vsL: { wOBA: 0.385, ISO: 0.285 } }, // Max Muncy
    '660670': { vsR: { wOBA: 0.350, ISO: 0.220 }, vsL: { wOBA: 0.345, ISO: 0.215 } }, // Will Smith
    '665487': { vsR: { wOBA: 0.335, ISO: 0.165 }, vsL: { wOBA: 0.340, ISO: 0.170 } }, // Tommy Edman
    '608700': { vsR: { wOBA: 0.340, ISO: 0.235 }, vsL: { wOBA: 0.325, ISO: 0.215 } }, // Teoscar Hernandez
    '686823': { vsR: { wOBA: 0.315, ISO: 0.175 }, vsL: { wOBA: 0.305, ISO: 0.165 } }, // Andy Pages
    '621020': { vsR: { wOBA: 0.320, ISO: 0.155 }, vsL: { wOBA: 0.335, ISO: 0.175 } }, // Gavin Lux
    
    // Yankees players
    '592450': { vsR: { wOBA: 0.390, ISO: 0.315 }, vsL: { wOBA: 0.395, ISO: 0.325 } }, // Aaron Judge
    '596019': { vsR: { wOBA: 0.375, ISO: 0.265 }, vsL: { wOBA: 0.405, ISO: 0.295 } }, // Juan Soto
    '622491': { vsR: { wOBA: 0.325, ISO: 0.185 }, vsL: { wOBA: 0.340, ISO: 0.200 } }, // Gleyber Torres
    '608324': { vsR: { wOBA: 0.315, ISO: 0.175 }, vsL: { wOBA: 0.335, ISO: 0.195 } }, // Anthony Rizzo
    '596748': { vsR: { wOBA: 0.330, ISO: 0.275 }, vsL: { wOBA: 0.320, ISO: 0.265 } }, // Giancarlo Stanton
    '642771': { vsR: { wOBA: 0.340, ISO: 0.225 }, vsL: { wOBA: 0.365, ISO: 0.245 } }, // Jazz Chisholm Jr.
    '665871': { vsR: { wOBA: 0.320, ISO: 0.185 }, vsL: { wOBA: 0.335, ISO: 0.200 } }, // Austin Wells
    '665750': { vsR: { wOBA: 0.315, ISO: 0.155 }, vsL: { wOBA: 0.305, ISO: 0.145 } }, // Anthony Volpe
    
    // Orioles players
    '666158': { vsR: { wOBA: 0.360, ISO: 0.195 }, vsL: { wOBA: 0.365, ISO: 0.200 } }, // Adley Rutschman
    '663728': { vsR: { wOBA: 0.345, ISO: 0.235 }, vsL: { wOBA: 0.370, ISO: 0.255 } }, // Gunnar Henderson
    '668805': { vsR: { wOBA: 0.335, ISO: 0.255 }, vsL: { wOBA: 0.340, ISO: 0.260 } }, // Anthony Santander
    '641343': { vsR: { wOBA: 0.325, ISO: 0.215 }, vsL: { wOBA: 0.315, ISO: 0.205 } }, // Ryan Mountcastle
    '663994': { vsR: { wOBA: 0.315, ISO: 0.155 }, vsL: { wOBA: 0.330, ISO: 0.170 } }, // Cedric Mullins
    '592519': { vsR: { wOBA: 0.310, ISO: 0.125 }, vsL: { wOBA: 0.325, ISO: 0.140 } }, // Adam Frazier
    '663657': { vsR: { wOBA: 0.325, ISO: 0.175 }, vsL: { wOBA: 0.340, ISO: 0.190 } }, // Colton Cowser
    '676665': { vsR: { wOBA: 0.330, ISO: 0.185 }, vsL: { wOBA: 0.320, ISO: 0.175 } }, // Jordan Westburg
    
    // Mets players
    '596020': { vsR: { wOBA: 0.335, ISO: 0.195 }, vsL: { wOBA: 0.340, ISO: 0.200 } }, // Francisco Lindor
    '592451': { vsR: { wOBA: 0.350, ISO: 0.255 }, vsL: { wOBA: 0.345, ISO: 0.250 } }, // Pete Alonso
    '622492': { vsR: { wOBA: 0.340, ISO: 0.185 }, vsL: { wOBA: 0.365, ISO: 0.210 } }, // Jesse Winker
    '608325': { vsR: { wOBA: 0.320, ISO: 0.165 }, vsL: { wOBA: 0.315, ISO: 0.160 } }, // Starling Marte
    '596749': { vsR: { wOBA: 0.330, ISO: 0.155 }, vsL: { wOBA: 0.355, ISO: 0.175 } }, // Brandon Nimmo
    '642772': { vsR: { wOBA: 0.340, ISO: 0.235 }, vsL: { wOBA: 0.325, ISO: 0.220 } }, // Mark Vientos
    '665872': { vsR: { wOBA: 0.325, ISO: 0.195 }, vsL: { wOBA: 0.320, ISO: 0.190 } }, // Francisco Alvarez
    '665751': { vsR: { wOBA: 0.315, ISO: 0.135 }, vsL: { wOBA: 0.310, ISO: 0.130 } }, // Jose Iglesias
    
    // Marlins players
    '666159': { vsR: { wOBA: 0.325, ISO: 0.215 }, vsL: { wOBA: 0.320, ISO: 0.210 } }, // Jake Burger
    '663729': { vsR: { wOBA: 0.340, ISO: 0.225 }, vsL: { wOBA: 0.365, ISO: 0.245 } }, // Jazz Chisholm Jr.
    '668806': { vsR: { wOBA: 0.315, ISO: 0.185 }, vsL: { wOBA: 0.330, ISO: 0.200 } }, // Jesus Sanchez
    '641344': { vsR: { wOBA: 0.300, ISO: 0.155 }, vsL: { wOBA: 0.295, ISO: 0.150 } }, // Nick Fortes
    '663995': { vsR: { wOBA: 0.320, ISO: 0.125 }, vsL: { wOBA: 0.325, ISO: 0.130 } }, // Xavier Edwards
    '592520': { vsR: { wOBA: 0.310, ISO: 0.165 }, vsL: { wOBA: 0.305, ISO: 0.160 } }, // Connor Norby
    '663658': { vsR: { wOBA: 0.305, ISO: 0.145 }, vsL: { wOBA: 0.300, ISO: 0.140 } }, // Jonah Bride
    '676666': { vsR: { wOBA: 0.315, ISO: 0.135 }, vsL: { wOBA: 0.320, ISO: 0.140 } }, // Otto Lopez
  }
  
  for (const player of samplePlayers) {
    if (!player.isPitcher) {
      // Use specific stats for known players, random for others
      const stats = playerStats[player.id] || {
        vsR: { wOBA: 0.320 + Math.random() * 0.080, ISO: 0.150 + Math.random() * 0.100 },
        vsL: { wOBA: 0.300 + Math.random() * 0.100, ISO: 0.140 + Math.random() * 0.120 }
      }
      
      // Hitter splits vs R and L
      await prisma.splitStat.create({
        data: {
          playerId: player.id,
          season: currentYear,
          vsHand: 'R',
          wOBA: stats.vsR.wOBA,
          ISO: stats.vsR.ISO,
          kRate: 0.180 + Math.random() * 0.100, // 0.180-0.280
          bbRate: 0.080 + Math.random() * 0.040, // 0.080-0.120
          xwOBA: stats.vsR.wOBA - 0.010 + Math.random() * 0.020, // Near actual wOBA
          samplePA: Math.floor(Math.random() * 200) + 250, // 250-450 PA
          scope: 'season',
        },
      })

      await prisma.splitStat.create({
        data: {
          playerId: player.id,
          season: currentYear,
          vsHand: 'L',
          wOBA: stats.vsL.wOBA,
          ISO: stats.vsL.ISO,
          kRate: 0.170 + Math.random() * 0.110, // 0.170-0.280
          bbRate: 0.070 + Math.random() * 0.050, // 0.070-0.120
          xwOBA: stats.vsL.wOBA - 0.010 + Math.random() * 0.020, // Near actual wOBA
          samplePA: Math.floor(Math.random() * 100) + 80, // 80-180 PA
          scope: 'season',
        },
      })
    } else {
      // Pitcher splits vs R and L hitters
      await prisma.splitStat.create({
        data: {
          playerId: player.id,
          season: currentYear,
          vsHand: 'R',
          wOBA: 0.280 + Math.random() * 0.060, // 0.280-0.340
          ISO: 0.120 + Math.random() * 0.080, // 0.120-0.200
          kRate: 0.220 + Math.random() * 0.100, // 0.220-0.320
          bbRate: 0.060 + Math.random() * 0.040, // 0.060-0.100
          xwOBA: 0.290 + Math.random() * 0.050, // 0.290-0.340
          samplePA: Math.floor(Math.random() * 150) + 100, // 100-250 PA faced
          scope: 'season',
        },
      })

      await prisma.splitStat.create({
        data: {
          playerId: player.id,
          season: currentYear,
          vsHand: 'L',
          wOBA: 0.290 + Math.random() * 0.070, // 0.290-0.360
          ISO: 0.130 + Math.random() * 0.090, // 0.130-0.220
          kRate: 0.200 + Math.random() * 0.120, // 0.200-0.320
          bbRate: 0.070 + Math.random() * 0.050, // 0.070-0.120
          xwOBA: 0.300 + Math.random() * 0.060, // 0.300-0.360
          samplePA: Math.floor(Math.random() * 100) + 80, // 80-180 PA faced
          scope: 'season',
        },
      })

      // Add pitch mix for pitchers
      const pitchTypes = ['FF', 'SL', 'CH', 'CU', 'SI']
      for (const pitch of pitchTypes) {
        await prisma.pitchMix.create({
          data: {
            playerId: player.id,
            season: currentYear,
            pitch,
            usage: Math.random() * 0.4 + 0.1, // 0.1-0.5
            whiff: Math.random() * 0.3 + 0.1, // 0.1-0.4
            xwOBA: Math.random() * 0.2 + 0.25, // 0.25-0.45
            runValue: (Math.random() - 0.5) * 4, // -2 to +2
          },
        })
      }
    }
  }

  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

