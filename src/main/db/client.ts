import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface Store {
  db: Db
  sqlite: Database.Database
  path: string
  /** User tables present after migrations, sorted. */
  tables(): string[]
  getSetting(key: string): string | undefined
  setSetting(key: string, value: string): void
  close(): void
}

/**
 * Opens (creating if needed) the SQLite file and applies every pending
 * migration from `migrationsFolder` before anything else touches it.
 */
export function openStore(path: string, migrationsFolder: string): Store {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
    throw new Error(`Database migrations not found in ${migrationsFolder} (expected meta/_journal.json)`)
  }
  mkdirSync(dirname(path), { recursive: true })

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  return {
    db,
    sqlite,
    path,
    tables() {
      const rows = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
      return rows.map((r) => r.name)
    },
    getSetting(key) {
      const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined
      return row?.value
    },
    setSetting(key, value) {
      sqlite
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value)
    },
    close() {
      sqlite.close()
    }
  }
}
