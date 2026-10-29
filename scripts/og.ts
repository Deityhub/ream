// Draws the social card (apps/web/public/og.png, 1200x630: what a link to Ream shows in chat apps and on social sites)
// with headless Chrome. Run again after changing the wording or the look; the PNG is committed.
//   node scripts/og.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openChrome } from './chrome.ts'

const root = join(import.meta.dirname, '..')
const font = (file: string) => readFileSync(join(root, 'node_modules/@fontsource', file)).toString('base64')
const mark = readFileSync(join(root, 'apps/web/icons/icon.svg'), 'utf8')

// the ground, steel accent and type are the site's (packages/ui/src/theme.css, light mode)
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Barlow Condensed'; font-weight: 600; src: url(data:font/woff2;base64,${font('barlow-condensed/files/barlow-condensed-latin-600-normal.woff2')}) }
@font-face { font-family: 'Barlow'; font-weight: 400; src: url(data:font/woff2;base64,${font('barlow/files/barlow-latin-400-normal.woff2')}) }
* { box-sizing: border-box }
body { margin: 0; width: 1200px; height: 630px; background: #f2f2f3; color: #1d1d1f; font-family: Barlow, sans-serif; position: relative; overflow: hidden }
.frame { position: absolute; inset: 40px; border: 2px solid #d4d4d7 }
.brand { position: absolute; left: 88px; top: 80px; display: flex; align-items: center; gap: 18px; font: 600 44px 'Barlow Condensed'; letter-spacing: 0.04em; text-transform: uppercase }
.brand img { width: 56px; height: 56px; display: block }
h1 { position: absolute; left: 88px; top: 190px; margin: 0; font: 600 108px/1.02 'Barlow Condensed'; text-transform: uppercase; letter-spacing: 0.005em }
h1 span { color: #416180 }
p { position: absolute; left: 88px; bottom: 84px; margin: 0; font-size: 30px; color: #5d5d60 }
</style>
<div class="frame"></div>
<div class="brand"><img src="data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}">Ream</div>
<h1>The file toolkit that runs on <span>your computer.</span></h1>
<p>PDFs, images and Office files. Nothing is uploaded.</p>`

const chrome = await openChrome()
try {
  const page = await chrome.page()
  // not page.view: below 768 px it would emulate a phone; this is a plain 1200 x 630 canvas
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
  await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`, 500)
  await page.screenshot(join(root, 'apps/web/public/og.png'))
  console.log('wrote apps/web/public/og.png')
} finally {
  await chrome.close()
}
