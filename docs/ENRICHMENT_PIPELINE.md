# Milorg 2 — Data Enrichment Pipeline
## Project Plan & Technical Specification

*Foreningen Motstandsbevegelsen i Norge 1940–1945*

Jan Warberg (Sizzling Viper) · Rolf G Halvorsen (Speedy Slash)

April 2025

---

## 1. Background

The Milorg 2 database documents Norwegian resistance operations 1940–1945 with primary-source rigour. Every event, person, and aircraft is traced back to original records — Operations Record Books (ORBs), Mission Reports (MRs), and archive holdings at The National Archives (TNA) in Kew.

The database currently holds approximately 995 fremkomstmidler (aircraft and vessels), hundreds of persons, and a growing catalogue of events. Each person entry may carry an Army Serial Number (ASN) that can be cross-referenced against digitised US National Archives records to recover biographical detail: birth state, enlistment date, civilian occupation, and unit.

This enrichment pipeline automates the discovery and linkage of those records while preserving Jan Warberg's founding principle:

> *"En påstand uten Primærkilde har redusert verdi."*
> A claim without a primary source has reduced value.

All enrichment suggestions must carry a verifiable source reference before they can be accepted into the database.

---

## 2. Objectives

- Automatically classify ASNs by type (enlisted vs officer) to route lookups correctly
- Query the US NARA Access to Archival Databases (AAD) for enlisted personnel records
- Provide a structured review queue where Jan and Rolf accept or reject each suggestion
- Write accepted enrichments back to Sanity CMS with full source attribution
- Maintain a permanent audit log of all accepted and rejected suggestions
- Scale to cover all persons, aircraft, and operations in the database

---

## 3. Pipeline Overview

The pipeline has five sequential phases. Sanity is both the source and the destination; the enrichment service sits between them as a stateless processor.

| Phase | Name | Description | Output |
|---|---|---|---|
| **1** | Data ingestion | Read entity records from Sanity CMS via GROQ query. Project only required fields: name, ASN, entity type. | Entity list |
| **2** | ASN classification | Parse ASN prefix to determine personnel category. Route to appropriate lookup strategy. | Classified list |
| **3** | External enrichment | Query NARA AAD (enlisted), name-based fallback (officers), or specialist sources (aircraft). Return structured suggestions. | Suggestions |
| **4** | Review queue | Present suggestions to Jan / Rolf with source reference. Each entry is accepted, rejected, or deferred. | Decisions |
| **5** | Write-back | Accepted suggestions are written to Sanity with source URL and verified flag. Rejected entries are logged with reason. | Audit log |

---

## 4. ASN Classification

The ASN prefix is the single most important routing signal. The NARA AAD enlistment database contains approximately nine million enlisted records but no commissioned officer records. Attempting to look up an officer ASN by number will always fail; the correct approach is a name-based search against the same database to find the earlier enlistment record.

| ASN Pattern | Type | NARA AAD | Lookup Strategy |
|---|---|---|---|
| Numeric (e.g. `37615907`) | Enlisted | **Yes** | Query directly by ASN number |
| 0-prefix (e.g. `02059596`) | Commissioned officer | No | Search by full name; match via enlistment-era enlisted ASN |
| T-prefix (e.g. `T-134619`) | Temporary/AUS officer | No | Search by full name; use external officer records if available |

**Example:** Dale Prilliman flew as 2Lt (ASN `02059596`) on the BRIDLE mission, 24 March 1945. His ASN has a 0-prefix, indicating a commission. Searching NARA AAD by name returns his earlier enlistment record (ASN `17136076`): Private, Air Corps, enlisted 15 December 1942, Kansas City, Kansas, born 1922, civilian occupation 'semiskilled structural metal worker'. The commission ASN is preserved in the database as the operational reference; the enlistment ASN becomes the NARA link target.

---

## 5. Enrichment Sources

### 5.1 NARA Access to Archival Databases (AAD)

Primary source for enlisted personnel.

Base URL: `https://aad.archives.gov/aad/record-detail.jsp`

Key parameters:
- `dt=893` — Enlistment records file
- `q=` — Search term (ASN number or name)
- `rid=` — Direct record identifier (used in stored links)

Each accepted NARA record yields: Army Serial Number, name, residence state, county, enlistment date, grade at enlistment, branch, birth year, race/citizenship, education level, civilian occupation, marital status.

### 5.2 Aircraft sources

- **b24bestweb.com** — B-24 Liberator nose art, serial numbers, crew. Contributed by Tom Ensminger (deceased 2022).
- **harringtonmuseum.org.uk** — 492nd Bomb Group / Carpetbagger operations history.
- **Mission Reports (MR 856/492)** — Primary source. Referenced by Jan and Rolf from TNA holdings.
- **Operations Record Books (ORB)** — Primary source. Squadron-level daily records.

### 5.3 Norwegian personnel

- **Soldatregisteret** — Norwegian soldier register
- **Fangeregisteret** — Prisoner register
- **Våre Falne** — Norwegian war dead register
- **Krigsseilerregisteret** — Merchant sailor register

---

## 6. Review Queue

The review queue is the editorial interface for Jan and Rolf. It presents each enrichment suggestion as a row with the proposed data, its source reference, and three actions: Accept, Reject, or Defer.

| Entity | Type | Suggested data | Source | Status |
|---|---|---|---|---|
| Dale Prilliman | Person | Born 1922, Kansas. Metal worker. | NARA/17136076 | **Pending** |
| Jack Keadle | Person | Born 1924, Ohio. Enlisted 1943. | NARA/35770485 | **Accepted** |
| 42-50331 Widow | Aircraft | Lost 24 Mar 1945, Gjevsjoen. | MR 856/492 | **Accepted** |
| W.D. Moore | Person | Multiple name matches found. | NARA/15344206 | **Rejected** |

### 6.1 Accept

The suggestion and its source reference are written to the linked Sanity document. The following fields are added:

- `enrichedData` — the suggested biographical or aircraft data
- `source` — the primary source name (e.g. `NARA AAD`)
- `sourceUrl` — the direct URL to the archival record
- `sourceRef` — human-readable citation (e.g. `NARA AAD, ASN 17136076`)
- `verified` — boolean true
- `verifiedBy` — name of reviewer
- `verifiedAt` — ISO timestamp

### 6.2 Reject

The suggestion is not written to Sanity. A rejection record is written to the audit log with:

- Entity reference
- Suggested data that was rejected
- Rejection reason (free text)
- Reviewer name and timestamp

Rejected entries remain visible in the queue and can be revisited. They are never silently deleted.

### 6.3 Defer

The suggestion is held in the queue without action. A note field is available. Deferred entries age and appear prominently after 30 days.

---

## 7. Neo4j Data Model

> **Note**: The original spec targeted Sanity CMS as write-back destination. Following the Sanity → Neo4j migration, accepted enrichments are written directly to the graph. No new Sanity document types are required.

### ExternalSource node

Recurring institutional sources are modelled as first-class nodes — stored once, referenced by many:

```cypher
(:ExternalSource {
  url:      "https://aad.archives.gov/aad/record-detail.jsp",
  name:     "NARA AAD",
  type:     "archive",    // archive | registry | museum | primary_source
  language: "en"
})
```

Canonical seed sources:

| Name | Type | URL |
|---|---|---|
| NARA AAD | archive | `aad.archives.gov` |
| b24bestweb.com | aircraft registry | `b24bestweb.com` |
| harringtonmuseum.org.uk | operations history | `harringtonmuseum.org.uk` |
| Krigsseilerregisteret | registry | `krigsseilerregisteret.no` |
| Soldatregisteret | registry | — |
| Fangeregisteret | registry | — |
| Våre Falne | registry | — |
| Wikipedia | encyclopedia | `wikipedia.org` |

### ExternalRecord node

Each accepted enrichment becomes an `(:ExternalRecord)` node linked to the person or aircraft:

```cypher
(:Person)-[:IDENTIFIED_BY]->(:ExternalRecord {
  asn:        "17136076",
  url:        "https://aad.archives.gov/aad/record-detail.jsp?dt=893&rid=17136076",
  sourceRef:  "NARA AAD, ASN 17136076",
  verified:   true,
  verifiedBy: "Jan Warberg",
  verifiedAt: datetime()
})-[:FROM_SOURCE]->(:ExternalSource {name: "NARA AAD"})
```

### EnrichmentSuggestion node

The review queue lives in the graph:

```cypher
(:EnrichmentSuggestion {
  status:        "pending|accepted|rejected|deferred",
  confidence:    "high|medium|low",
  suggestedData: "Born 1922, Sedgwick Co., Kansas. Metal worker.",
  sourceRef:     "NARA AAD, ASN 17136076",
  sourceUrl:     "https://aad.archives.gov/...",
  note:          "",           // free text on defer/reject
  rejectedBy:    null,
  rejectedAt:    null,
  createdAt:     datetime()
})-[:SUGGESTS_FOR]->(:Person)
```

### Text node

Descriptive text is a first-class node, not a property. This separates domain data from editorial content and makes attribution queryable:

```cypher
(:Text {
  markdown:    "...",
  source:      "wikipedia|contributor|image|unknown",
  language:    "no|en|de",
  confidence:  1.0,
  extractedAt: datetime()
})-[:FROM_SOURCE]->(:ExternalSource)

(:Person)-[:DESCRIBED_BY]->(:Text)
(:Station)-[:DESCRIBED_BY]->(:Text)
(:Location)-[:DESCRIBED_BY]->(:Text)
```

---

## 8. Implementation Notes

### 8.1 Backend enrichment service

A lightweight Node.js service. Responsibilities:

- Receive a batch of entity records from Neo4j
- Classify each ASN
- Construct and dispatch NARA AAD queries
- Parse and normalise HTML responses into suggestion objects
- Write `(:EnrichmentSuggestion)` nodes to Neo4j

NARA AAD is a public web interface, not a formal API. Queries are HTTP GET requests; responses are HTML pages. The service must parse the result table. Rate limiting must be respected: no more than one request per second.

### 8.2 Review queue store

The review queue is Neo4j-native — `(:EnrichmentSuggestion)` nodes with `status` property. No separate SQLite or Sanity dataset required.

### 8.3 Frontend review UI

A dedicated review page in the Milorg 2 admin interface. Key requirements:

- Filter by status: Pending / Accepted / Rejected / Deferred
- Filter by entity type: Person / Aircraft / Operation
- Inline source URL link (opens archival record in new tab)
- Accept / Reject / Defer buttons with single-click action
- Free-text reason field on Reject
- Batch accept for high-confidence suggestions (unique ASN match, no ambiguity)

### 8.4 Confidence scoring

Each suggestion carries a confidence level:

- **High** — unique ASN match, name confirmed, single record returned
- **Medium** — name match with minor variation, or multiple records narrowed by birth year / state
- **Low** — partial name match, or officer lookup where enlistment record may differ

High-confidence suggestions may be offered for batch accept. Low-confidence suggestions are always presented individually.

---

## 9. Open Questions

- Should the service run on-demand (triggered manually) or on a schedule (e.g. nightly for new entries)?
- For officer lookups where no enlistment record is found, what external officer record sources are available and trusted?
- Norwegian personnel ASNs follow a different numbering convention — what is the equivalent primary source lookup for KPL / SOE liaison officers such as Herbert Helgesen?
- Should the review queue be part of the main Milorg 2 admin interface, or a standalone tool?
- Group TRYGVE is currently unknown (noted in the BRIDLE mission record). Should unresolved group names trigger a separate research flag separate from the enrichment queue?

---

## 10. Next Steps

- Agree on queue store technology — **recommendation: Neo4j-native** (see section 7)
- Prototype the ASN classifier and NARA AAD parser against the BRIDLE crew list
- Build and test the review queue UI with Jan and Rolf on a small batch of persons
- Define Neo4j schema additions for `(:ExternalSource)`, `(:ExternalRecord)`, `(:EnrichmentSuggestion)`
- Roll out to all persons in the database
- Extend to aircraft enrichment (b24bestweb.com, Movement cards)
- Document findings to support the planned TNA/Kew archive visit

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2025-04-01 | Initial spec — Benny & Claude |
| 1.1.0 | 2026-04-16 | Updated for Neo4j migration — write-back target changed from Sanity to Neo4j, added ExternalSource/Text node model, queue store changed to Neo4j-native |

---

*Foreningen Motstandsbevegelsen i Norge 1940–1945 · milorg2.no*
