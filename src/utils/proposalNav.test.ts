import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { deletedBundleFromQuery, leaveDeletedBundle } from './proposalNav.ts'

const stub = { template: '<div />' }
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/proposals',            component: stub },
      { path: '/admin/proposals/:bundleId',  component: stub },
    ],
  })
}

describe('leaveDeletedBundle', () => {
  it('lands on the list and names the deleted bundle', async () => {
    const router = makeRouter()
    await router.push('/admin/proposals/b1')
    await leaveDeletedBundle(router, 'b1')
    expect(router.currentRoute.value.path).toBe('/admin/proposals')
    expect(router.currentRoute.value.query.deleted).toBe('b1')
  })

  it('does not leave the deleted bundle one step back in history', async () => {
    const router = makeRouter()
    await router.push('/admin/proposals')
    await router.push('/admin/proposals/b1')
    await leaveDeletedBundle(router, 'b1')
    router.back()
    await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.path).not.toBe('/admin/proposals/b1')
  })
})

describe('deletedBundleFromQuery', () => {
  it('reads a single value', () => expect(deletedBundleFromQuery('b1')).toBe('b1'))
  it('reads the first of several', () => expect(deletedBundleFromQuery(['b1', 'b2'])).toBe('b1'))
  it('is null when absent or empty', () => {
    expect(deletedBundleFromQuery(undefined)).toBeNull()
    expect(deletedBundleFromQuery('')).toBeNull()
  })
})
