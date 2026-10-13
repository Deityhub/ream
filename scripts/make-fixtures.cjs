// One-off: generate a real Chromium (Skia) PDF fixture.  Run: node_modules/.bin/electron scripts/make-fixtures.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const html = `<html><body style="font-family:sans-serif">${[1, 2, 3]
  .map((n) => `<div style="page-break-after:always"><h1>Chromium page ${n}</h1><p style="font-family:serif">Café résumé ${'lorem ipsum '.repeat(40)}</p></div>`)
  .join('')}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4' })
  const out = path.join(__dirname, '../packages/pdf-core/test/fixtures/chromium.pdf')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, pdf)
  console.log('wrote', out, pdf.length)
  app.quit()
})
