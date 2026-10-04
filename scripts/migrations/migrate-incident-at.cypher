// Collapse Incident's directional FROM/TO and FROM_STATION/TO_STATION
// edges into a single AT / AT_STATION edge. Operations keep their
// directional edges — only Incidents change.
//
// Conflict policy when both FROM and TO exist on the same Incident:
//   prefer FROM (the "happened from" location is more often the actual
//   site of the incident). Same for stations.
//
// Run in Aura Browser. Pre/post audits bracket each step.

// ── Pre-migration audit ──────────────────────────────────────
MATCH (i:Incident)-[r:FROM]->(:Location)         RETURN count(r) AS incFromLoc;
MATCH (i:Incident)-[r:TO]->(:Location)           RETURN count(r) AS incToLoc;
MATCH (i:Incident)-[r:FROM_STATION]->(:Station)  RETURN count(r) AS incFromSt;
MATCH (i:Incident)-[r:TO]->(:Station)            RETURN count(r) AS incToStViaTO;  // unlikely
MATCH (i:Incident)-[r:TO_STATION]->(:Station)    RETURN count(r) AS incToSt;

// Operation edges should be untouched — record baseline:
MATCH (op:Operation)-[r:FROM]->(:Location)       RETURN count(r) AS opFromLoc;
MATCH (op:Operation)-[r:TO]->(:Location)         RETURN count(r) AS opToLoc;
MATCH (op:Operation)-[r:FROM_STATION]->(:Station) RETURN count(r) AS opFromSt;
MATCH (op:Operation)-[r:TO_STATION]->(:Station)  RETURN count(r) AS opToSt;

// ── 1. Incident FROM Location → AT Location ────────────────
MATCH (i:Incident)-[r:FROM]->(l:Location)
MERGE (i)-[:AT]->(l)
DELETE r;

// ── 2. Incident TO Location → AT Location, only if no AT already ─
MATCH (i:Incident)-[r:TO]->(l:Location)
WHERE NOT (i)-[:AT]->(:Location)
MERGE (i)-[:AT]->(l)
DELETE r;

// Drop any TO Location edges still attached to incidents (the FROM
// branch already created the AT we kept).
MATCH (i:Incident)-[r:TO]->(:Location)
DELETE r;

// ── 3. Incident FROM_STATION → AT_STATION ────────────────────
MATCH (i:Incident)-[r:FROM_STATION]->(s:Station)
MERGE (i)-[:AT_STATION]->(s)
DELETE r;

// ── 4. Incident TO_STATION → AT_STATION, only if no AT_STATION already ─
MATCH (i:Incident)-[r:TO_STATION]->(s:Station)
WHERE NOT (i)-[:AT_STATION]->(:Station)
MERGE (i)-[:AT_STATION]->(s)
DELETE r;

MATCH (i:Incident)-[r:TO_STATION]->(:Station)
DELETE r;

// ── Post-migration verification ──────────────────────────────
MATCH (i:Incident)-[r:AT]->(:Location)           RETURN count(r) AS incAtLoc;
MATCH (i:Incident)-[r:AT_STATION]->(:Station)    RETURN count(r) AS incAtSt;
// Confirm leftovers are zero:
MATCH (i:Incident)-[r:FROM|TO]->(:Location)      RETURN count(r) AS leftoverIncLoc;
MATCH (i:Incident)-[r:FROM_STATION|TO_STATION]->(:Station) RETURN count(r) AS leftoverIncSt;

// Operation edges still intact (compare to baseline):
MATCH (op:Operation)-[r:FROM]->(:Location)       RETURN count(r) AS opFromLocAfter;
MATCH (op:Operation)-[r:TO]->(:Location)         RETURN count(r) AS opToLocAfter;
MATCH (op:Operation)-[r:FROM_STATION]->(:Station) RETURN count(r) AS opFromStAfter;
MATCH (op:Operation)-[r:TO_STATION]->(:Station)  RETURN count(r) AS opToStAfter;
