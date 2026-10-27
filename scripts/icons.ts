// Draws the app icons (PWA manifest, Apple touch icon) from apps/web/icons/icon.svg with headless Chrome.
//   node scripts/icons.ts      (run again after changing the SVG; the PNGs are committed)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openChrome } from './chrome.ts'

const web = join(import.meta.dirname, '../apps/web')
const svg = readFileSync(join(web, 'icons/icon.svg'), 'utf8')
const out = join(web, 'public/icons')
mkdirSync(out, { recursive: true })

const chrome = await openChrome()
try {
  const page = await chrome.page()
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
    // not page.view: below 768 px it emulates a phone, which lays out a page without a viewport tag at 980 px and shrinks it
    await page.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
    await page.goto(`data:text/html,${encodeURIComponent(`<body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">`)}`, 300)
    await page.screenshot(join(out, name))
    console.log('wrote', name)
  }
} finally {
  await chrome.close()
}
