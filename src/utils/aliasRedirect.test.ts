import { describe, expect, it } from 'vitest'
import { aliasRedirect } from './aliasRedirect.ts'
import type { QueryFn } from './slugResolver.ts'

/** A pretend database holding aliases as `route|old → new`. */
const db = (aliases: Record<string, string>): QueryFn => (_cypher, params) => {
  const { route, slug } = params as { route: string; slug: string }
  const to = aliases[`${route}|${slug}`]
  return Promise.resolve(to ? [{ slug: to }] : [])
}

describe('aliasRedirect', () => {
  const q = db({ '/person/|old-name': 'new-name', '/map/|gammelt-sted': 'nytt-sted', '/events/|ax-0013': 'ax-13' })

  it('sends an old address to the page, keeping what follows the slug', async () => {
    expect(await aliasRedirect('/person/old-name', q)).toBe('/person/new-name')
    expect(await aliasRedirect('/person/old-name/medlemmer', q)).toBe('/person/new-name/medlemmer')
    expect(await aliasRedirect('/events/ax-0013', q)).toBe('/events/ax-13')
  })
  it('keeps the prefix the reader used: /location/ is a second address of /map/', async () => {
    expect(await aliasRedirect('/location/gammelt-sted', q)).toBe('/location/nytt-sted')
    expect(await aliasRedirect('/map/gammelt-sted', q)).toBe('/map/nytt-sted')
  })
  it('knows nothing of a slug that is no alias, a path that is no page, or the create form', async () => {
    expect(await aliasRedirect('/person/nobody', q)).toBeNull()
    expect(await aliasRedirect('/people', q)).toBeNull()
    expect(await aliasRedirect('/admin/users', q)).toBeNull()
    expect(await aliasRedirect('/person/new', q)).toBeNull()
    expect(await aliasRedirect('/district/old-name', q)).toBeNull()          // a Unit has no aliases
  })
  it('reads an encoded slug', async () => {
    expect(await aliasRedirect('/person/k%C3%A5re', db({ '/person/|kåre': 'kaare' }))).toBe('/person/kaare')
  })
})
