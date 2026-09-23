/**
 * usePlaceRoute — where a link to a Location should go.
 *
 * Admins land on the Location detail page (/location/:slug), where the
 * place can be edited. Everyone else gets the map (/map/:slug) — the
 * public way to see a place in context.
 */
import { useAuth } from './useAuth.ts'

export function usePlaceRoute() {
  const { user } = useAuth()
  return (slug: string): string =>
    user.value?.role === 'admin' ? `/location/${slug}` : `/map/${slug}`
}
