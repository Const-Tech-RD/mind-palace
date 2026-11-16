import { join } from 'node:path'
import { loadCatalog } from '../src/main/catalog/loader'
import { catalogWithRooms } from '../src/shared/rooms'
import { FIXTURE_ROOMS } from './fixtures/rooms'
import { addDays, type Catalog, type LocalDay, type RoomEvent, type RoomState } from './shared'

export const CATALOG_DIR = join(process.cwd(), 'catalog')

/**
 * The real catalog files, exactly as the app loads them, plus the three rooms
 * the catalog used to ship (now made from library items, see ./fixtures/rooms).
 */
export const catalog: Catalog = catalogWithRooms(loadCatalog(CATALOG_DIR), FIXTURE_ROOMS)

export const chatsOn = (roomId: string, days: LocalDay[]): RoomEvent[] =>
  days.map((localDay) => ({ kind: 'user_message', roomId, localDay }))

export const goalOn = (roomId: string, localDay: LocalDay, projectId: string): RoomEvent => ({
  kind: 'goal_completed',
  roomId,
  localDay,
  projectId
})

/** `count` consecutive days starting at `first`. */
export const run = (first: LocalDay, count: number): LocalDay[] =>
  Array.from({ length: count }, (_, i) => addDays(first, i))

/** `item@slot` for everything in the room, sorted; trophies as `trophy@trophy_shelf#i`. */
export const placed = (state: RoomState): string[] =>
  state.items.map((p) => `${p.item}@${p.slot}${p.source === 'trophy' ? `#${p.index}` : ''}`).sort()
