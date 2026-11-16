import { localDayOf, type HistoryRows } from '@shared/engine'
import type { Catalog } from '@shared/catalog'
import { buildPalace, seenKeys, type PalaceView } from '@shared/palace'
import type { Store } from '../db/client'
import type { ProgressKeeper } from './progress'
import { and, eq } from 'drizzle-orm'
import { checkPlacement, nextPlacement, type Placement, type PlacementChange } from '@shared/placements'
import { chats, goalCompletions, messages, placements, projects } from '../db/schema'

const seenSetting = (roomId: string): string => `palace.seen.${roomId}`

function readSeen(store: Store, roomId: string): string[] | null {
  const raw = store.getSetting(seenSetting(roomId))
  if (raw === undefined) return null
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null
  } catch {
    return null
  }
}

/** The rows the engine needs, straight from the database. */
export function historyRows(store: Store, timeZone: string): HistoryRows {
  return {
    chats: store.db.select({ id: chats.id, roomId: chats.roomId }).from(chats).all(),
    messages: store.db
      .select({ chatId: messages.chatId, role: messages.role, createdAt: messages.createdAt, localDay: messages.localDay })
      .from(messages)
      .all(),
    goalCompletions: store.db
      .select({ projectId: goalCompletions.projectId, roomId: goalCompletions.roomId, localDay: goalCompletions.localDay })
      .from(goalCompletions)
      .all(),
    projects: store.db
      .select({ id: projects.id, roomId: projects.roomId, state: projects.state, lastActivityAt: projects.lastActivityAt })
      .from(projects)
      .all()
      .map(({ lastActivityAt, ...p }) => ({ ...p, lastActivityDay: lastActivityAt ? localDayOf(lastActivityAt, timeZone) : null }))
  }
}

export function createPalaceView(deps: { store: Store; catalog: Catalog; keeper: ProgressKeeper; timeZone: () => string; now?: () => Date }) {
  const { store, catalog, keeper } = deps
  const now = deps.now ?? (() => new Date())

  function view(focus: string | null = null): PalaceView {
    const timeZone = deps.timeZone()
    keeper.record()
    return buildPalace({
      kept: keeper.kept(),
      placements: placementRows(),
      focus,
      catalog,
      rows: historyRows(store, timeZone),
      timeZone,
      today: localDayOf(now(), timeZone),
      seen: Object.fromEntries(Object.keys(catalog.rooms).map((roomId) => [roomId, readSeen(store, roomId)]))
    })
  }

  function placementRows(): Placement[] {
    return store.db.select().from(placements).all().map(({ updatedAt: _u, ...row }) => row)
  }

  return {
    view,
    placements: placementRows,
    /** Moves, re-skins or hides one item. Throws with the reason when the change is not allowed. */
    place(change: PlacementChange): PalaceView {
      const room = view().rooms.find((r) => r.id === change.roomId)
      if (!room) throw new Error(`There is no room "${change.roomId}".`)
      const rows = placementRows()
      const check = checkPlacement(change, room.state, rows, catalog)
      if (!check.ok) throw new Error(check.reason)
      const current = rows.find((r) => r.roomId === change.roomId && r.instance === change.instance)
      const next = { ...nextPlacement(current, change), updatedAt: now().toISOString() }
      store.db.insert(placements).values(next).onConflictDoUpdate({ target: [placements.roomId, placements.instance], set: next }).run()
      return view(change.roomId)
    },
    /** Gives an item back to the catalog: its default slot, default look, shown. */
    reset(roomId: string, instance: string): PalaceView {
      store.db.delete(placements).where(and(eq(placements.roomId, roomId), eq(placements.instance, instance))).run()
      return view(roomId)
    },
    /** Stores what the room holds now, so only later gains show as new. */
    markSeen(roomId: string): void {
      const room = view().rooms.find((r) => r.id === roomId)
      if (!room) throw new Error(`There is no room "${roomId}".`)
      store.setSetting(seenSetting(roomId), JSON.stringify(seenKeys(room.state)))
    }
  }
}
