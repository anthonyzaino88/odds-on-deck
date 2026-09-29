// Retired: anonymous Featured saves accepted client sport, gameTime, odds,
// and EV, and could claim snapshot slots / write graded-record parlays.
// Featured persist stays on server-side /api/parlays/generate (featured=1)
// and npm run record:featured.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { gone } from '../../../../lib/api-security.js'

export async function POST() {
  return gone('Client parlay saves are retired. Featured cards persist at generate.')
}
