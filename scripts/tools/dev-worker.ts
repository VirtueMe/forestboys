/**
 * `npm run dev:worker`: Vite and the Cloudflare Pages Functions together, on http://localhost:8788.
 *
 * `wrangler.toml` has `pages_build_output_dir`, so that Pages reads the file on a deployment (#174). Wrangler then
 * serves that folder (`dist`) and ignores `--proxy` for the pages, and it refuses a directory and a proxy command
 * together, so `wrangler pages dev … -- npm run dev` is out. And `pages dev` takes no custom config path.
 *
 * So wrangler is started in `.wrangler/dev-pages/`, which holds a copy of `wrangler.toml` without that one line, and
 * links to `functions/` and `.dev.vars`. Local state (D1, R2) stays in the project's `.wrangler/state`. Vite runs on
 * its own port and wrangler proxies to it. Both stop together, on Ctrl-C or when either ends; stdin is not passed on, so their hotkeys are off and they never read the TTY. The Durable Object
 * (`BUNDLE_EVENTS`) comes from the copy of `wrangler.toml`; it shows «not connected» until `npm run dev:do` runs the worker.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const VITE_PORT = '5173'
const root = resolve(import.meta.dirname, '..', '..')
const dir = join(root, '.wrangler', 'dev-pages')

mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'wrangler.toml'), readFileSync(join(root, 'wrangler.toml'), 'utf8').replace(/^pages_build_output_dir\s*=.*$/m, ''))
for (const [name, target] of [['functions', join(root, 'functions')], ['.dev.vars', join(root, '.dev.vars')]] as const) {
  if (!existsSync(target)) continue
  rmSync(join(dir, name), { force: true })
  symlinkSync(realpathSync(target), join(dir, name))
}

// The binaries directly, not `npx`: its wrapper exits on SIGTERM and leaves the real process running.
const bin = (name: string) => join(root, 'node_modules', '.bin', name)

const children = [
  spawn(bin('vite'), ['--port', VITE_PORT, '--strictPort'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] }),
  spawn(bin('wrangler'), ['pages', 'dev', '--proxy', VITE_PORT, '--persist-to', join(root, '.wrangler', 'state')], { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] }),
]

let stopping = false
let exitCode = 0
let alive = children.length
function stop(code: number) {
  if (stopping) return
  stopping = true
  exitCode = code
  for (const c of children) c.kill('SIGTERM')
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
for (const c of children) {
  c.on('exit', code => {
    stop(code ?? 0)
    // Exit only after both are gone: leaving first hands the TTY back to the shell while they still read it (EIO).
    if (--alive === 0) process.exit(exitCode)
  })
}
