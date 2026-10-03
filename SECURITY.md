# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub:
[Report a vulnerability](https://github.com/VirtueMe/forestboys/security/advisories/new)
(Security tab → _Report a vulnerability_).

Include what you found, how to reproduce it, and what an attacker could do with
it. You should get a first reply within a few days. This is a volunteer-run
project, so fixes follow as time allows; we will keep you informed and credit you
in the advisory unless you prefer otherwise.

## Scope

In scope: the web app, the Cloudflare Pages Functions under `functions/`
(authentication, session handling, admin and review endpoints), and the
scripts and workflows in this repository.

Particularly interesting: authentication or role bypass, access to unreviewed
proposals or admin endpoints, injection into Cypher queries, and leaked
credentials.

Out of scope: findings in third-party services (Cloudflare, Neo4j Aura,
GitHub, Sanity), denial of service by volume, and issues that need a
compromised maintainer account.

## Supported versions

Only the `main` branch, as deployed, is supported.

## Secrets

If you find a credential in the repository or its history, report it the same
way. Do not use it.
