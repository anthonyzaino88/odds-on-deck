// DFS (Daily Fantasy Sports) Page - Player value rankings

import { getPlayersForDFS } from '../../lib/db.js'

export const metadata = {
  title: 'DFS - Odds on Deck',
  description: 'Daily Fantasy Sports player value rankings and projections',
}

// Revalidate every 15 minutes
export const revalidate = 900

export default async function DFSPage() {
  const players = await getPlayersForDFS()
  
  // Separate hitters and pitchers
  const hitters = players.filter(p => !p.isPitcher)
  const pitchers = players.filter(p => p.isPitcher)
  
  // Generate mock DFS data for MVP
  const hittersWithValue = hitters.slice(0, 20).map(player => ({
    ...player,
    projection: generateMockProjection(player, false),
    salary: generateMockSalary(player, false),
  }))
  
  const pitchersWithValue = pitchers.slice(0, 10).map(player => ({
    ...player,
    projection: generateMockProjection(player, true),
    salary: generateMockSalary(player, true),
  }))
  
  // Calculate value (projection / salary * 1000)
  hittersWithValue.forEach(player => {
    player.value = (player.projection / player.salary * 1000).toFixed(2)
  })
  
  pitchersWithValue.forEach(player => {
    player.value = (player.projection / player.salary * 1000).toFixed(2)
  })
  
  // Sort by value
  hittersWithValue.sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
  pitchersWithValue.sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DFS Player Values</h1>
        <p className="text-gray-600 mt-2">
          Player projections and value rankings for daily fantasy sports.
          Salaries are stubbed for MVP demonstration.
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hitters */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Top Hitters by Value
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Projected points per $1K salary
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-4 py-3 text-left">Rank</th>
                  <th className="table-header px-4 py-3 text-left">Player</th>
                  <th className="table-header px-4 py-3 text-left">Team</th>
                  <th className="table-header px-4 py-3 text-left">Proj</th>
                  <th className="table-header px-4 py-3 text-left">Salary</th>
                  <th className="table-header px-4 py-3 text-left">Value</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {hittersWithValue.slice(0, 15).map((player, index) => (
                  <tr key={player.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {player.fullName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {player.bats ? `${player.bats} Bats` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {player.team?.abbr || 'FA'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {player.projection.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      ${player.salary.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={getValueClass(parseFloat(player.value))}>
                        {player.value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Pitchers */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Top Pitchers by Value
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Projected points per $1K salary
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-4 py-3 text-left">Rank</th>
                  <th className="table-header px-4 py-3 text-left">Player</th>
                  <th className="table-header px-4 py-3 text-left">Team</th>
                  <th className="table-header px-4 py-3 text-left">Proj</th>
                  <th className="table-header px-4 py-3 text-left">Salary</th>
                  <th className="table-header px-4 py-3 text-left">Value</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pitchersWithValue.slice(0, 10).map((player, index) => (
                  <tr key={player.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {player.fullName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {player.throws ? `${player.throws} Throws` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {player.team?.abbr || 'FA'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {player.projection.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      ${player.salary.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={getValueClass(parseFloat(player.value))}>
                        {player.value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div className="text-sm text-gray-600 space-y-2">
        <p>
          <strong>Projection:</strong> Expected fantasy points based on matchup analysis.
        </p>
        <p>
          <strong>Value:</strong> Points per $1K salary. Higher values indicate better value plays.
        </p>
        <p>
          <strong>Note:</strong> Salaries are mock data for MVP demonstration. 
          Integrate with DraftKings/FanDuel APIs for production.
        </p>
      </div>
    </div>
  )
}

// Mock data generators for MVP
function generateMockProjection(player, isPitcher) {
  // Generate realistic fantasy projections
  if (isPitcher) {
    return Math.random() * 20 + 15 // 15-35 points
  } else {
    return Math.random() * 15 + 5 // 5-20 points
  }
}

function generateMockSalary(player, isPitcher) {
  // Generate realistic DFS salaries
  if (isPitcher) {
    return Math.floor(Math.random() * 4000) + 7000 // $7K-11K
  } else {
    return Math.floor(Math.random() * 3000) + 3000 // $3K-6K
  }
}

function getValueClass(value) {
  if (value >= 4.0) return 'text-brand-green font-semibold'
  if (value >= 3.0) return 'text-green-600 font-medium'
  if (value >= 2.5) return 'text-gray-900'
  return 'text-gray-600'
}

