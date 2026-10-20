// Electron side of scripts/render-compare.ts.  Usage: electron render-compare.cjs <job.json>
// job: { bundle: path, items: [{ name, pdf, ref, out }], fonts: { [kind+bold+italic]: base64[] } }  ->  prints one JSON line of results
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

app.whenReady().then(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'))
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  await win.webContents.executeJavaScript(fs.readFileSync(job.bundle, 'utf8'))
  await win.webContents.executeJavaScript(`Harness.setFonts(${JSON.stringify(job.fonts ?? {})})`)
  const results = []
  for (const it of job.items) {
    const pdf = fs.readFileSync(it.pdf).toString('base64')
    const ref = fs.readFileSync(it.ref).toString('base64')
    try {
      const r = await win.webContents.executeJavaScript(`Harness.compare(${JSON.stringify(pdf)}, ${JSON.stringify(ref)})`)
      fs.writeFileSync(it.out, Buffer.from(r.sheet, 'base64'))
      delete r.sheet
      results.push({ name: it.name, ...r })
    } catch (e) {
      results.push({ name: it.name, error: String(e && e.message ? e.message : e) })
    }
  }
  console.log('RESULTS ' + JSON.stringify(results))
  app.quit()
})
