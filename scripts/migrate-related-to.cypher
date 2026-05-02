// Migrate event hierarchy edges to a single RELATED_TO edge type with
// `kind: 'contains'` semantics. Direction = container → child.
//
// Before:
//   (Inc)-[:OCCURRED_IN]->(Op)            // incident sits inside operation
//   (Inc:child)-[:PART_OF]->(Inc:parent)  // sub-incident
//   (Op:child)-[:PART_OF]->(Op:parent)    // sub-operation
//
// After:
//   (Op)-[:RELATED_TO {kind:'contains'}]->(Inc)            // op contains incidents
//   (Inc:parent)-[:RELATED_TO {kind:'contains'}]->(Inc:child)  // op contains sub-incidents
//   (Op:parent)-[:RELATED_TO {kind:'contains'}]->(Op:child)    // op contains sub-operations
//
// Run in Aura Browser. Steps run in sequence; check counts between each.
// Wrap in transactions if you want atomicity (each :auto begin/:commit pair).

// ── Pre-migration audit ───────────────────────────────────────
// Expected counts to verify nothing is lost:
MATCH (i:Incident)-[r:OCCURRED_IN]->(:Operation) RETURN count(r) AS occurredIn;
MATCH (:Incident)-[r:PART_OF]->(:Incident)       RETURN count(r) AS subIncidents;
MATCH (:Operation)-[r:PART_OF]->(:Operation)     RETURN count(r) AS subOperations;
// Sum these three; the new RELATED_TO {kind:'contains'} count must match.

// ── 1. OCCURRED_IN → RELATED_TO {kind:'contains'} ───────────
// Original is (child:Inc)→(parent:Op); flip to (parent:Op)→(child:Inc).
MATCH (i:Incident)-[r:OCCURRED_IN]->(op:Operation)
MERGE (op)-[n:RELATED_TO]->(i)
SET   n.kind = 'contains'
DELETE r;

// ── 2. PART_OF (Inc→Inc) → RELATED_TO {kind:'contains'} ─────
// Original is (child)→(parent); flip to (parent)→(child).
MATCH (child:Incident)-[r:PART_OF]->(parent:Incident)
MERGE (parent)-[n:RELATED_TO]->(child)
SET   n.kind = 'contains'
DELETE r;

// ── 3. PART_OF (Op→Op) → RELATED_TO {kind:'contains'} ───────
MATCH (child:Operation)-[r:PART_OF]->(parent:Operation)
MERGE (parent)-[n:RELATED_TO]->(child)
SET   n.kind = 'contains'
DELETE r;

// ── Post-migration verification ──────────────────────────────
// Count by kind-pair — should equal pre-migration sums.
MATCH (a)-[r:RELATED_TO {kind:'contains'}]->(b)
WHERE (a:Incident OR a:Operation) AND (b:Incident OR b:Operation)
RETURN labels(a)[0] AS fromKind, labels(b)[0] AS toKind, count(r) AS n
ORDER BY fromKind, toKind;

// Confirm no stragglers remain on the old edge types.
MATCH (:Incident)-[r:OCCURRED_IN]->(:Operation)  RETURN count(r) AS leftoverOccurredIn;
MATCH (:Incident)-[r:PART_OF]->(:Incident)       RETURN count(r) AS leftoverSubIncident;
MATCH (:Operation)-[r:PART_OF]->(:Operation)     RETURN count(r) AS leftoverSubOperation;
// All three must return 0.
