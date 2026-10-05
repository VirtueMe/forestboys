import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isHousekeeping, parseCommitLog, type SinceRelease } from './src/utils/sinceRelease.ts'

/** Short commit the bundle is built from: Cloudflare's variable, else git, else none. */
function buildCommit(env: Record<string, string>): string {
  const fromCf = env.CF_PAGES_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA
  if (fromCf) return fromCf.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/**
 * Latest release tag and the commits after it, or null when git cannot say.
 * Cloudflare (and CI) clone shallow and without tags, so there the build first
 * fetches the tags and the missing history. Locally nothing is fetched.
 */
function sinceRelease(): SinceRelease | null {
  const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  const latestTag = () => git("describe --tags --abbrev=0 --match 'v*' HEAD")
  try {
    let tag: string
    try {
      tag = latestTag()
    } catch (e) {
      if (!process.env.CF_PAGES && !process.env.CI) throw e
      const shallow = git('rev-parse --is-shallow-repository') === 'true'
      git(`fetch --tags --force${shallow ? ' --unshallow' : ''}`)
      tag = latestTag()
    }
    const log = git(`log ${tag}..HEAD --no-merges --format=%h%x09%s`)
    return { tag, commits: parseCommitLog(log).filter(c => !isHousekeeping(c.subject)).slice(0, 200) }
  } catch (e) {
    const err = e as { stderr?: Buffer; message: string }
    console.warn(`[since-release] no release info: ${err.stderr?.toString().trim() || err.message}`)
    return null
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: env.VITE_BASE_PATH ?? '/',
    define: {
      __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version),
      __APP_COMMIT__:  JSON.stringify(buildCommit(env)),
      __APP_SINCE__:   JSON.stringify(sinceRelease()),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      cors: true,
      proxy: {
        '/sanity': {
          target: `https://${env.VITE_SANITY_PROJECT_ID}.apicdn.sanity.io`,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/sanity/, ''),
        },
      },
    },
    plugins: [
      vue(),
      vueDevTools(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false, // we supply public/manifest.json
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // The app is one 2.5 MB entry chunk: rolldown 1.x no longer splits the
          // shared editor code the pages import statically into separate files.
          // The total is unchanged, but the default 2 MiB precache limit now
          // rejects the file and the build fails.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Server routes (Pages Functions) must reach the network. Without
          // this the service worker answers their navigations with index.html:
          // /auth/github then shows the app's blank 404 instead of redirecting.
          navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/images\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/\w+\.apicdn\.sanity\.io\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sanity-api',
                expiration: { maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              urlPattern: /^https:\/\/basemaps\.cartocdn\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'map-tiles',
                expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
      }),
    ],
  }
})
