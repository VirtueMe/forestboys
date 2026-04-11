# Sanity → Neo4j Mapping

Documents in Sanity map to **nodes** in Neo4j.
References between documents map to **edges** (relationships).
Scalar fields become **node properties**.

---

## Node Labels

| Sanity `_type` | Neo4j label    | Identity property |
|----------------|----------------|-------------------|
| `event`        | `Event`        | `slug`            |
| `person`       | `Person`       | `slug`            |
| `location`     | `Location`     | `slug`            |
| `station`      | `Station`      | `slug`            |
| `transport`    | `Transport`    | `slug`            |
| `outline`      | `Outline`      | `slug`            |
| `organization` | `Organization` | `name`            |
| `district`     | `District`     | `name`            |

---

## Node Properties

### Event
| Sanity field  | Neo4j property | Notes                        |
|---------------|----------------|------------------------------|
| `_id`         | `sanityId`     | kept for traceability        |
| `slug`        | `slug`         | unique constraint            |
| `title`       | `title`        |                              |
| `date`        | `date`         | ISO string `YYYY-MM-DD`      |
| `description` | `description`  | plain text (blocksToText)    |

### Person
| Sanity field  | Neo4j property | Notes                        |
|---------------|----------------|------------------------------|
| `_id`         | `sanityId`     |                              |
| `slug`        | `slug`         | unique constraint            |
| `name`        | `name`         |                              |
| `secretName`  | `secretName`   |                              |
| `home`        | `home`         |                              |
| `birthYear`   | `birthYear`    |                              |
| `description` | `description`  | plain text                   |

### Location
| Sanity field        | Neo4j property | Notes                     |
|---------------------|----------------|---------------------------|
| `_id`               | `sanityId`     |                           |
| `slug`              | `slug`         | unique constraint         |
| `title`             | `title`        |                           |
| `coordinates.lat`   | `lat`          |                           |
| `coordinates.lng`   | `lng`          |                           |
| `description`       | `description`  | plain text                |

### Station
| Sanity field        | Neo4j property | Notes                     |
|---------------------|----------------|---------------------------|
| `_id`               | `sanityId`     |                           |
| `slug`              | `slug`         | unique constraint         |
| `title`             | `title`        |                           |
| `type`              | `type`         | e.g. airfield, radio      |
| `coordinates.lat`   | `lat`          |                           |
| `coordinates.lng`   | `lng`          |                           |
| `description`       | `description`  | plain text                |

### Transport
| Sanity field  | Neo4j property | Notes                        |
|---------------|----------------|------------------------------|
| `_id`         | `sanityId`     |                              |
| `slug`        | `slug`         | unique constraint            |
| `name`        | `name`         |                              |
| `type`        | `type`         | e.g. aircraft, boat, MTB     |
| `unit`        | `unit`         | squadron / flotilla          |
| `regser`      | `regser`       | registration / serial number |
| `reserve`     | `reserve`      |                              |
| `description` | `description`  | plain text                   |

### Outline
| Sanity field  | Neo4j property | Notes                        |
|---------------|----------------|------------------------------|
| `_id`         | `sanityId`     |                              |
| `slug`        | `slug`         | unique constraint            |
| `title`       | `title`        |                              |
| `description` | `description`  | plain text                   |

### Organization
| Sanity field | Neo4j property | Notes            |
|--------------|----------------|------------------|
| `name`       | `name`         | unique constraint |
| `color`      | `color`        | hex string        |

### District
| Sanity field | Neo4j property | Notes            |
|--------------|----------------|------------------|
| `name`       | `name`         | unique constraint |

---

## Relationships (Edges)

| From       | Relationship      | To           | Sanity source              |
|------------|-------------------|--------------|----------------------------|
| `Event`    | `ORGANISED_BY`    | `Organization` | `event.organization`     |
| `Event`    | `IN_DISTRICT`     | `District`   | `event.district`           |
| `Event`    | `ORIGIN`          | `Location`   | `event.locationFrom`       |
| `Event`    | `DESTINATION`     | `Location`   | `event.locationTo`         |
| `Event`    | `DEPARTED_FROM`   | `Station`    | `event.stationFrom`        |
| `Event`    | `ARRIVED_AT`      | `Station`    | `event.stationTo`          |
| `Event`    | `INVOLVED`        | `Person`     | `event.people[]`           |
| `Event`    | `USED`            | `Transport`  | `event.transport[]`        |
| `Location` | `STATIONED`       | `Person`     | `location.people[]`        |
| `Station`  | `TRAINED`         | `Person`     | `station.people[]`         |
| `Outline`  | `INCLUDES`        | `Person`     | `outline.people[]`         |

---

## What is currently lost (not yet in the graph)

These exist only as free text inside `description` blocks today.
They are candidates for future structured fields once the LLM extraction
pipeline is in place.

| Data                        | Example from source text                        | Future graph shape                              |
|-----------------------------|-------------------------------------------------|-------------------------------------------------|
| Full crew (non-captain)     | `Nav. Sutton. L.N. RAF`, `F/S Heeley F A/B`    | `(Event)-[:INVOLVED {role:"Nav"}]->(Person)`   |
| Role in event               | `Pilot`, `Nav`, `A/B`, `W/Op`, `A/G`, `F/Eng` | property on `INVOLVED` edge                     |
| Service number              | `Can.R. 225072`, `NZ.429185`                   | property on `Person` node                       |
| Mission outcome             | `C` (completed) / `NC` + reason                | `outcome`, `outcomeReason` on `Event`           |
| Sub-day timing              | `Out: 17:30`, `Drop: 22:31`                    | `departureTime`, `dropTime` on `Event`          |
| Cargo                       | `CON: 13`, `PAK: 3`                            | `containers`, `packages` on `Event`             |
| Drop zone coordinates       | `60.26.10N - 09.56.10E`                        | `dropLat`, `dropLng` on `DESTINATION` edge      |
| Archival source references  | `AIR-27-956-8 p6`, `HS7-182 s 49`             | `(Event)-[:SOURCED_FROM]->(ArchiveRecord)`      |
| BBC signal / operation code | `Særmelding: "Blafrende fikenblad"`            | `bbcCode`, `operationCode` on `Event`           |
| EUREKA / GEE usage          | `EUREKA: NA`, `GEE: NA`                        | properties on `Event`                           |

---

## Not mapped (media / presentation only)

These fields have no place in the graph — they belong in the app layer.

| Sanity field | Reason                                      |
|--------------|---------------------------------------------|
| `gallery[]`  | Image assets — stays in Sanity/CDN          |
| `movie`      | Video file — stays in Sanity/CDN            |
| `links[]`    | External URLs — stays in Sanity or app      |
