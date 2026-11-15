import { app } from 'electron'
import type { Store } from './db/client'

const SETTING = 'start_at_login'

/**
 * Start at login. The choice is kept in the `settings` table (default: on) and
 * pushed to the OS on every launch.
 *
 * Only a packaged app registers itself: in dev the executable is the bare
 * Electron binary inside node_modules, and registering that would add a broken
 * login item to the developer's machine.
 */
export const canRegisterLoginItem = (): boolean => app.isPackaged

export function getStartAtLogin(store: Store): boolean {
  return (store.getSetting(SETTING) ?? 'true') === 'true'
}

export function applyStartAtLogin(store: Store): void {
  if (store.getSetting(SETTING) === undefined) store.setSetting(SETTING, 'true')
  if (!canRegisterLoginItem()) return
  app.setLoginItemSettings({ openAtLogin: getStartAtLogin(store) })
}

export function setStartAtLogin(store: Store, enabled: boolean): void {
  store.setSetting(SETTING, String(enabled))
  applyStartAtLogin(store)
}
