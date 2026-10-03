import { ref } from 'vue'
import { authFetch } from './useAuth.ts'

/** How many access requests wait for an admin; the badge in the admin menu. */
export const pendingCount = ref(0)

/** Refreshes the count. Quiet on failure: a badge is not worth an error message. */
export async function refreshPendingCount(): Promise<void> {
  try {
    const res = await authFetch('/api/admin/users')
    if (!res.ok) return
    const body = await res.json() as { pending?: number }
    pendingCount.value = body.pending ?? 0
  } catch { /* leave the count as it was */ }
}
