// Retired: anonymous Featured saves accepted client sport, gameTime, odds,
// and EV, and could claim snapshot slots / write graded-record parlays.
// Featured persist stays on CRON_SECRET /api/parlays/generate (featured=1)
// and npm run record:featured. Public generate is read-only.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { gone } from '../../../../lib/api-security.js'

export async function POST() {
  return gone('Client parlay saves are retired. Featured cards persist via record:featured.')
}
