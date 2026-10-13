const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const icon = path.join(__dirname, 'build/icon.png')

// REAM_DEV_URL points at the Vite dev server; otherwise load the built web app
const devUrl = process.env.REAM_DEV_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    icon,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../web/dist/index.html'))
}

app.whenReady().then(() => {
  app.dock?.setIcon(icon) // macOS; packaged builds get their icon from electron-builder (M8)
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
