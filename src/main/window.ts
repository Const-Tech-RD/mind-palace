import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'

let mainWindow: BrowserWindow | null = null
let quitting = false

/** Called from the tray's Quit item (and by the OS on shutdown): lets windows really close. */
export function markQuitting(): void {
  quitting = true
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(options: { show: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Mind Palace',
    backgroundColor: '#1b1426',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  // Closing the window only hides it; the app lives on in the tray.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideMainWindow()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (options.show) win.once('ready-to-show', () => showMainWindow())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

export function showMainWindow(): void {
  if (!mainWindow) return
  if (process.platform === 'darwin') void app.dock?.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

export function hideMainWindow(): void {
  if (!mainWindow) return
  mainWindow.hide()
  // A tray app with no window should not sit in the Dock.
  if (process.platform === 'darwin') app.dock?.hide()
}
