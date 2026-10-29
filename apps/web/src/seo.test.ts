import { describe, expect, test } from 'vitest'
import { findTool, tools } from '@ream/tools'
import { seoOf, toolSeo } from '@ream/tools/seo'
import { allRoutes, parseRoute, pathOf } from './routes'
import { SITE, headTags, pageSeo, sitemapXml } from './seo'

const ready = tools.filter((t) => t.status === 'ready')

describe("every tool's page text", () => {
  test('every tool has an entry, and nothing is written for a tool that does not exist', () => {
    expect(Object.keys(toolSeo).sort()).toEqual(ready.map((t) => t.id).sort())
  })

  test('titles are unique, end with the name and fit a search result; descriptions fit a snippet', () => {
    const titles = ready.map((t) => seoOf(t).title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const t of ready) {
      const s = seoOf(t)
      expect(s.title.length, `${t.id} title: ${s.title.length}`).toBeLessThanOrEqual(60)
      expect(s.title.endsWith(' | Ream'), t.id).toBe(true)
      expect(s.description.length, `${t.id} description: ${s.description.length}`).toBeGreaterThanOrEqual(70)
      expect(s.description.length, `${t.id} description: ${s.description.length}`).toBeLessThanOrEqual(155)
    }
  })

  test('each page has a real intro, three points and at least two questions, in the house style', () => {
    for (const t of ready) {
      const s = seoOf(t)
      expect(s.intro.length, t.id).toBeGreaterThan(120)
      expect(s.points, t.id).toHaveLength(3)
      expect(s.faq.length, t.id).toBeGreaterThanOrEqual(2)
      const text = [s.title, s.description, s.intro, ...s.points, ...s.faq.flat()].join(' ')
      expect(text, t.id).not.toMatch(/!|\bplease\b|\bAI\b/i)
      for (const [q, a] of s.faq) {
        expect(q.endsWith('?'), `${t.id}: ${q}`).toBe(true)
        expect(a.length, `${t.id}: ${q}`).toBeGreaterThan(20)
      }
    }
  })

  test('a tool without written text still gets a usable page', () => {
    const s = seoOf({ ...ready[0], id: 'a-new-tool', title: 'A new tool', description: 'Does something' })
    expect(s.title).toContain('A new tool')
    expect(s.description).toContain('never uploaded')
  })
})

describe('pages', () => {
  const routes = allRoutes(tools)
  const pages = routes.map((r) => pageSeo(r, '1.2.3'))

  test('every page has its own title and description, and a canonical path that is its own file', () => {
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length)
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length)
    routes.forEach((r, i) => expect(pages[i].path).toBe(pathOf(r)))
    for (const p of pages) {
      expect(p.title.length, p.title).toBeLessThanOrEqual(65)
      expect(p.description.length, p.description).toBeLessThanOrEqual(160)
    }
  })

  test('the sitemap lists the pages worth finding, once each, and not the licence texts', () => {
    const xml = sitemapXml(routes, '1.2.3')
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toHaveLength(ready.length + 4) // the landing page, all tools and the two categories
    expect(urls).toContain(`${SITE}/`)
    expect(urls).toContain(`${SITE}/tools/pdf/compress-pdf/`)
    expect(urls).toContain(`${SITE}/tools/image/resize-image/`)
    expect(urls.some((u) => u.includes('/tool/'))).toBe(false)
    expect(urls.every((u) => u.startsWith(`${SITE}/`) && u.endsWith('/'))).toBe(true)
    expect(xml).not.toMatch(/licence|notices|404/)
  })

  test('licence, notices and not-found pages are kept out of search; a missing tool is a not-found page', () => {
    const missing = parseRoute('/tools/pdf/no-such-tool/')
    const soon = { page: 'tool', tool: { ...findTool('merge-pdf')!, status: 'soon' } } as const
    for (const r of [{ page: 'licence' }, { page: 'notices' }, { page: 'notFound' }, missing, soon] as const) {
      expect(pageSeo(r, '1').index, r.page).toBe(false)
      expect(headTags(pageSeo(r, '1'))).toContain('noindex')
    }
    expect(pageSeo(missing, '1').path).toBe('/404.html')
    expect(headTags(pageSeo({ page: 'notFound' }, '1'))).not.toMatch(/canonical|og:url/) // no address of its own to declare
  })

  test('the head names the page, points at its canonical address and carries structured data that parses', () => {
    const tool = pageSeo(parseRoute('/tools/pdf/merge-pdf/'), '1')
    const head = headTags(tool)
    expect(head).toContain(`<link data-seo rel="canonical" href="${SITE}/tools/pdf/merge-pdf/" />`)
    expect(head).toContain('og:title')
    expect(head).toContain('twitter:card')
    expect(head).toContain(`${SITE}/og.png`)
    const kinds = [...head.matchAll(/<script data-seo type="application\/ld\+json">([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1])['@type'])
    expect(kinds).toEqual(['WebApplication', 'BreadcrumbList'])
    const landing = pageSeo({ page: 'landing' }, '1.2.3')
    expect(JSON.stringify(landing.jsonLd)).toContain('"softwareVersion":"1.2.3"')
  })

  test('text in a title or description cannot break out of its tag', () => {
    const head = headTags({ title: 'A "quoted" <b>', description: 'x & "y" <script>', path: '/', index: true, jsonLd: [{ note: '</script><b>' }], html: '' })
    expect(head).not.toMatch(/<b>/)
    expect(head.match(/<script/g)).toHaveLength(1) // only the structured data block, and its text can't close it early
    expect(head).toContain('&quot;quoted&quot;')
    expect(head).toContain('\\u003c/script>')
  })

  test('the text inside the page links to every tool of its kind and has one heading', () => {
    const landing = pageSeo({ page: 'landing' }, '1').html
    for (const t of ready) expect(landing).toContain(`href="/tools/${t.category}/${t.id}/"`)
    for (const p of pages) expect(p.html.match(/<h1>/g), p.path).toHaveLength(1)
  })
})
