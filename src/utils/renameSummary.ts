/**
 * What the editor tells before a slug is changed (#96): the new address, and how many links in how many descriptions are
 * rewritten to it. Pure, so the Norwegian numbers are testable.
 */

export interface RenamePreview {
  from:          string
  to:            string
  descriptions:  number
  links:         number
  restoresAlias: boolean
}

const lenker = (n: number) => (n === 1 ? '1 lenke' : `${n} lenker`)
const beskrivelser = (n: number) => (n === 1 ? '1 beskrivelse' : `${n} beskrivelser`)

/** «12 lenker i 5 beskrivelser oppdateres.» or that there is nothing to update. */
export function linksSummary(p: Pick<RenamePreview, 'descriptions' | 'links'>): string {
  if (!p.links) return 'Ingen lenker i beskrivelser peker på den gamle adressen.'
  return `${lenker(p.links)} i ${beskrivelser(p.descriptions)} oppdateres til den nye adressen.`
}
