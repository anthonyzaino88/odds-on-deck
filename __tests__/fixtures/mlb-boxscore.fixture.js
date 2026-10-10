/** Minimal StatsAPI boxscore: DNP empty lines vs a real 0 vs a pitcher appearance. */

export function mlbBoxscoreFixture() {
  return {
    teams: {
      home: {
        team: { name: 'Houston Astros' },
        players: {
          ID_WALKER: {
            person: { fullName: 'Christian Walker' },
            gameStatus: { isOnBench: true },
            stats: { batting: {}, pitching: {} },
          },
          ID_ALVAREZ: {
            person: { fullName: 'Yordan Alvarez' },
            gameStatus: { isOnBench: false },
            stats: {
              batting: {
                hits: 2,
                doubles: 0,
                triples: 0,
                homeRuns: 1,
                runs: 1,
                rbi: 1,
                strikeOuts: 0,
                baseOnBalls: 0,
                stolenBases: 0,
                atBats: 4,
                plateAppearances: 4,
                totalBases: 5,
              },
              pitching: {},
            },
          },
          ID_SMITH: {
            person: { fullName: 'Cam Smith' },
            gameStatus: { isOnBench: false },
            stats: {
              batting: {
                hits: 0,
                doubles: 0,
                triples: 0,
                homeRuns: 0,
                runs: 0,
                rbi: 0,
                strikeOuts: 2,
                baseOnBalls: 1,
                stolenBases: 0,
                atBats: 3,
                plateAppearances: 4,
                totalBases: 0,
              },
              pitching: {},
            },
          },
          ID_HADER: {
            person: { fullName: 'Josh Hader' },
            gameStatus: { isOnBench: false },
            stats: {
              batting: {},
              pitching: {
                strikeOuts: 0,
                hits: 1,
                earnedRuns: 0,
                baseOnBalls: 0,
                outs: 3,
                inningsPitched: '1.0',
                numberOfPitches: 12,
                battersFaced: 3,
              },
            },
          },
          ID_BROWN: {
            person: { fullName: 'Hunter Brown' },
            gameStatus: { isOnBench: true },
            stats: { batting: {}, pitching: {} },
          },
        },
      },
      away: {
        team: { name: 'Kansas City Royals' },
        players: {
          ID_VINNIE: {
            person: { fullName: 'Vinnie Pasquantino' },
            gameStatus: { isOnBench: true },
            stats: { batting: {}, pitching: {} },
          },
          ID_GARCIA: {
            person: { fullName: 'Maikel García' },
            gameStatus: { isOnBench: true },
            stats: { batting: {}, pitching: {} },
          },
          ID_SUGANO: {
            person: { fullName: 'Tomoyuki Sugano' },
            gameStatus: { isOnBench: true },
            stats: { batting: {}, pitching: {} },
          },
          ID_ALLEN: {
            person: { fullName: 'Nick Allen' },
            gameStatus: { isOnBench: false, isSubstitute: true },
            stats: {
              batting: {
                summary: '0-0',
                gamesPlayed: 1,
                hits: 0,
                doubles: 0,
                triples: 0,
                homeRuns: 0,
                runs: 0,
                rbi: 0,
                atBats: 0,
                plateAppearances: 0,
              },
              pitching: {},
            },
          },
        },
      },
    },
  }
}
