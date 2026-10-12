const { app, BrowserWindow } = require('electron')
const path = require('node:path')

// REAM_DEV_URL points at the Vite dev server; otherwise load the built web app
const devUrl = process.env.REAM_DEV_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../web/dist/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
