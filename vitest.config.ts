import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Kept apart from vite.config.ts: that one pulls in the PWA and devtools
// plugins and the Sanity proxy, none of which tests need.
// `npm run test:neo4j` runs the tests that need the local Neo4j: only then are its settings (.env) given to the tests.
const NEO4J_TEST = process.env.NEO4J_TEST === '1'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The functions code imports '~/…' (functions/tsconfig.json paths): a test that mocks one of its modules needs it too.
      '~': fileURLToPath(new URL('./functions', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    env: NEO4J_TEST ? { NEO4J_TEST: '1', ...loadEnv('', process.cwd(), 'NEO4J_') } : {},
  },
})
