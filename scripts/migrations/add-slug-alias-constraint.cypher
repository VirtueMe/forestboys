// A SlugAlias is unique per address space: no two aliases with the same slug on the same route (#96).
// Idempotent. Run in Aura Browser (production) or `cypher-shell` (local) before the first rename that keeps an alias.
// Nothing to back up: it creates a constraint and writes no data. Undo: DROP CONSTRAINT slug_alias_route_slug.

CREATE CONSTRAINT slug_alias_route_slug IF NOT EXISTS
FOR (a:SlugAlias) REQUIRE (a.route, a.slug) IS UNIQUE;

SHOW CONSTRAINTS YIELD name WHERE name = 'slug_alias_route_slug' RETURN name;
