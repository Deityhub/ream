// Checks the built site the way a crawler sees it: reads apps/web/dist (run `yarn build` first) and fails on anything that
// would cost the site its place in search or its link previews. Shares no code with the build on purpose, so a mistake
// in it can't pass its own check.
//   node scripts/seo-check.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = join(import.meta.dirname, '../apps/web/dist')
const SITE = 'https://ream.deityhub.com'
const problems: string[] = []
const bad = (where: string, what: string) => problems.push(`${where}: ${what}`)

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const pages = walk(dist).filter((f) => f.endsWith('.html')).map((f) => relative(dist, f).split('\\').join('/'))
/** the address a page is served at */
const addressOf = (file: string) => (file === 'index.html' ? '/' : file === '404.html' ? '/404.html' : `/${file.slice(0, -'index.html'.length)}`)
/** whether a path inside the site leads to a file (a folder with an index counts) */
const exists = (path: string) => {
  const p = path.split(/[?#]/)[0].replace(/^\//, '')
  return existsSync(join(dist, p)) && statSync(join(dist, p)).isFile() ? true : existsSync(join(dist, p, 'index.html'))
}

const titles = new Map<string, string>()
let indexable = 0
for (const file of pages) {
  const html = readFileSync(join(dist, file), 'utf8')
  const address = addressOf(file)
  const at = (what: string) => bad(file, what)
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1]
  const robots = /<meta data-seo name="robots" content="([^"]*)"/.exec(html)?.[1]
  const canonical = /<link data-seo rel="canonical" href="([^"]*)"/.exec(html)?.[1]
  const indexed = robots?.startsWith('index') ?? false
  if (indexed) indexable++

  if (!title) at('no <title>')
  else {
    if (title.length > 65) at(`title is ${title.length} characters: ${title}`)
    if (indexed) {
      if (titles.has(title)) at(`same title as ${titles.get(title)}`)
      titles.set(title, file)
    }
  }
  if (!description) at('no meta description')
  else if (indexed && (description.length < 70 || description.length > 160)) at(`description is ${description.length} characters`)
  if (!robots) at('no robots meta')
  if (file === '404.html' ? canonical !== undefined : canonical !== SITE + address) at(`canonical is ${canonical}, expected ${file === '404.html' ? 'none' : SITE + address}`)
  if (!indexed && !robots?.startsWith('noindex')) at(`robots says "${robots}"`)
  if (indexed && !/property="og:image" content="https:\/\/ream\.deityhub\.com\/og\.png"/.test(html)) at('no social card image')
  if (!/name="twitter:card" content="summary_large_image"/.test(html)) at('no twitter card')

  const root = /<div id="root">([\s\S]*?)<\/div>\s*<\/body>/.exec(html)?.[1] ?? ''
  if (!root) at('nothing inside #root for a crawler without scripts')
  const h1s = root.match(/<h1[ >]/g)?.length ?? 0
  if (h1s !== 1) at(`${h1s} <h1> in the page text`)
  for (const m of root.matchAll(/href="([^"]+)"/g)) if (m[1].startsWith('/') && !exists(m[1])) at(`link to ${m[1]} leads nowhere`)

  for (const m of html.matchAll(/<script data-seo type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1])
      if (j['@context'] !== 'https://schema.org' || !j['@type']) at('structured data without @context or @type')
    } catch {
      at('structured data is not valid JSON')
    }
  }
  // base is "/": a relative asset address breaks on every page below the first level
  if (/(?:src|href)="\.\//.test(html)) at('a relative ./ address (the build base is /)')
}

if (!pages.includes('index.html')) bad('dist', 'no index.html')
// a tool lives at /tools/<kind>/<id>/ and nowhere else: the shape before that (/tool/<id>/) must not come back
if (pages.some((f) => f.startsWith('tool/'))) bad('dist', 'a page under /tool/: tools live under /tools/<kind>/')
for (const f of pages) {
  const m = /^tools\/([^/]+)\/([^/]+)\/index\.html$/.exec(f)
  if (m && !readFileSync(join(dist, f), 'utf8').includes(`<link data-seo rel="canonical" href="${SITE}/tools/${m[1]}/${m[2]}/"`)) bad(f, 'a tool page whose canonical is not its own address')
}
if (!pages.includes('404.html')) bad('dist', 'no 404.html: Cloudflare Pages would answer every unknown address with 200')

// sitemap: every address is a page that exists, and every indexable page is in it
const sitemap = existsSync(join(dist, 'sitemap.xml')) ? readFileSync(join(dist, 'sitemap.xml'), 'utf8') : ''
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
if (!locs.length) bad('sitemap.xml', 'missing or empty')
for (const loc of locs) {
  if (!loc.startsWith(`${SITE}/`)) bad('sitemap.xml', `${loc} is not on ${SITE}`)
  else if (!exists(loc.slice(SITE.length))) bad('sitemap.xml', `${loc} has no file`)
}
if (locs.length !== indexable) bad('sitemap.xml', `${locs.length} addresses for ${indexable} indexable pages`)

// social card: 1200 x 630 PNG
const og = join(dist, 'og.png')
if (!existsSync(og)) bad('og.png', 'missing')
else {
  const b = readFileSync(og)
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)]
  if (b.toString('latin1', 1, 4) !== 'PNG' || w !== 1200 || h !== 630) bad('og.png', `is ${w} x ${h}, expected a 1200 x 630 PNG`)
}

// robots.txt itself is pinned by apps/web/src/crawlers.test.ts; here only that it points at the sitemap
if (existsSync(join(dist, 'robots.txt')) && !readFileSync(join(dist, 'robots.txt'), 'utf8').includes(`Sitemap: ${SITE}/sitemap.xml`)) bad('robots.txt', 'does not name the sitemap')

// the service worker keeps pages under their folder's address, never as .../index.html (a redirect on Cloudflare Pages) or the 404 page
const sw = existsSync(join(dist, 'sw.js')) ? readFileSync(join(dist, 'sw.js'), 'utf8') : ''
const files = /const FILES = (\[[^\n]*\])/.exec(sw)?.[1]
if (!files) bad('sw.js', 'no file list')
else {
  const kept: string[] = JSON.parse(files)
  for (const f of kept) if (f.endsWith('index.html') || f === '404.html' || f === 'robots.txt' || f === 'sitemap.xml') bad('sw.js', `keeps ${f}`)
  if (!kept.includes('./') || !kept.includes('tools/pdf/compress-pdf/')) bad('sw.js', 'does not keep the first page and the tool pages')
}

if (problems.length) {
  console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in the built site:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`${pages.length} pages, ${locs.length} in the sitemap, all fine.`)
