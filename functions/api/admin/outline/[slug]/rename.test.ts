import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 1, name: 'A', role: 'admin' })) }))
vi.mock('~/_lib/sitemap.ts', () => ({ invalidateSitemap: vi.fn(() => Promise.resolve()) }))
vi.mock('~/_lib/slug-rename.ts', () => ({ planRename: vi.fn(), renameSlug: vi.fn() }))
vi.mock('~/_lib/entity-records.ts', () => ({ listRecords: vi.fn() }))

const { planRename, renameSlug } = await import('~/_lib/slug-rename.ts')
const { listRecords } = await import('~/_lib/entity-records.ts')
const rename = await import('./rename.ts')
const preview = await import('./rename-preview.ts')

/** An R2 bucket holding these objects and nothing else. */
const bucket = (objects: Record<string, unknown> = {}) => ({
  get: (key: string) => Promise.resolve(key in objects ? { json: () => Promise.resolve(objects[key]) } : null),
})

const call = (mod: { onRequestPost: unknown }, objects: Record<string, unknown> = {}, body: unknown = { slug: 'new-name' }) =>
  (mod.onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }),
    env: { PROPOSALS: bucket(objects) }, params: { slug: 'old-name' }, waitUntil: () => {},
  })

const manifest = (status: string) => ({ entities: [{ entityId: 'Person:a', status }] })
const made = (status: string) => ({
  'proposals/by-outline/old-name/index.json': { bundleIds: ['b1'] },
  'proposals/bundles/b1/manifest.json': manifest(status),
})

beforeEach(() => {
  vi.mocked(listRecords).mockReset().mockResolvedValue([])
  vi.mocked(planRename).mockReset().mockResolvedValue({ label: 'Outline', route: '/outlines/', from: 'old-name', to: 'new-name', rewrites: [{ eid: '1', before: '', after: '', links: 3 }], restoresAlias: false, ownDescriptions: 1 })
  vi.mocked(renameSlug).mockReset().mockResolvedValue({ ok: true, label: 'Outline', from: 'old-name', to: 'new-name', descriptions: 1, links: 3, skipped: 0 })
})

describe('outline rename', () => {
  it('the preview says what would change and renames nothing', async () => {
    const res = await call(preview)
    expect(await res.json()).toEqual({ ok: true, from: 'old-name', to: 'new-name', descriptions: 1, links: 3, restoresAlias: false })
    expect(renameSlug).not.toHaveBeenCalled()
  })

  it('renames and answers with the new slug', async () => {
    const res = await call(rename)
    expect(await res.json()).toEqual({ ok: true, slug: 'new-name', descriptions: 1, links: 3, skipped: 0 })
    expect(renameSlug).toHaveBeenCalledWith(expect.anything(), { label: 'Outline', from: 'old-name', to: 'new-name' })
  })

  it('is refused while a bot job is pending, until the marker has expired', async () => {
    const marker = (ms: number) => ({ 'proposals/pending-generations/old-name.json': { expiresAt: new Date(Date.now() + ms).toISOString() } })
    expect((await call(rename, marker(60_000))).status).toBe(409)
    expect((await call(preview, marker(60_000))).status).toBe(409)
    expect(renameSlug).not.toHaveBeenCalled()
    expect((await call(rename, marker(-60_000))).status).toBe(200)
  })

  it('is refused while a bundle made from the outline has something pending, not once it is decided', async () => {
    expect((await call(rename, made('pending'))).status).toBe(409)
    expect(renameSlug).not.toHaveBeenCalled()
    expect((await call(rename, made('accepted'))).status).toBe(200)
  })

  it('is refused while another bundle waits to change the outline', async () => {
    vi.mocked(listRecords).mockResolvedValue([{ bundleId: 'b2', status: 'pending' }] as never)
    expect((await call(rename)).status).toBe(409)
    expect(listRecords).toHaveBeenCalledWith(expect.anything(), 'Outline:old-name')
    expect(renameSlug).not.toHaveBeenCalled()
  })

  it('passes on what the rename refuses, and wants a slug', async () => {
    vi.mocked(renameSlug).mockResolvedValue({ error: 'Slug finnes allerede: new-name', status: 409 })
    expect((await call(rename)).status).toBe(409)
    expect((await call(rename, {}, {})).status).toBe(400)
  })
})
