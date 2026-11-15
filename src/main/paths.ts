import { join } from 'node:path'
import { app } from 'electron'

/**
 * Folders that ship next to the code rather than inside the bundle. In dev and
 * in `electron-vite build` output the app path is the project root; a packaged
 * build (phase 6) has to list these folders in electron-builder's `files`.
 */
export const appRoot = (): string => app.getAppPath()
export const catalogDir = (): string => join(appRoot(), 'catalog')
export const migrationsDir = (): string => join(appRoot(), 'drizzle')
export const resourcesDir = (): string => join(appRoot(), 'resources')

/** The SQLite file lives in Electron's per-user data folder. */
export const databasePath = (): string => join(app.getPath('userData'), 'mind-palace.sqlite')
