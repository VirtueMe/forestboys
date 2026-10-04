import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Kept apart from vite.config.ts: that one pulls in the PWA and devtools
// plugins and the Sanity proxy, none of which tests need.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
