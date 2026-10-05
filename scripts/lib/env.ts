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
 * Writing still needs --write: every script that can write is a dry run unless it
 * is given --write, and the banner above comes from that same flag. The older
 * --dry, --dry-run and --apply are refused (#78).
 */

import * as dotenv from 'dotenv'

export const PRODUCTION = process.argv.includes('--production')

/** The one switch: a script is a dry run unless it is given --write (#78). */
export const WRITE = process.argv.includes('--write')

/** Switches the scripts used before there was one convention. They are refused, not ignored. */
export const OLD_WRITE_FLAGS = ['--dry', '--dry-run', '--apply'] as const

/** The old write/dry switches present in `argv`. */
export function oldFlagsIn(argv: readonly string[]): string[] {
  return OLD_WRITE_FLAGS.filter(f => argv.includes(f))
}

/** What a script says first when it talks to production. */
export function productionBanner(host: string, write: boolean): string {
  return `▶ PRODUCTION ${host}${write ? ' — WRITING' : ' — read only'}`
}

export function loadEnv(): { production: boolean; host: string } {
  const old = oldFlagsIn(process.argv)
  if (old.length) {
    console.error(`${old.join(', ')} ${old.length > 1 ? 'are not flags' : 'is not a flag'} any more: a script is a dry run unless you pass --write.`)
    process.exit(2)
  }
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
    console.error(productionBanner(host, WRITE))
  }
  return { production: PRODUCTION, host }
}
