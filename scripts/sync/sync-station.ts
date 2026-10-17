/**
 * The Sanity → graph sync of stations (#297, part of #155): name, coordinates, type, gallery and slug, with a stamp per
 * field, and a node for a station new in Sanity. The rules are in scripts/lib/place-sync.ts, the run in place-sync-run.ts,
 * docs/SANITY-SYNC.md («Locations and stations»).
 *
 * Usage: npx tsx scripts/sync/sync-station.ts [--production] [--write] [--accept-review=<slug>,…]
 */

import { loadEnv } from '../lib/env.ts'
import { STATION } from '../lib/place-sync.ts'
import { runPlaceSync } from '../lib/place-sync-run.ts'
loadEnv()

runPlaceSync(STATION, process.argv).catch(e => { console.error(e); process.exit(1) })
