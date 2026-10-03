# Contributing

Thank you for helping. Milorg 2 Utforsker is built on Jan Warberg and Rolf G.
Halvorsen's decade of primary-source research on the Norwegian resistance
movement 1940–1945. Contributions in Norwegian or English are welcome.

By taking part you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
Security problems go through [SECURITY.md](./SECURITY.md), not public issues.

## Two kinds of contribution

**Content: facts, names, dates, places, sources.** You don't need to write code.
Open an issue describing what is wrong or missing, and **cite a source**
(archive reference, book and page, or a direct link to a scan). Changes to the
historical record are reviewed by the editors before they are published. Quote
or link sources; don't paste long passages from copyrighted works.

**Code: the app, the data pipeline, tooling.** Follow the steps below.

## Setting up

Requires Node 24 (`.nvmrc`).

```bash
npm ci
npm run dev          # SPA only, http://localhost:5173
npm run dev:worker   # SPA + Cloudflare Pages Functions, http://localhost:8788
```

The README explains the `.dev.vars` file that `dev:worker` needs. A local Neo4j
for development comes from `docker-compose.yml`. Never commit `.dev.vars`,
`.env` or any credential.

Before opening a PR, run what CI runs:

```bash
npm run lint
npm test             # Vitest; *.test.ts files sit next to the code they test
npm run build        # vue-tsc type-check (including functions/) + vite build
```

A pre-commit hook runs `npm run lint`.

## Workflow

1. **Find or open an issue** first, so the work is discussed before it is built.
   Comment that you are taking it.
2. **Branch from `main`**, named `<type>/<issue>_<short-slug>`, for example
   `feat/42_person-timeline` or `fix/57_drawer-scroll`.
3. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)**:
   `feat`, `fix`, `docs`, `style`, `refactor`, `chore`, `ci`, `tests`, optionally
   with a scope: `fix(auth): reject expired sessions`. Explain _why_ in the body;
   the diff already shows _what_.
4. **Open a pull request** to `main` with `Closes #<issue>` in the description and a
   short test plan.
5. **CI must pass.** `main` is protected: changes land through pull requests
   only, with the `Lint, type-check, build` and `Cloudflare Pages` checks
   green. Cloudflare builds a preview of every PR.

## Releases

Versions follow [Semantic Versioning](https://semver.org/) and are derived from
your commit messages, so the Conventional Commit type matters:
`feat` bumps the minor version (while we are below 1.0), `fix` bumps the patch,
and `feat!` / a `BREAKING CHANGE:` footer marks a breaking change. `chore`, `ci`,
`test` and `style` commits don't appear in the changelog.

[release-please](https://github.com/googleapis/release-please) keeps a
`chore: release X.Y.Z` pull request open on `main`. It updates `package.json`
and `CHANGELOG.md`. A maintainer merges it when a release is wanted; that tags
the version and publishes a GitHub Release. Don't edit `CHANGELOG.md` or the
version by hand.

## Design and code style

- UI follows [`DESIGN.md`](./DESIGN.md) (light) and
  [`DESIGN-dark.md`](./DESIGN-dark.md) (dark): the _Archival Paper_ look, plain
  CSS with custom properties, no UI framework. The anti-patterns lists are
  binding.
- TypeScript is strict. Match the surrounding code's naming and comment density.
- UI text is Norwegian.
- Mobile first: check changes on a narrow viewport.
- Project orientation is in [`AGENTS.md`](./AGENTS.md); design and data
  documents are indexed in [`docs/INDEX.md`](./docs/INDEX.md).

## Labels

| Group    | Labels                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Type     | `bug`, `enhancement`, `documentation`, `question`, `chore`, `security`, `refactor`, `ci`, `tests`                          |
| Area     | `area: map`, `area: data-model`, `area: admin`, `area: auth`, `area: design`, `area: infra`, `area: docs`, `area: content` |
| Priority | `priority: high`, `priority: low` (none means normal)                                                                      |
| Status   | `status: needs-triage`, `status: needs info`, `status: in progress`, `status: blocked`, `status: needs review`             |

New issues are triaged automatically by Claude through a GitHub Action
(`.github/workflows/issue-triage.yml`), which applies type, area and status
labels and comments. A maintainer reviews its work and removes
`status: needs-triage`. Maintainers set the other status labels.

Good first issues carry `good first issue`.

## Local checklist file

If you keep a working checklist for an issue, call it `CHECKLIST.md`; it is
gitignored so it won't end up in your commits.
