/**
 * The Sanity → graph sync of locations (#296, part of #155): name, coordinates, gallery and slug, with a stamp per field,
 * and a node for a location new in Sanity. The rules are in scripts/lib/place-sync.ts, the run in place-sync-run.ts,
 * docs/SANITY-SYNC.md («Locations and stations»).
 *
 * Usage: npx tsx scripts/sync/sync-location.ts [--production] [--write] [--accept-review=<slug>,…]
 */

import { loadEnv } from '../lib/env.ts'
import { LOCATION } from '../lib/place-sync.ts'
import { runPlaceSync } from '../lib/place-sync-run.ts'
loadEnv()

runPlaceSync(LOCATION, process.argv).catch(e => { console.error(e); process.exit(1) })
