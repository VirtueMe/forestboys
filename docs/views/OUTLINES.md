# OUTLINES

`/outlines/:slug?` — Outlines list and outline detail panel.

## Status

`partial` — the detail page and its editors are written up here; the list (`OutlinesView`) is not.

---

## Detail page (`OutlineDetail.vue`)

Public reading: the description (`HAS_CONTENT`), the gallery, the links (`REFERENCED_IN`) and **Omtalte personer**, the
people the outline mentions (`(:Outline)-[:MENTIONS]->(:Person)`).

An admin has the tabs *Forhåndsvisning / Rediger / Forslag*. **Rediger** holds:

| Editor | Writes | Endpoint |
| --- | --- | --- |
| Bot («Be om forslag») | a request for a proposal bundle | `/api/proposals/*` |
| `DescriptionEditor` | the description sections | `PATCH /api/admin/outline/:slug/sections` |
| `OutlinePeopleEditor` | the mentioned people | `PATCH /api/admin/outline/:slug/people` |

### People (#389)

The people are a plain link: a person is in the list or not, with no role, dates, order or note. `OutlinePeopleEditor`
wraps `RelationListEditor` with `OutlineMentionsStrategy`; the page loads the rows and the picker's targets (every
person) for admins only.

`PATCH …/people` takes `{ people: [slug, …] }` and saves the list as a difference (`saveEdgeSet`): a person still
listed keeps their edge and whatever it carries, a new one gets `state: 'verified', sourceRef: 'admin-edit'`, the rest
go. A slug that is no person is a 400 naming it; an outline that does not exist is a 404.

The Sanity outline sync (`sync-outline.ts`, `docs/SANITY-SYNC.md`) only **adds** `MENTIONS`, and only for an outline whose
people list Sanity has changed since the stamp (`people_sha`). So a removal made here stays until someone edits that
outline's people in Sanity; the sync then adds back every person Sanity names that the graph lacks, a removed one
included. While Sanity is the master of the list, take a person out in both places.
