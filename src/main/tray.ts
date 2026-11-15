import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import type { Store } from './db/client'
import { canRegisterLoginItem, getStartAtLogin, setStartAtLogin } from './loginItem'
import { resourcesDir } from './paths'
import { markQuitting, showMainWindow } from './window'

let tray: Tray | null = null

function trayImage(): Electron.NativeImage {
  // macOS: a black-and-alpha "Template" image that follows the menu bar theme
  // (the @2x file next to it is picked up automatically). Elsewhere: colour.
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
  const image = nativeImage.createFromPath(join(resourcesDir(), file))
  if (image.isEmpty()) throw new Error(`Tray icon not found: ${join(resourcesDir(), file)}`)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

/** The tray is the app's permanent home; its Quit item is the one way to stop the app. */
export function createTray(store: Store): Tray {
  tray = new Tray(trayImage())
  tray.setToolTip('Mind Palace')

  const rebuild = (): void => {
    const registrable = canRegisterLoginItem()
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Mind Palace', click: () => showMainWindow() },
        { type: 'separator' },
        {
          label: registrable ? 'Start at login' : 'Start at login (packaged app only)',
          type: 'checkbox',
          checked: getStartAtLogin(store),
          enabled: registrable,
          click: (item) => {
            setStartAtLogin(store, item.checked)
            rebuild()
          }
        },
        { type: 'separator' },
        {
          label: 'Quit Mind Palace',
          click: () => {
            markQuitting()
            app.quit()
          }
        }
      ])
    )
  }
  rebuild()

  // Windows and Linux: a left click opens the window (macOS opens the menu).
  if (process.platform !== 'darwin') tray.on('click', () => showMainWindow())
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
