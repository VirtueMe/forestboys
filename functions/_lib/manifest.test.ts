import { describe, expect, it } from 'vitest'
import { buildManifest } from './manifest.ts'
import { SITE_DEFAULTS } from './site-settings.ts'

describe('buildManifest', () => {
  it('takes name and short_name from the site setting', () => {
    const m = buildManifest({ name: 'Motstandsbevegelsen', shortName: 'MB' })
    expect(m.name).toBe('Motstandsbevegelsen')
    expect(m.short_name).toBe('MB')
  })

  it('keeps the rest of the manifest fixed', () => {
    const m = buildManifest(SITE_DEFAULTS)
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.id).toBe('/')
  })

  it('declares each icon as any and as maskable, never both on one entry', () => {
    const { icons } = buildManifest(SITE_DEFAULTS)
    expect(icons.map(i => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '192x192 maskable', '512x512 any', '512x512 maskable'])
    expect(new Set(icons.map(i => i.src))).toEqual(new Set(['/icons/icon-192.png', '/icons/icon-512.png']))
  })
})
