/** Shared types for the person/* component family. */

export interface HeldRank {
  rankSlug: string
  rankName: string
  tier:     number | null
  from:     number | null
  to:       number | null
}

export interface RankOption {
  slug: string
  name: string
  tier: number | null
}

export type PersonType = 'civilian' | 'soldier'
