import { describe, expect, test } from 'vitest'
import { tools } from '@ream/tools'
import { allRoutes, legacyPath, parseRoute, pathOf, toolPath, type Route } from './routes'

describe('routes', () => {
  test('every page round-trips through its path, which ends in a slash', () => {
    const routes: Route[] = [{ page: 'landing' }, { page: 'tools', cat: 'all' }, { page: 'tools', cat: 'pdf' }, { page: 'tools', cat: 'image' }, { page: 'tool', id: 'merge-pdf' }, { page: 'licence' }, { page: 'notices' }]
    for (const r of routes) {
      const path = pathOf(r)
      expect(parseRoute(path)).toEqual(r)
      expect(path.endsWith('/')).toBe(true)
    }
    expect(toolPath('compress-pdf')).toBe('/tool/compress-pdf/')
  })

  test('a path with or without its closing slash, a query or a hash is the same page', () => {
    for (const p of ['/tool/merge-pdf', '/tool/merge-pdf/', '/tool/merge-pdf?x=1', '/tool/merge-pdf/#top']) expect(parseRoute(p)).toEqual({ page: 'tool', id: 'merge-pdf' })
    expect(parseRoute('')).toEqual({ page: 'landing' })
    expect(parseRoute('//')).toEqual({ page: 'landing' })
  })

  test('addresses that are not pages are not found', () => {
    for (const p of ['/tools/video/', '/tool/', '/tool/a/b/', '/tool/not valid/', '/licence/x/', '/nothing/', '/index.html', '/404.html', '/sw.js']) {
      expect(parseRoute(p), p).toEqual({ page: 'notFound' })
    }
  })

  test('old hash links become paths, other hashes are left alone', () => {
    expect(legacyPath('#/tool/merge-pdf')).toBe('/tool/merge-pdf/')
    expect(legacyPath('#/tools')).toBe('/tools/')
    expect(legacyPath('#/tools/image')).toBe('/tools/image/')
    expect(legacyPath('#/licence')).toBe('/licence/')
    expect(legacyPath('#/')).toBe('/')
    expect(legacyPath('#/nothing')).toBeNull()
    expect(legacyPath('#section')).toBeNull()
    expect(legacyPath('')).toBeNull()
  })

  test('the build writes a page for the landing page, the tools home, each category, every ready tool, the licence and the notices', () => {
    const ready = tools.filter((t) => t.status === 'ready')
    const all = allRoutes(tools)
    expect(all.filter((r) => r.page === 'tool')).toHaveLength(ready.length)
    expect(new Set(all.map(pathOf)).size).toBe(all.length)
    expect(all.some((r) => r.page === 'notFound')).toBe(false)
    expect(all.length).toBe(ready.length + 6)
  })
})
