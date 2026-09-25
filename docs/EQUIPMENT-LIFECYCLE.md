# Equipment lifecycle — possibilities

Discussion document. Nothing here is decided or built. It collects the
options for recording *where equipment came from, where it was used, and
what happened to it*, so Jan, Rolf and Benny can choose before anything
changes in the graph.

---

## What we want to say

From the first discussion (2026-09-25):

- **Manufactured** — in a *country* or at a specific *place*, with a date
  or period.
- **Used in** — one or more countries, each from a start date to an end
  date.
- **Open end** — when "used in" has no end date, it runs *to the end of the
  war in that country* ("til krigens slutt i Norge").
- **Lost in combat** — equipment destroyed or taken during an operation.
- **Never recovered** — lost, and not found again.

---

## Where we are today

`EquipmentType` has 4 nodes (OLGA, BERIT, EUREKA, Rebecca) with:

| Field / edge | Today |
|---|---|
| `type`, `subtype` | Controlled type (`radio`, `navigation`, …) + free subtype |
| `country` | **One** two-letter code (`NO`, `UK`) — no date, no meaning beyond "associated with" |
| `period` | Free text, currently empty on all 4 |
| `PAIRED_WITH` | Symmetric pairing (EUREKA ↔ Rebecca) |
| `USED` (from Incident) | In the schema (`{quantity, role}`), no data yet |

`EquipmentType` is **categorical**: "EUREKA" is the design, not one
physical set. The schema chose this deliberately — individual artifacts
(a museum-held radio) are represented through `Source` (photograph /
artifact), not their own node type.

---

## The central question: type or individual item?

The wishes split cleanly along that line:

| Statement | Is about |
|---|---|
| "Rebecca was manufactured in the UK, <from>–<to>" | the **type** |
| "BERIT was in use in Norway from <date>" | the **type** |
| "The EUREKA set dropped with operation X was lost" | one **individual set** |
| "…and was never recovered" | the **state** of that individual set |

So the choice for loss/recovery is between the two approaches below.

### Option A — type level only, losses through Incidents

Keep `EquipmentType` categorical. A loss is something that *happened*, so
it is an **Incident** — the raid, crash or arrest where the equipment was
lost — linked with the existing `USED` edge:

```
(:Incident)-[:USED {role: 'lost', quantity: 1, recovered: false}]->(:EquipmentType)
```

- "Tapt i kamp" on the equipment page = list of incidents with `role: 'lost'`.
- "Aldri gjenfunnet" = `recovered: false` on that edge, or a later recovery
  Incident with `role: 'recovered'`.
- When / where / who / sources all come from the Incident — nothing to
  duplicate.

**Good:** no new node type; losses sit in their historical context.
**Limit:** can't follow one specific set across several incidents (issued
→ used → hidden → lost).

### Option B — individual items as their own nodes

A new instance node, like `Transport` already is for aircraft (Halifax
NA314 is one airframe, with its own history):

```
(:EquipmentItem {serial?, name?})-[:INSTANCE_OF]->(:EquipmentType)
(:EquipmentItem)-[:USED_IN]->(:Incident)
(:EquipmentItem).status ∈ {in-service, lost, destroyed, captured, recovered, unknown}
```

**Good:** full history per set; "never recovered" is a plain status.
**Limit:** new kind to build and maintain (detail page, editor, Registre);
only worth it where sources actually identify individual sets (serial
numbers, named sets).

A middle path is possible: start with **A**, and introduce **B** only for
sets the sources name individually.

---

## Manufactured / used in — shape

Both are "something about this equipment, in a place, between two dates",
so they can share one shape — a lifecycle entry:

| Field | Meaning |
|---|---|
| `kind` | `manufactured` \| `in-service` (extensible: `issued`, `captured`, …) |
| where | a **country**, or a specific **Location** (factory town, depot), or both |
| `from`, `to` | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; `to` may be empty |
| sources | citations, as elsewhere |

How to store it:

| Storage | For | Against |
|---|---|---|
| **Edges to Country / Location nodes** — `(e)-[:MANUFACTURED_IN {from,to}]->(:Country\|:Location)`, `(e)-[:IN_SERVICE {from,to}]->(:Country)` | Queryable ("all equipment in service in Norway 1944"); follows the schema rule *anything with its own lifecycle is a node* | Needs Country nodes (below) |
| **JSON list on the node** — `lifecycle: '[{kind, country, from, to}]'` | Quick, no new node types | Invisible to graph queries; the same second-class shape as the legacy Station `links` field |

---

## Countries as nodes

Today `country` is a bare code on Organization, Unit and EquipmentType.
Rank has its own `countries` list (`be2b0a5`). A `:Country` node would
give one place to hang country facts:

```
(:Country {code: 'NO', name: 'Norge', warEnd: '1945-05-08'})
```

- Makes the **open end** answerable: "til krigens slutt i Norge
  (8. mai 1945)" — the page reads `warEnd` from the country.
- Lets Rank, Organization, Unit and Equipment point at the same nodes.
- **Cost:** a migration converting existing `country` codes to edges, done
  consistently across all kinds, not just equipment.

Without Country nodes, the open end can still be *shown* with a small
lookup table in code (code → name → war-end date), at the price of the
dates living in code rather than in the data Jan edits.

---

## War-end dates — needs an editorial decision

"To the end of the war in that country" is not one date:

| Country | Candidates |
|---|---|
| Norway | 8 May 1945 (capitulation in Norway) |
| UK | 8 May 1945 (VE Day) or 2 September 1945 (VJ Day) |
| USA | 8 May 1945 (VE Day) or 2 September 1945 (VJ Day) |
| Denmark | 5 May 1945 (liberation) |
| Sweden | not at war — "to end of war" may not apply |

---

## Open questions

1. **Individual sets** — do the sources track individual sets (serials,
   named sets) often enough to justify Option B, or is A (type level +
   Incidents) enough for now?
2. **War-end dates** — which date per country (table above)? Is "European
   war" (VE) the right end for the Allies in this project?
3. **Country nodes** — introduce now for equipment, or later as one
   migration across Organization / Unit / Rank / Equipment?
4. **Manufactured** — is a period (`from`–`to`) needed, or is a single
   date/year enough?
5. **Other states** — beyond lost / never recovered: *captured* (taken by
   the enemy), *destroyed deliberately* (scuttled to avoid capture),
   *hidden* (cached, e.g. radio sets buried and dug up later)?
