// One-off: generate a real Chromium (Skia) PDF fixture.  Run: node scripts/make-fixtures.ts
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openChrome } from './chrome.ts'

const html = `<html><body style="font-family:sans-serif">${[1, 2, 3]
  .map((n) => `<div style="page-break-after:always"><h1>Chromium page ${n}</h1><p style="font-family:serif">Café résumé ${'lorem ipsum '.repeat(40)}</p></div>`)
  .join('')}</body></html>`

const chrome = await openChrome()
try {
  const page = await chrome.page()
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const out = join(import.meta.dirname, '../packages/pdf-core/test/fixtures/chromium.pdf')
  mkdirSync(dirname(out), { recursive: true })
  // A4 in inches
  await page.pdf(out, { paperWidth: 8.27, paperHeight: 11.69 })
  console.log('wrote', out)
} finally {
  await chrome.close()
}
