# Milorg 2 Utforsker

A mobile-first PWA mapping the Norwegian resistance movement 1940–1945, built on
Jan Warberg and Rolf G. Halvorsen's decade of primary-source research.

Live (beta): <https://forestboys.pages.dev>

**Stack:** Vue 3 · Vite · TypeScript strict · MapLibre GL JS · Neo4j · IndexedDB
(idb) · vite-plugin-pwa · Cloudflare Pages + Functions.

The material: about 1 100 locations, 140 stations, 3 700 people and 2 100 events,
with transport, operations, organisations, outlines and sources. Most people will
meet it on a phone, possibly with poor connectivity, so the app is built to be
fast on a small screen and to work offline: lean lists are cached in IndexedDB and
detail is fetched only when opened (see [`docs/STRATEGY.md`](./docs/STRATEGY.md)).

## Background

The project began as a research prototype on top of Sanity. Sanity turned out
not to be good enough for showing data at the quality the research deserves, so
the data model moved to a graph in Neo4j, where people, places, events and
sources are linked and every claim can carry its source. Jan has used the
prototype daily for four months and is committing to the direction, which is why
the early history is exploratory. The graph model is described in
[`docs/DB.md`](./docs/DB.md) and [`docs/NEO4J-MAPPING.md`](./docs/NEO4J-MAPPING.md);
[`docs/STRATEGY.md`](./docs/STRATEGY.md) covers why the app was rebuilt.

## Architecture

```
Browser (Vue PWA, IndexedDB cache)
   │
   ▼
Cloudflare Pages ── static app (dist/)
   │                └─ Pages Functions (functions/)
   │                     ├─ /auth/*     Google, GitHub and direct login → session cookie / JWT
   │                     ├─ /api/*      graph reads, admin editors, proposal review
   │                     └─ /images/*   photos served from R2
   ├── Neo4j Aura        the graph (Query API)
   ├── D1  milorg_users  accounts and roles
   ├── R2  IMAGES        photos
   ├── R2  PROPOSALS     change bundles awaiting review
   └── Durable Object    live updates for bundle review (workers/bundle-events)
```

Content changes are reviewed before they go live: a GitHub Action asks Claude to
draft a change bundle from an outline (`.github/workflows/bot-task.yml`), and an
editor accepts or denies it entity by entity in the admin UI. See
[`docs/PROPOSALS.md`](./docs/PROPOSALS.md). A daily workflow carries edits made in
Sanity into the graph until editing there stops
([`docs/SANITY-SYNC.md`](./docs/SANITY-SYNC.md)). The automated research pipeline
is specified in [`docs/ENRICHMENT_PIPELINE.md`](./docs/ENRICHMENT_PIPELINE.md).

Documentation is indexed in [`docs/INDEX.md`](./docs/INDEX.md). Project
orientation for contributors and coding agents is in [`AGENTS.md`](./AGENTS.md).

## Branches and deployment

| Branch   | What it is                                                                  | Deployed to                          |
| -------- | --------------------------------------------------------------------------- | ------------------------------------ |
| `main`   | The Neo4j app. Protected: changes land through pull requests with CI green. | Cloudflare Pages (`forestboys`)      |
| `sanity` | The original Sanity-backed app, kept running because Jan uses it daily.     | GitHub Pages, no further development |

Every pull request gets a Cloudflare preview. Build command and output directory
live in the Cloudflare Pages dashboard, not in `wrangler.toml`. Bindings (D1, R2,
Durable Object) are declared in `wrangler.toml`; secrets are set in the Pages
project settings.

## Local development

Requires Node 24 (`.nvmrc`).

```bash
npm ci
npm run dev            # Vite only — SPA on http://localhost:5173
npm run dev:worker     # Vite + Cloudflare Pages Functions on http://localhost:8788
```

- Use **`dev`** for UI work. Fast HMR, no auth endpoints. The `/auth/*` calls
  404 — useful only if you're staying out of the login flow.
- Use **`dev:worker`** whenever you need the backend — auth (`/auth/token`,
  `/auth/me`, `/auth/callback`), the review endpoints, or anything under
  `functions/`. Wrangler proxies Vite, so HMR still works.

Copy `.env.example` to `.env` for the browser-side variables. A local Neo4j for
development comes from `docker-compose.yml`.

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
redirect URIs + the Secure cookie flag both block it. The GitHub path needs
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, with a separate OAuth app whose
callback is the `127.0.0.1:8788` address. Use `dev:worker` with the direct login for local editor
testing; the Google flow is exercised on the deployed test sites.

## Build + preview the production bundle

```bash
npm run lint           # ESLint
npm test               # Vitest (npm run test:watch while developing)
npm run build          # vue-tsc type-check (including functions/) + Vite build → dist/
npm run preview        # serve dist/ via Vite preview (no functions)
```

CI runs lint, tests and build on every pull request.

## Scripts

See [`scripts/`](./scripts/) for one-off helpers — Sanity → Neo4j extractors,
Anthropic Batch API submissions, source data quality checks, and the
`hash-password.ts` utility used when provisioning direct-login credentials.

## Contributing

Corrections to the historical record are welcome, and they need a source. Code
contributions follow the workflow in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Please read the [Code of Conduct](./CODE_OF_CONDUCT.md); report security problems
as described in [`SECURITY.md`](./SECURITY.md).

## Credits and licence

The research, the data and the editorial work are by **Jan Warberg** and
**Rolf G. Halvorsen**. The code is maintained by
[@VirtueMe](https://github.com/VirtueMe).

The source code is released under the [MIT licence](./LICENSE). The historical
content is the editors' work; a licence for it has not been chosen yet, so don't
assume it is covered by the code licence. External sources are cited, not
reproduced, unless their licence allows reuse.
