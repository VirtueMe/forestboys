# DB

Long-term data architecture consideration for the motstandsbevegelsen handoff.

## Status

`note` — not in scope for this rebuild. No action required.

---

## Current model

Sanity stores the dataset as documents with references — people, events,
locations, organisations, stations, and transport are all linked by reference
fields. GROQ resolves these at query time.

This works at the current scale but the data is fundamentally a graph, and
document references are a structural approximation of graph edges.

## Where document references fall short

**Person outcomes per event** — whether someone was killed, captured, or
wounded at a specific event requires a relationship with attributes. A document
store has no clean place for this: it ends up as a denormalised field on one
side of the reference or a separate junction document, both of which are awkward
to query and maintain.

**Multi-hop queries** — finding all people connected to locations linked to a
specific organisation requires chained GROQ dereferencing. These queries are
expensive and hard to read.

**Temporal relationships** — whether a person was alive at the time of an event
they are linked to has no native representation. This matters for historical
accuracy: a person can be referenced by an event that postdates their death.

## Long-term direction

A graph database would model this data honestly. Each entity becomes a node;
each reference becomes a typed, directable edge; relationship attributes
(outcome, role, temporal validity) sit on the edge rather than being
approximated in document fields.

Neo4j is the obvious candidate given the data shape and the research use case
(historians running path queries, finding network clusters, tracing chains of
command). A purpose-built solution is also possible given the domain specificity.

## What this means for the rebuild

Nothing immediate. Sanity remains the source of truth. No schema changes are
made for this reason.

This note exists so the motstandsbevegelsen maintainers understand why the data
model feels constrained in places, and have a named direction to move toward if
the research use of the dataset deepens.
