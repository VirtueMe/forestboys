import type { LocationQueryValue, Router } from 'vue-router'

export const PROPOSAL_LIST_PATH = '/admin/proposals'

/**
 * Leave a bundle that was just deleted for the list. `replace`, not `push` or
 * `back`: the entry behind this page may be the deleted bundle itself.
 */
export function leaveDeletedBundle(router: Router, bundleId: string): Promise<unknown> {
  return router.replace({ path: PROPOSAL_LIST_PATH, query: { deleted: bundleId } })
}

/** The bundle id the list was sent here to confirm as deleted, or null. */
export function deletedBundleFromQuery(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return v ? v : null
}
