import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/forestboys/',
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
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false, // we supply public/manifest.json
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
