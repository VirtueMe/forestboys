# Milorg 2 Utforsker

A mobile-first PWA mapping the Norwegian resistance movement 1940–1945, built on
Jan Warberg and Rolf G. Halvorsen's decade of primary-source research.

**Stack:** Vue 3 · Vite · TypeScript strict · MapLibre GL JS · Neo4j · IndexedDB
(idb) · vite-plugin-pwa · Cloudflare Pages + Functions.

See [`CLAUDE.md`](./CLAUDE.md) for the project orientation and
[`docs/ENRICHMENT_PIPELINE.md`](./docs/ENRICHMENT_PIPELINE.md) for the
automated research pipeline spec.

## Local development

```bash
npm install
npm run dev            # Vite only — SPA on http://localhost:5173
npm run dev:worker     # Vite + Cloudflare Pages Functions on http://localhost:8788
```

- Use **`dev`** for UI work. Fast HMR, no auth endpoints. The `/auth/*` calls
  404 — useful only if you're staying out of the login flow.
- Use **`dev:worker`** whenever you need the backend — auth (`/auth/token`,
  `/auth/me`, `/auth/callback`), the review endpoints, or anything under
  `functions/`. Wrangler proxies Vite, so HMR still works.

### Env vars for `dev:worker`

Wrangler reads `.dev.vars` (gitignored) in the project root. Minimum for the
direct login flow:

```
SESSION_SECRET=<any long random string>
DIRECT_LOGIN_USERNAME=<the username you'll type in the form>
DIRECT_LOGIN_PASSWORD_HASH=<output of npx tsx scripts/hash-password.ts>
DIRECT_LOGIN_USER_NAME=<display name>
DIRECT_LOGIN_USER_EMAIL=<identifier email>
DIRECT_LOGIN_ROLE=admin
```

The Google OAuth path needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`ADMIN_EMAILS` as well, but **won't work on `http://localhost`** — Google's
redirect URIs + the Secure cookie flag both block it. Use `dev:worker` with the
direct login for local editor testing; Google flow is exercised on the
deployed test sites.

## Build + preview the production bundle

```bash
npm run build          # type-check + Vite build → dist/
npm run preview        # serve dist/ via Vite preview (no functions)
```

## Scripts

See [`scripts/`](./scripts/) for one-off helpers — Sanity → Neo4j extractors,
Anthropic Batch API submissions, source data quality checks, and the
`hash-password.ts` utility used when provisioning direct-login credentials.
