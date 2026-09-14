/** ESPN NFL summary / scoreboard fixtures for archive tests. Not live data. */

export const COMPLETED_EVENT_ID = '401547353'

export function completedNflSummaryFixture() {
  return {
    header: {
      id: COMPLETED_EVENT_ID,
      season: { year: 2025, type: 2 },
      week: { number: 1 },
      competitions: [
        {
          date: '2025-09-05T00:20:00.000Z',
          status: {
            type: {
              completed: true,
              state: 'post',
              name: 'STATUS_FINAL',
              description: 'Final',
            },
          },
          competitors: [
            {
              id: '12',
              homeAway: 'home',
              score: '24',
              team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs' },
            },
            {
              id: '9',
              homeAway: 'away',
              score: '21',
              team: { id: '9', abbreviation: 'PHI', displayName: 'Philadelphia Eagles' },
            },
          ],
        },
      ],
    },
    boxscore: {
      players: [
        {
          team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs' },
          statistics: [
            {
              name: 'passing',
              keys: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'],
              athletes: [
                {
                  athlete: { id: '3139477', displayName: 'Patrick Mahomes' },
                  stats: ['21/32', '258', '8.1', '2', '0'],
                },
                {
                  athlete: { id: '999001', displayName: 'Missing Yards QB' },
                  stats: ['1/2', '', '0.0', '0', '0'],
                },
              ],
            },
            {
              name: 'rushing',
              keys: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'],
              athletes: [
                {
                  athlete: { id: '3117251', displayName: 'Isiah Pacheco' },
                  stats: ['10', '0', '0.0', '0', '0'],
                },
              ],
            },
            {
              name: 'receiving',
              keys: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'],
              athletes: [
                {
                  athlete: { displayName: 'Unidentified Receiver' },
                  stats: ['3', '41', '13.7', '0', '18', '5'],
                },
              ],
            },
          ],
        },
        {
          team: { id: '9', abbreviation: 'PHI', displayName: 'Philadelphia Eagles' },
          statistics: [
            {
              name: 'passing',
              keys: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'],
              athletes: [
                {
                  athlete: { id: '3139478', displayName: 'Jalen Hurts' },
                  stats: ['20/28', '245', '8.8', '1', '1'],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

export function inProgressNflSummaryFixture() {
  const data = completedNflSummaryFixture()
  data.header.id = '401547399'
  data.header.competitions[0].date = '2025-09-07T17:00:00.000Z'
  data.header.competitions[0].status.type = {
    completed: false,
    state: 'in',
    name: 'STATUS_IN_PROGRESS',
    description: 'Q2 8:12',
  }
  return data
}

export function correctedNflSummaryFixture() {
  const data = completedNflSummaryFixture()
  data.boxscore.players[0].statistics[0].athletes[0].stats[1] = '271'
  return data
}

export function nflScoreboardFixture() {
  return {
    season: { year: 2025, type: 2 },
    week: { number: 1 },
    events: [
      {
        id: COMPLETED_EVENT_ID,
        date: '2025-09-05T00:20:00.000Z',
        name: 'Philadelphia Eagles at Kansas City Chiefs',
        season: { year: 2025, type: 2 },
        week: { number: 1 },
        status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
        competitions: [
          {
            date: '2025-09-05T00:20:00.000Z',
            status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
            competitors: [
              { homeAway: 'home', team: { id: '12', abbreviation: 'KC' } },
              { homeAway: 'away', team: { id: '9', abbreviation: 'PHI' } },
            ],
          },
        ],
      },
      {
        id: '401547399',
        date: '2025-09-07T17:00:00.000Z',
        name: 'In Progress Game',
        season: { year: 2025, type: 2 },
        week: { number: 1 },
        status: { type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' } },
        competitions: [
          {
            date: '2025-09-07T17:00:00.000Z',
            status: { type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' } },
            competitors: [
              { homeAway: 'home', team: { id: '1', abbreviation: 'ATL' } },
              { homeAway: 'away', team: { id: '2', abbreviation: 'TB' } },
            ],
          },
        ],
      },
      {
        id: '401547000',
        date: '2020-01-01T18:00:00.000Z',
        name: 'Old scheduled game (elapsed, not final)',
        season: { year: 2025, type: 2 },
        week: { number: 1 },
        status: { type: { completed: false, state: 'pre', name: 'STATUS_SCHEDULED' } },
        competitions: [
          {
            date: '2020-01-01T18:00:00.000Z',
            status: { type: { completed: false, state: 'pre', name: 'STATUS_SCHEDULED' } },
            competitors: [
              { homeAway: 'home', team: { id: '3', abbreviation: 'CHI' } },
              { homeAway: 'away', team: { id: '4', abbreviation: 'GB' } },
            ],
          },
        ],
      },
    ],
  }
}
