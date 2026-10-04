/**
 * «Har deltatt på» on the person page: the courses a person attended and the
 * station links whose role is flagged `attended` (training, instructor),
 * merged into one list. The rest of the station links stay under
 * «Stasjonert på». Pure, so the split and the order are testable.
 */
import { comparePartial } from './period.ts'

/** Splits station links by whether their role is flagged `attended`. A link without a role is not. */
export function splitByAttended<T extends { role?: string | null }>(
  entries: readonly T[],
  isAttended: (role: string) => boolean,
): { attended: T[]; stationed: T[] } {
  const attended: T[] = []
  const stationed: T[] = []
  for (const e of entries) (e.role && isAttended(e.role) ? attended : stationed).push(e)
  return { attended, stationed }
}

/** Dated rows first, oldest first (partial dates compare by the part both know); undated rows by name. */
export function sortAttended<T extends { startDate: string | null; targetName: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.startDate && b.startDate) {
      return comparePartial(a.startDate, b.startDate) || a.targetName.localeCompare(b.targetName, 'nb')
    }
    if (a.startDate) return -1
    if (b.startDate) return 1
    return a.targetName.localeCompare(b.targetName, 'nb')
  })
}
