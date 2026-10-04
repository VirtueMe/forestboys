# Roles — requirements

Requirements for managing **relation roles** (kurér, operatør, Fange, …)
as editable data with a name and a description, instead of hard-coded
lists. Draft for review.

---

## Why

Roles are hard-coded today, in several places, some duplicated:

| List | Used for | Where |
|---|---|---|
| `ROLE_LABEL` | Membership (Person → Unit): operatør, kurér, radiotelegrafist, vert, informant, medlem, … | `relation/strategies.ts`, copied in `UnitEditPane.vue` and `UnitViewPane.vue` |
| `PART_OF_ROLE_LABEL` | Unit in organization: administrativt, operativt, sponsor, overordnet | `relation/strategies.ts`, mirrored by hand in the backend's `VALID_ROLES` |
| Crew roles | Transport participants (pilot, navigatør, dispatcher, …) | planned |
| Stationed-at roles | Stasjonert, I skjul, Fange, … | seeded — see `PERSON-STATIONED-AT.md` |

Changing or explaining a role means a code change in several files, and
visitors see a bare word ("vert", "sponsor") with no explanation of what
it means in this archive.

---

## Requirements

### Data

**R1 — Role nodes.** `(:Role {key, name, scopes})`.

| Field | Meaning |
|---|---|
| `key` | Stable identifier stored on edges (`courier`, `host`). Kebab/lowercase. |
| `name` | Norwegian display name (`kurér`, `vert`) |
| `scopes` | Which relations the role applies to — one role can serve several |

**R1b — Description with sources.** The explanation shown to visitors is
a Description node, not a text property — the same model as entity
descriptions:

```
(:Role)-[:HAS_CONTENT]->(:Description {order, content})
(:Description)-[:CITES {inline}]->(:Source)
(:Description)-[:SOURCED_FROM]->(:Source)
```

- Edited with the existing `DescriptionEditor` (rich text, "Kilder",
  "Gjengitt fra") — no new editor.
- Kept short in practice (1–3 sentences); normally a single section.
- Sources make a definition checkable — e.g. what "vert" meant in Milorg
  usage, backed by a page in a book.

**R2 — Scopes.** Initial list:

| `scope` | Relation | UI name |
|---|---|---|
| `membership` | `Person -[:MEMBER_OF]-> Unit / Organization` | Medlemskap |
| `part-of` | `Unit -[:PART_OF]-> Organization` | Enhet i organisasjon |
| `stationed` | `Person -[:STATIONED_AT]-> Location / Station` | Stasjonert på |
| `crew` | Person on a Transport | Mannskap |
| `involvement` | `Person -[:INVOLVED_IN]-> Incident` | Involvert i hendelse |

**R3 — Edges keep storing the key.** `role: 'courier'` on the edge, as
today. Existing data keeps working unchanged; renaming a role changes
its `name`, never its `key`.

**R4 — Key is immutable** once created. Name, description and scopes are
freely editable.

### Admin page

**R5 — "Roller" under Oppslag**, next to Grader (`/admin/roles`). Same
pattern: list grouped by scope, inline Rediger, "+ Ny rolle". Rediger
includes the Beskrivelse editor with sources (R1b).

**R6 — Usage count.** Each role shows how many links use it, per scope.

**R7 — Delete only when unused**, like Grader and Kilder.

**R8 — Removing a scope** from a role that is still used in that scope is
blocked, with the count shown ("brukt av 12 medlemskap").

### Editors

**R9 — Role pickers read Role nodes** for their scope, sorted by name,
instead of hard-coded lists. The description shows as help text under
the picker when a role is selected.

**R10 — Backend validates against Role nodes** (key exists and has the
scope), replacing hard-coded `VALID_ROLES`.

### Display — the role explanation

**R11 — Every role shown to visitors can explain itself.** Wherever a
role label appears (relation rows on Person / Unit / Organization /
Station pages, info popups, headers), the description is reachable from
the label.

**R12 — The label is the trigger**, not a separate (i). Relation rows
already use an (i) marker to mean *"this specific link has a note"*;
a second (i) for the role would be ambiguous. Instead:

- role labels with a description get a subtle dotted underline;
- click / tap (and keyboard Enter) opens a small popover with the role
  name, the description, and its sources as citation chips
  (`SourceRef`) — the same popover style as source chips elsewhere;
- hover shows the text on desktop (sources in the click popover only).

**R13 — No description, no affordance.** A role without a description
renders as plain text, as today.

**R14 — Accessible.** The label is a button with
`aria-label="Forklaring: <name>"`; the popover closes on Escape and on
outside click.

### Migration

**R15 — Seed Role nodes from today's code lists**, same keys, current
Norwegian names, no descriptions — Jan writes them, with sources, on the
Roller page. Roles in both `ROLE_LABEL` and `PART_OF_ROLE_LABEL` become
one node with both scopes.

**R16 — Report unknown keys.** Any `role` value found on edges that has
no seed entry is listed before import (bulk-op rule: zero unexplained
values).

**R17 — Remove the hard-coded lists** once pickers, views and backend
read Role nodes.

**R18 — Section flag.** A role that applies to the `stationed` scope can be
flagged `attended` (`Role.attended`, a boolean, absent = false). Links with
such a role (opplæring, instruktør) are shown under «Har deltatt på» on the
person page instead of «Stasjonert på». Set with a checkbox in the role form
(only offered while the stationed scope is ticked); dropping the scope clears
it. Roles stay data: nothing in the views lists role keys.

---

## Open questions

1. **Scope list** — is R2 complete? Are Operation participation roles
   (`PARTICIPATED_IN`) a separate scope from Incident involvement?
2. **Same key, different meaning** — can one key mean slightly different
   things per scope (e.g. "operatør" for a person in a unit vs. at a
   radio station)? If yes: description per scope, or separate roles?
3. **English names** — needed alongside Norwegian (for crew roles taken
   from RAF records), or Norwegian only?
4. **Description length** — enforce a limit (popover space), or trust
   editors to keep it short, with the popover expanding in place ("Les
   mer") for longer texts? (The Roller page is admin-only, so visitors
   can't be sent there.)

---

## Later

- **Editable role groups.** Groups (scopes) are fixed in code today: each
  one maps to the edge that stores the role
  (`functions/_lib/role-scopes.ts`), with Norwegian labels in
  `src/utils/roleScopes.ts`. Making them editable would mean storing the
  label (and possibly a description) as data, while the group → edge
  mapping stays in code — a new relation still needs code to read and
  write its `role`.
