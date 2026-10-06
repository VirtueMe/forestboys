/**
 * The heading over an event's stations: Base for an incident (AT_STATION),
 * Stasjoner / Fra Base / Til Base for an operation (FROM_STATION / TO_STATION),
 * by which ends it has.
 */
export function stationHeading(kind: string | undefined, from: unknown, to: unknown): string {
  if (kind !== 'operation') return 'Base'
  if (from && to) return 'Stasjoner'
  return from ? 'Fra Base' : 'Til Base'
}
