# Cloudflare — what the production site is made of

The site is the Cloudflare Pages project `forestboys` (Pages Functions in `functions/`, static app in `dist/`), plus one
separate worker for the live-update Durable Object. Since #175 `wrangler.toml` is **the source of truth** for bindings
and plain variables: Pages reads it because it has `pages_build_output_dir`. Secrets live in the dashboard only. This
document names every binding, variable and secret the code reads (names only, never values), and
`scripts/functions-convention.test.ts` fails when a function reads a name that is not listed here.

## Rules that have cost time

- **A name defined in both `wrangler.toml` and the dashboard fails the deployment** («Binding name 'X' already in use»).
  A failed deployment leaves the live one in place. When a name moves into the file, remove it from the dashboard
  (Production and Preview) in the same sitting as the merge, not earlier: a redeploy of `main` before the merge would
  build without it.
- **Build-time `VITE_*` values reach the build only from `[vars]` in the file**; the dashboard's variables are ignored for
  the build once the file is valid.
- **A new binding or secret reaches only deployments built after it was saved.** «Retry deployment» builds with the
  current settings.
- **The PWA service worker** keeps the previous app for two or three reloads after a deploy. A private window shows the
  new one.
- **Probing a deployment without secrets.** Every deployment has its own address: the first 8 characters of its id
  (the Cloudflare check on the commit links to it) plus `.forestboys.pages.dev`.
  - `POST /api/proposals/ingest` with an empty body: `401 Invalid signature` means `PROPOSALS` is bound; `500 PROPOSALS R2
    binding missing` means it is not.
  - `GET /images/x.jpg`: a plain `404 Not found` means `IMAGES` is bound; `error code: 1101` means it is not.

## Bindings (`wrangler.toml`)

| Binding | What | Used by |
|---|---|---|
| `milorg_users` | D1 database `milorg-users` | login and the user list (`functions/auth`, `_lib/oauth.ts`, `api/admin/users`) |
| `IMAGES` | R2 bucket `milorg-images` | `GET /images/*`, image upload on the pages editor |
| `PROPOSALS` | R2 bucket `milorg-proposals` | bundles, their indexes and the ingest (`api/proposals`, `api/admin/proposals`) |
| `BUNDLE_EVENTS` | Durable Object `BundleEventsDO` of the worker `milorg-bundle-events` | live updates to an open review page; **not bound yet** (see below) |

R2 must be activated on the account before a bucket can exist. Use the Standard storage class (the free allowance
applies to Standard only).

## Plain variables (`[vars]` in `wrangler.toml`)

| Name | What |
|---|---|
| `GITHUB_CLIENT_ID` | the id of the GitHub OAuth app (public) |
| `VITE_SANITY_PROJECT_ID`, `VITE_SANITY_DATASET` | build-time, public: the Sanity project and dataset the client reads |

## Secrets (dashboard only, Production and Preview)

| Name | Needed? | What it is for |
|---|---|---|
| `SESSION_SECRET` | required | signs the session cookie and the direct-login token |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | required | the connection every function uses to the graph (the Query API, `functions/_lib/neo4j.ts`) |
| `NEO4J_HTTP_URI`, `NEO4J_DATABASE` | optional | override the HTTP address and the database name derived from `NEO4J_URI` |
| `BOT_INGEST_SECRET` | required for bundles | signs `POST /api/proposals/ingest` (the bot, `scripts/bundles/send-bundles.ts`), the request dispatch and the entity lookup/context endpoints |
| `GITHUB_CLIENT_SECRET` | for GitHub login | the OAuth app's secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google login | the Google OAuth client |
| `ADMIN_EMAILS` | optional | comma-separated emails that become `admin` on their first sign-in |
| `GITHUB_TOKEN`, `GITHUB_REPO` | for outline bundles | a token with `issues:write`, and `<owner>/<repo>`: a bundle request opens a `bot-task` issue and ingest comments on it and closes it |
| `ADMIN_BASE_URL` | optional | the site's address in the review link ingest writes into that comment |
| `DIRECT_LOGIN_USERNAME`, `DIRECT_LOGIN_PASSWORD_HASH`, `DIRECT_LOGIN_USER_NAME`, `DIRECT_LOGIN_USER_EMAIL`, `DIRECT_LOGIN_ROLE` | optional | the direct (password) login of `/auth/token`; it is on only where both `DIRECT_LOGIN_USERNAME` and `DIRECT_LOGIN_PASSWORD_HASH` are set |
| `BOT_DISPATCH_URL` | **never in production** | the address of the local bot runner (`npm run dev:bot`); when set, a bundle request goes there and not to GitHub, and ingest dispatches resolve jobs to it |

## The bundle-events worker (the Durable Object)

The class lives in `workers/bundle-events` (worker `milorg-bundle-events`). A Durable Object namespace is created when that
worker is **deployed**; the Pages project only binds to it, and a Pages deployment never deploys another worker. Until the
binding exists, ingest and the review pages work, and a page must be reloaded to see a new bundle (`broadcast()` returns
at once when the binding is missing).

1. Deploy the worker (needs `npx wrangler login`, or `CLOUDFLARE_API_TOKEN`): `npm run deploy:do`. Its migration is
   `new_sqlite_classes`: Cloudflare's free plan allows only SQLite-backed Durable Objects, and the class keeps its
   subscribers in memory and uses no storage, so it makes no difference on a paid plan.
2. Uncomment the `BUNDLE_EVENTS` block in `wrangler.toml` (`script_name = "milorg-bundle-events"`), and try it on a preview
   deployment first: a binding to a worker that does not exist can fail the whole deployment.
3. Check: open a bundle page, send a bundle, and see it appear without a reload.

Locally `npm run dev:worker` passes the Durable Object on the command line (`--do`), and `npm run dev:do` runs the worker on
its own.
