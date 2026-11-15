import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import {
  crossValidateCatalog,
  formatIssue,
  roomSchema,
  rulesSchema,
  zodIssuesToCatalogIssues,
  type Catalog,
  type CatalogIssue,
  type RoomFile
} from '@shared/catalog'

/** Thrown when any catalog file is missing, unparseable or invalid. Lists every problem found. */
export class CatalogError extends Error {
  readonly issues: CatalogIssue[]

  constructor(issues: CatalogIssue[]) {
    super(
      `Mind Palace cannot start: ${issues.length} problem${issues.length === 1 ? '' : 's'} in the catalog files.\n` +
        issues.map((i) => `  - ${formatIssue(i)}`).join('\n')
    )
    this.name = 'CatalogError'
    this.issues = issues
  }
}

export interface LoadedCatalog extends Catalog {
  /** Non-fatal oddities, to be logged. */
  warnings: CatalogIssue[]
}

function readAndParse<S extends z.ZodType>(file: string, schema: S, issues: CatalogIssue[]): z.output<S> | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    issues.push({ file, field: '(file)', message: `cannot be read: ${(cause as Error).message}` })
    return undefined
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (cause) {
    issues.push({ file, field: '(file)', message: `is not valid JSON: ${(cause as Error).message}` })
    return undefined
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    issues.push(...zodIssuesToCatalogIssues(file, result.error))
    return undefined
  }
  return result.data
}

/**
 * Reads `<dir>/rules.json` and every `<dir>/rooms/*.json`, validates each file
 * and the references between them, and throws a `CatalogError` naming the file
 * path and field of everything that is wrong.
 */
export function loadCatalog(dir: string): LoadedCatalog {
  const issues: CatalogIssue[] = []

  const rulesFile = join(dir, 'rules.json')
  const rules = readAndParse(rulesFile, rulesSchema, issues)

  const roomsDir = join(dir, 'rooms')
  let roomFileNames: string[] = []
  try {
    roomFileNames = readdirSync(roomsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch (cause) {
    issues.push({ file: roomsDir, field: '(directory)', message: `cannot be read: ${(cause as Error).message}` })
  }
  if (roomFileNames.length === 0 && issues.every((i) => i.file !== roomsDir)) {
    issues.push({ file: roomsDir, field: '(directory)', message: 'contains no room files (*.json)' })
  }

  const roomFiles: RoomFile[] = []
  for (const name of roomFileNames) {
    const file = join(roomsDir, name)
    const room = readAndParse(file, roomSchema, issues)
    if (!room) continue
    if (name !== `${room.id}.json`) {
      issues.push({ file, field: 'id', message: `"${room.id}" does not match the file name (expected "${name.slice(0, -5)}")` })
    }
    roomFiles.push({ file, room })
  }

  let warnings: CatalogIssue[] = []
  if (rules) {
    const cross = crossValidateCatalog(rulesFile, rules, roomFiles)
    issues.push(...cross.errors)
    warnings = cross.warnings
  }

  if (issues.length > 0 || !rules) throw new CatalogError(issues)

  return {
    rules,
    rooms: Object.fromEntries(roomFiles.map(({ room }) => [room.id, room])),
    warnings
  }
}
