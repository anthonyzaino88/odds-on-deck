const capturedQueries = []

function chain(result, kind) {
  const q = {
    select() { return q },
    eq(column, value) {
      capturedQueries.push({ kind, op: 'eq', column, value })
      return q
    },
    in(column, value) {
      capturedQueries.push({ kind, op: 'in', column, value })
      return q
    },
    ilike() { return q },
    order() { return q },
    range() { return Promise.resolve(result) },
    update() {
      return {
        eq() { return Promise.resolve({ data: null, error: null }) },
      }
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return q
}

function makeSupabaseAdmin() {
  return {
    from(table) {
      if (table === 'Parlay') {
        return chain({
          data: [{
            id: 'feat-1',
            status: 'pending',
            notes: 'cohort:featured snapshot:featured:nfl:multi:2026-09-20',
          }],
          error: null,
        }, 'Parlay')
      }
      if (table === 'ParlayLeg') {
        return chain({
          data: [{
            id: 'leg-1',
            parlayId: 'feat-1',
            playerName: 'Jared Goff',
            propType: 'player_pass_tds',
            selection: 'over',
            threshold: 1.5,
            gameIdRef: 'DET_at_CHI_2026-09-20',
            legOrder: 1,
          }],
          error: null,
        }, 'ParlayLeg')
      }
      if (table === 'PropValidation') {
        return chain({
          data: [{
            playerName: 'Jared Goff',
            propType: 'player_pass_tds',
            status: 'completed',
            result: 'correct',
            actualValue: 2,
            gameIdRef: 'DET_at_CHI_2026-09-20',
          }],
          error: null,
        }, 'PropValidation')
      }
      return chain({ data: [], error: null }, table)
    },
  }
}

module.exports = { capturedQueries, makeSupabaseAdmin }
