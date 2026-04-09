import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  // Base JS recommended
  js.configs.recommended,

  // TypeScript type-checked rules
  ...tseslint.configs.recommendedTypeChecked,

  // Vue 3 recommended (flat config)
  ...(pluginVue.configs['flat/recommended'] as Parameters<typeof tseslint.config>[0][]),

  // TypeScript parser for <script> blocks inside .vue files
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // Project service for type-aware rules (covers both tsconfig projects)
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  // ── src + Vue files (browser environment) ────────────────────────────────
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // TypeScript already enforces this; no-undef trips on browser globals in .vue
      'no-undef': 'off',
      // no-unused-vars handled by TypeScript compiler (noUnusedLocals / noUnusedParameters)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // Unsafe rules: relax for Sanity dynamic JSON (fetch response, GROQ results)
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',

      // Allow @ts-expect-error with description (used in Sanity dynamic queries)
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],

      // Floating promises: warn so async event handlers don't silently swallow errors
      '@typescript-eslint/no-floating-promises': 'warn',

      // ── Vue template style ──────────────────────────────────────────────
      // These conflict with compact, readable single-line templates — turn off
      'vue/singleline-html-element-content-newline': 'off',
      'vue/max-attributes-per-line': 'off',
      // Self-closing: allow void HTML elements self-closed, require close tag on normal elements
      'vue/html-self-closing': ['error', {
        html: { void: 'always', normal: 'never', component: 'always' },
        svg: 'always',
        math: 'always',
      }],
      // Component name casing in templates
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      // Prop defaults
      'vue/require-default-prop': 'off',
    },
  },

  // ── scripts (Node environment) ─────────────────────────────────────────
  {
    files: ['scripts/**/*.ts', 'vite.config.ts', 'eslint.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },

  // ── ignore build output ────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', '*.d.ts'],
  },
)
