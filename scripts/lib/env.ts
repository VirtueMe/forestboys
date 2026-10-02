/**
 * Which Neo4j a script talks to — local unless asked for production.
 *
 *   (no flag)       .env, and NEO4J_URI must be localhost — an edited .env
 *                   can't take a script to production by accident
 *   --production    .env.production, with PRODUCTION_NEO4J_URI / _USERNAME /
 *                   _PASSWORD as the connection (variables already set in
 *                   the environment win — CI secrets). The target is
 *                   printed before anything runs.
 *
 * Writing still needs the script's own --write.
 */

import * as dotenv from 'dotenv'

export const PRODUCTION = process.argv.includes('--production')

export function loadEnv(): { production: boolean; host: string } {
  dotenv.config({ path: PRODUCTION ? '.env.production' : '.env', quiet: true })
  // Production credentials are PRODUCTION_NEO4J_* (file or CI secrets) — they
  // win over any NEO4J_* the file still holds for other uses.
  if (PRODUCTION) {
    for (const k of ['URI', 'USERNAME', 'PASSWORD']) {
      const v = process.env[`PRODUCTION_NEO4J_${k}`]
      if (v) process.env[`NEO4J_${k}`] = v
    }
  }
  const uri  = process.env.NEO4J_URI ?? ''
  const host = uri.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host)

  if (!host) {
    console.error('NEO4J_URI is not set.')
    process.exit(2)
  }
  if (!PRODUCTION && !local) {
    console.error(`NEO4J_URI points at ${host}, not localhost — pass --production to work against it.`)
    process.exit(2)
  }
  if (PRODUCTION && local) {
    console.error(`--production, but NEO4J_URI is ${host}.`)
    process.exit(2)
  }
  if (PRODUCTION) {
    console.error(`▶ PRODUCTION ${host}${process.argv.includes('--write') ? ' — WRITING' : ' — read only'}`)
  }
  return { production: PRODUCTION, host }
}
