# Bundle format — packages, and how an import becomes a bundle

How entities travel between graphs, and how what arrives is reviewed. Extends
`PROPOSALS.md` (the review flow and the op vocabulary) and is the format the
outline work stands on (#157, #158, #156). The export feature that will write
packages for other sites is #160, built when someone asks; this document is
what it will stand on. Code: `functions/_lib/bundle-package.ts`,
`functions/_lib/snapshot-diff.ts`.

---

## The idea

A **package** says how entities *should be*. It does not say what to change.
An **import** compares the package with the graph that receives it, and the
difference is a **bundle** of the ops `PROPOSALS.md` already has
(`create-entity`, `set-props`, `add-edge`, …). The receiving site's admin
reviews and accepts that bundle, entity by entity, like any other.

- Importing never writes to the graph. Nothing enters without an accept.
- A changed source gives a new package, a new comparison and a new bundle:
  nothing else is needed to know that something is stale.
- Importing the same package twice gives nothing the second time.

One envelope serves every origin of a bundle: the bot (an outline), the
Sanity sync, and a package. They differ in where the entity snapshots come
from, not in how they are reviewed.

---

## A package

```jsonc
{
  "schemaVersion": 1,
  "origin": {
    "site":    "https://archive.example",     // the archive it was made on
    "madeAt":  "2026-10-07T12:00:00Z",
    "filter":  "transports of type MTB"       // what was selected; informational
  },
  "entities": [ /* entity snapshots, sorted by kind and key */ ]
}
```

### An entity snapshot

```jsonc
{
  "kind": "Transport",
  "key":  "mtb-683",                          // the slug; for a Source its id
  "props": { "canonicalName": "MTB 683", "regser": "683" },
  "descriptions": [ { "order": 1, "content": "[{\"_type\":\"block\", …}]" } ],
  "edges": [ { "type": "USED_BY", "to": "Unit:54-mtb-flotilla", "props": { "from": "1943" } } ],
  "source": { "site": "https://archive.example", "path": "/transport/mtb-683" }
}
```

- **Identity is kind and key.** `<Kind>:<key>` is the entity's id, as in the
  bundles (`entity-ref.ts`). The slug is the key, not a property: it does not
  appear in `props`.
- **`props`** are the node's own properties, without the bridge's bookkeeping
  (below).
- **`descriptions`** hold the Portable Text as the graph stores it: a JSON
  string of blocks, one per `order`.
- **`edges`** are outbound only: an edge belongs to the entity it leaves. `to`
  is a `<Kind>:<key>` reference; the entity it names need not be in the
  package (see *References*).
- **`source`** is where this entity lives in the archive it came from: the
  archive's address and the path to the entity (`entityPath()` follows the
  routes of the application; for a kind without a page the exporter gives the
  path). It is credit and provenance, it is how a later import finds the same
  entity again, and it is how an edge to something outside the package is
  named.
- Lists have a fixed order, so the same entity always gives the same snapshot
  and two packages can be compared.

### What is never in a package

The bookkeeping of the Sanity bridge. It is not content, the bridge keeps it
until the cutover (`SANITY-SYNC.md`), and the day Jan stops editing in Sanity
it is dropped. A package, a bundle and an origin stamp never name a Sanity id
or a Sanity `_rev`.

`isBridgeProp()` decides, by name:

| Not in a package | Examples |
|---|---|
| a name that mentions Sanity | `sanityId`, `sanityRev`, `sanityImportedAt`, `sanityUpdatedAt`, `sanityOutlineId`, `description_sanityUpdatedAt` |
| a hash stamp | `description_sha`, `links_sha`, `date_sha`, `sha` |
| a `<field>_sourceRef` | `lat_sourceRef`: its value is `sanity-migration:<type>:<Sanity document id>:<field>` |
| where the node itself came from | `importedFrom` (set by an import), and the `origin*` stamps of a bundle's products (#157): this archive's history, not the entity's |

`<field>_state` (`candidate`) stays: it says how sure a value is. Outside the
properties, the bridge's nodes (`SyncState`, `Heartbeat`) are not entities and
are not exported. Also never: admin notes (stay and rank notes), users and
sessions, and what an exporter marks restricted (#160).

`validatePackage()` refuses a package that has any of this, a key that
travels as a property, a missing source ref, a description that is not a JSON
list of blocks, or an edge that is not a `<Kind>:<key>` reference.

---

## From a package to a bundle

`diffEntity(snapshot, live)` is a pure function: the live state is given, not
fetched. It returns the ops that make the live entity hold the snapshot, or
nothing.

| The graph has | Ops |
|---|---|
| no such entity | `create-entity` with the props, descriptions and edges |
| a property that differs | `set-props` with `{from, to}`, so a later edit is seen as drift |
| a description that differs, or none | `set-description` with `expectedSha` (the sha of what it replaces, empty when there is none) |
| an edge missing, or with other properties | `add-edge` (the apply merges properties) |

The rules that keep a package from doing harm:

1. **It only adds and changes.** What the live entity has and the snapshot does
   not mention stays: the receiving archive's own properties, descriptions and
   edges are not removed by someone else's package.
2. A property is **removed** by a snapshot value of `null`.
3. Edges are removed only for the types the caller names in
   `authoritativeEdgeTypes`: for a snapshot that is the whole truth about them
   (an outline's absorption).
4. Descriptions are compared as values, not as strings: another way of
   writing the same JSON is not a change.
5. The ops come in a fixed order: properties, descriptions, edges.

`set-description` is new: `modify-block` replaces one existing block by its
key and cannot add or remove one, so a description that gained a paragraph
had no op. The op, the package origin and the guard against bridge metadata
are in ingest and apply (**#161**, `PROPOSALS.md`): a bundle the scripts write
is ingested as it is.

### Matching

Which graph entity a snapshot is compared with is decided by the caller, in
this order, and the comparison is told which it was:

1. **By source ref.** An entity the receiving site made by an earlier import
   from the same `source` (stored as `importedFrom` on it) is *the same
   entity*: a newer package gives changes to it and never a duplicate.
2. **By kind and slug alone.** The slug exists, but was not imported from this
   source: it is **proposed as the same entity**, with a note on the entity in
   the bundle, for the admin to confirm. Never merged silently.
3. **Not found:** `create-entity`.

`diffPackage()` returns, per entity, its ops and (for a match by slug) the
note, plus the list of entities that already hold what the package says.

### References

An edge may point at an entity that is not in the package. The importer finds
it in its own graph by `<Kind>:<key>`, or the bundle waits for it as an
unresolved ref (`PROPOSALS.md`, *blocked* bundles). A package made for sharing
may carry the referenced entities too; one made for a single review (the
conversion in #158) names them.

---

## The scripts

Both read the graph (local, or `--production`'s) and neither writes to it; each is a dry run unless `--write`.

```
npx tsx scripts/bundles/export-package.ts --site=https://archive.example \
    --refs=Transport:mtb-683,Unit:kompani-linge [--refs-file=refs.txt] [--filter="…"] [--write]
npx tsx scripts/bundles/package-to-bundle.ts --package=data/packages/<name>.json \
    [--authoritative-edges=MEMBER_OF] [--write]
```

`export-package` reads each entity (properties, `HAS_CONTENT` descriptions, outbound edges), takes out the
bookkeeping, checks the package and reports what it left out. A kind without a page of its own (an Article, a
Source) gets a placeholder path, and the script says so. `package-to-bundle` finds each entity by `importedFrom`,
else by kind and slug, lists what would change, and with `--write` writes the bundle (`origin: package`) to a
file. It does not send it. Ingest takes it as it is (`bundle-validate.ts`; a test pins this).

An edge belongs to the entity it leaves, so the 272 `MEMBER_OF` edges of the people in `kompani-linge` are in
the **people's** snapshots, not in the unit's. A package of the unit alone does not carry them.

## Earlier absorptions (#158)

Before bundles existed, outlines were absorbed by us: 56 nodes (28 entities and their Descriptions) carry a
`sanityOutlineId`, the one link to their outline. `scripts/migrations/outlines-to-bundles.ts` turns them into **28
outline bundles** (one per outline: `outlineId` is the slug, `outlineRev` the hash of its text, so what an accept
creates carries `originOutline` and `originSha`) and removes them, so the graph holds what Jan wrote in Sanity and
every reshaping is a bundle he accepts.

```
npx tsx scripts/migrations/outlines-to-bundles.ts --site=https://archive.example [--write]   # archive + bundles, in data/outlines-conversion
npx tsx scripts/migrations/outlines-to-bundles.ts --remove [--write]                          # the removal: the owner's, after a dump
```

- **The archive** (`archive.json`) is the package of the entities, the edges *into* them (which a snapshot does not
  hold), and `raw`: every node with all its properties and every edge that touches it, so they can be put back.
- **A bundle** creates the entity (props, description, outbound edges) and has an `add-edge` entity for every other
  entity that pointed into it (the 271 people of `kompani-linge`, the 30 course units). The dry run checks each
  bundle against the archive and against what ingest accepts.
- **Left out of the bundles**, and kept in the archive: an edge from a node that is no entity (a membership note); an
  edge from an entity whose slug is padded with a space, which a bundle cannot name (re-add it once the slug is fixed);
  and a person's `MEMBER_OF` without the import's `sourceRef` (neither the import nor we made it: dropped).
- **The removal** is one transaction, rolled back unless exactly the archive's nodes and edges went and no
  `sanityOutlineId` is left. It refuses when the graph is no longer what the archive saw.
- **Order:** archive and bundles, the removal, then ingest. Accepting a `create-entity` for an entity that still
  exists is refused as drift (`checkEntityExists`), so the order cannot be got wrong the other way.

---

## What this is used for

| Use | Package from | Compared with |
|---|---|---|
| Outlines becoming bundles (#158, #156) | the entities an absorption produces | the live graph, without them |
| Export for other sites (#160, later) | a filter over this graph | the receiving site's graph |

---

## Not decided here

- The origin stamp on the nodes an accepted bundle creates, and the state of
  an outline (#157).
- The export feature: the filter, the zip, who may export (#160).
- A minted id that survives slug renames (#96): only if aliases turn out not
  to be enough.
