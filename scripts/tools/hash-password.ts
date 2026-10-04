/**
 * PBKDF2 hash generator for DIRECT_LOGIN_PASSWORD_HASH.
 *
 * Usage:
 *   npx tsx scripts/tools/hash-password.ts <password>
 *   npx tsx scripts/tools/hash-password.ts                # prompts stdin
 *
 * Output format matches what functions/auth/token.ts expects:
 *   pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 *
 * Paste the full line into Cloudflare Pages env as DIRECT_LOGIN_PASSWORD_HASH.
 * Defaults: 100_000 iterations, SHA-256, 16-byte salt, 32-byte hash.
 */

import { webcrypto } from 'crypto'
import { createInterface } from 'readline'

const ITERATIONS = 100_000
const SALT_BYTES = 16
const HASH_BYTES = 32

async function hash(password: string): Promise<string> {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    HASH_BYTES * 8,
  )
  const saltB64 = Buffer.from(salt).toString('base64')
  const hashB64 = Buffer.from(bits).toString('base64')
  return `pbkdf2$${ITERATIONS}$${saltB64}$${hashB64}`
}

async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false })
  process.stderr.write('Password: ')
  return new Promise(resolve => {
    rl.once('line', line => { rl.close(); resolve(line) })
  })
}

async function main() {
  const password = process.argv[2] ?? await readStdin()
  if (!password) {
    console.error('No password provided')
    process.exit(1)
  }
  console.log(await hash(password))
}

void main()
