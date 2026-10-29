import { describe, expect, test } from 'vitest'
import { findTool, tools } from '@ream/tools'
import { allRoutes, legacyPath, parseRoute, pathOf, toolPath, type Route } from './routes'

const tool = (id: string) => findTool(id)!

describe('routes', () => {
  test('every page round-trips through its path, which ends in a slash', () => {
    const routes: Route[] = [{ page: 'landing' }, { page: 'tools', cat: 'all' }, { page: 'tools', cat: 'pdf' }, { page: 'tools', cat: 'image' }, { page: 'tool', tool: tool('merge-pdf') }, { page: 'licence' }, { page: 'notices' }]
    for (const r of routes) {
      const path = pathOf(r)
      expect(parseRoute(path)).toEqual(r)
      expect(path.endsWith('/')).toBe(true)
    }
  })

  test('a tool lives under its own kind, never under /tool/', () => {
    expect(toolPath(tool('sign-pdf'))).toBe('/tools/pdf/sign-pdf/')
    expect(toolPath(tool('resize-image'))).toBe('/tools/image/resize-image/')
    for (const t of tools) {
      expect(toolPath(t)).toBe(`/tools/${t.category}/${t.id}/`)
      expect(parseRoute(toolPath(t))).toEqual({ page: 'tool', tool: t })
    }
  })

  test('a path with or without its closing slash, a query or a hash is the same page', () => {
    for (const p of ['/tools/pdf/merge-pdf', '/tools/pdf/merge-pdf/', '/tools/pdf/merge-pdf?x=1', '/tools/pdf/merge-pdf/#top']) expect(parseRoute(p)).toEqual({ page: 'tool', tool: tool('merge-pdf') })
    expect(parseRoute('')).toEqual({ page: 'landing' })
    expect(parseRoute('//')).toEqual({ page: 'landing' })
  })

  test('addresses that are not pages are not found, a missing tool and a tool under the wrong kind included', () => {
    for (const p of [
      '/tools/pdf/no-such-tool/', // no such tool
      '/tools/image/sign-pdf/', // a PDF tool under images
      '/tools/pdf/resize-image/', // an image tool under PDFs
      '/tools/video/', '/tools/video/merge-pdf/', '/tools/pdf/merge-pdf/extra/',
      '/tool/merge-pdf/', '/tool/', '/tool/no-such-tool/', // the old shape is gone
      '/licence/x/', '/nothing/', '/index.html', '/404.html', '/sw.js', '/tools/toString/',
    ]) {
      expect(parseRoute(p), p).toEqual({ page: 'notFound' })
    }
  })

  test('old hash links become the new paths, other hashes are left alone', () => {
    expect(legacyPath('#/tool/merge-pdf')).toBe('/tools/pdf/merge-pdf/')
    expect(legacyPath('#/tool/resize-image')).toBe('/tools/image/resize-image/')
    expect(legacyPath('#/tools')).toBe('/tools/')
    expect(legacyPath('#/tools/image')).toBe('/tools/image/')
    expect(legacyPath('#/licence')).toBe('/licence/')
    expect(legacyPath('#/')).toBe('/')
    expect(parseRoute(legacyPath('#/tool/no-such-tool')!).page).toBe('notFound') // an old link to a tool that doesn't exist
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
    for (const r of all) expect(parseRoute(pathOf(r)).page, pathOf(r)).toBe(r.page) // every file the build writes is a page the app knows
  })
})
