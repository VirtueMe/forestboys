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

/** Latest release tag and the commits after it, or null when git cannot say (e.g. a shallow clone without tags). */
function sinceRelease(): SinceRelease | null {
  const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  try {
    const tag = git("describe --tags --abbrev=0 --match 'v*' HEAD")
    const log = git(`log ${tag}..HEAD --no-merges --format=%h%x09%s`)
    return { tag, commits: parseCommitLog(log).filter(c => !isHousekeeping(c.subject)).slice(0, 200) }
  } catch {
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
