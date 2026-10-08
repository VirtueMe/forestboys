/** Why accept refused an entity, in words (#185): what the reviewer reads on the entity and in «Godkjenn alle». */

export interface Refusal { prop: string; expected: unknown; actual: unknown }

function shown(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(tom)'
  return typeof v === 'string' ? `«${v}»` : JSON.stringify(v)
}

/** One refusal: the entity already exists, or a property (or description) changed since the proposal was made. */
export function refusalText(r: Refusal): string {
  if (r.prop === 'entity') return 'Finnes allerede i grafen.'
  return `${r.prop} er endret siden forslaget ble laget: forventet ${shown(r.expected)}, nå ${shown(r.actual)}.`
}

export function refusalsText(rs: readonly Refusal[]): string {
  return rs.map(refusalText).join(' ')
}
