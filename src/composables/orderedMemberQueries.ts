/**
 * The Cypher for the lists an editor orders by hand (#355). Kept apart from the views and strategies that run it so the
 * Neo4j test can run the same text against the local graph.
 */

/** The organisation's units, in the order the editor set (#355): the position wins, no description-last. */
export const ORG_UNITS_QUERY = `
      MATCH (u:Unit)-[r:PART_OF]->(o:Organization {slug: $slug})
      OPTIONAL MATCH (o)-[:HAS_MEMBER_UNIT_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH u, r, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH u, r, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH u, r,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH u, r, collect(section) AS rawSections
      RETURN u.slug          AS targetSlug,
             u.canonicalName AS targetName,
             r.role          AS role,
             r.order         AS \`order\`,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY coalesce(r.order, 999), targetName
    `

/** The unit's own members, in the order the editor set (#355); the ones without, by date and name as before. */
export const UNIT_MEMBERS_QUERY = `
      MATCH (p:Person)-[m:MEMBER_OF]->(u:Unit {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_MEMBERSHIP_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, m, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, m, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, m, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, m, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             m.role AS role, m.startDate AS startDate, m.endDate AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY coalesce(m.order, 999), m.startDate, targetName
    `

/** The people of a course, in the order the editor set (enrolment order, #355); the ones without, by date and name. */
export const UNIT_ATTENDEES_QUERY = `
      MATCH (p:Person)-[a:ATTENDED]->(u:Unit {slug: $slug})
      OPTIONAL MATCH (p)-[:HAS_ATTENDANCE_NOTE]->(d:Description)-[:ABOUT_UNIT]->(u)
      OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
      WITH p, a, d, from
      OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
      WITH p, a, d, from,
           collect(CASE WHEN src IS NULL THEN NULL ELSE {
             inline:       coalesce(cites.inline, false),
             sourceId:     src.id,
             sourceTitle:  src.title,
             sourceUrl:    src.url,
             sourceAuthor: src.authorFreeText
           } END) AS rawCites
      WITH p, a, d, from,
           CASE WHEN d IS NULL THEN NULL ELSE {
             order:     coalesce(d.order, 1),
             content:   d.content,
             citations: [x IN rawCites WHERE x IS NOT NULL],
             sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
               id:             from.id,
               title:          from.title,
               url:             from.url,
               authorFreeText: from.authorFreeText,
               license:        from.license,
               attribution:    from.attribution
             } END
           } END AS section
      WITH p, a, collect(section) AS rawSections
      RETURN p.slug AS targetSlug, p.canonicalName AS targetName,
             a.passed AS passed, a.startDate AS startDate, a.endDate AS endDate,
             [x IN rawSections WHERE x IS NOT NULL] AS sections
      ORDER BY coalesce(a.order, 999), a.startDate, targetName
    `

/**
 * The unit's members with those of its sub-units (#355). The unit's own members come first, in the order the
 * editor set; the rest, and any without an order, by name. A person who is on several edges takes the lowest
 * order of the edges that go straight to this unit.
 */
export const UNIT_MEMBERS_PAGE_QUERY = `
  MATCH (p:Person)-[m:MEMBER_OF]->(mu:Unit)-[:PART_OF*0..]->(u:Unit {slug: $slug})
  OPTIONAL MATCH (p)-[:RANK]->(r:Rank)
  WHERE r.canonicalName <> 'Menig'
  WITH p, r, collect(m) AS edges,
       collect(CASE WHEN mu = u THEN coalesce(m.order, 999) ELSE 999 END) AS orders
  WITH p, r, orders,
       head([e IN edges WHERE e.description IS NOT NULL] + edges) AS m
  RETURN p.slug AS slug, p.canonicalName AS name,
         r.abbreviation AS rank, p.status AS status,
         m.role AS role, m.description AS description,
         m.sourceRefs AS sourceRefs,
         m.startDate AS startDate, m.endDate AS endDate
  ORDER BY reduce(o = 999, x IN orders | CASE WHEN x < o THEN x ELSE o END), name`
