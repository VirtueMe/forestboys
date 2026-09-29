/** Shared types for the person/* component family. */

/** The rank a person is known by — `(Person)-[:RANK]->(Rank)` (docs/PERSON-RANKS.md R1). */
export interface KnownRank {
  rankSlug:  string
  rankName:  string
  tier:      number | null
  state:     string | null
  sourceRef: string | null
}

export interface RankOption {
  slug: string
  name: string
  tier: number | null
}

export type PersonType = 'civilian' | 'soldier'
