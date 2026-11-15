import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { hideMainWindow } from './window'

/**
 * Application menu. The standard Quit item is left out on purpose: Cmd+Q and
 * Cmd+W both just hide the window, and the tray's Quit item stops the app.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const closeToTray: MenuItemConstructorOptions[] = [
    { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => hideMainWindow() },
    ...(isMac
      ? [{ label: 'Close to Menu Bar', accelerator: 'Cmd+Q', click: () => hideMainWindow() } as MenuItemConstructorOptions]
      : [])
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              ...closeToTray
            ]
          } as MenuItemConstructorOptions
        ]
      : [{ label: 'File', submenu: closeToTray } as MenuItemConstructorOptions]),
    { role: 'editMenu' },
    ...(app.isPackaged ? [] : [{ role: 'viewMenu' } as MenuItemConstructorOptions])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
