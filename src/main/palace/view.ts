import { localDayOf, type HistoryRows } from '@shared/engine'
import type { Catalog } from '@shared/catalog'
import { buildPalace, seenKeys, type PalaceView } from '@shared/palace'
import type { Store } from '../db/client'
import { chats, goalCompletions, messages } from '../db/schema'

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

/** The rows the engine needs, straight from the database. Unlocks are never stored. */
function historyRows(store: Store): HistoryRows {
  return {
    chats: store.db.select({ id: chats.id, roomId: chats.roomId }).from(chats).all(),
    messages: store.db
      .select({ chatId: messages.chatId, role: messages.role, createdAt: messages.createdAt, localDay: messages.localDay })
      .from(messages)
      .all(),
    goalCompletions: store.db
      .select({ projectId: goalCompletions.projectId, roomId: goalCompletions.roomId, localDay: goalCompletions.localDay })
      .from(goalCompletions)
      .all()
  }
}

export function createPalaceView(deps: { store: Store; catalog: Catalog; timeZone: () => string; now?: () => Date }) {
  const { store, catalog } = deps
  const now = deps.now ?? (() => new Date())

  function view(): PalaceView {
    const timeZone = deps.timeZone()
    return buildPalace({
      catalog,
      rows: historyRows(store),
      timeZone,
      today: localDayOf(now(), timeZone),
      seen: Object.fromEntries(Object.keys(catalog.rooms).map((roomId) => [roomId, readSeen(store, roomId)]))
    })
  }

  return {
    view,
    /** Stores what the room holds now, so only later gains show as new. */
    markSeen(roomId: string): void {
      const room = view().rooms.find((r) => r.id === roomId)
      if (!room) throw new Error(`There is no room "${roomId}".`)
      store.setSetting(seenSetting(roomId), JSON.stringify(seenKeys(room.state)))
    }
  }
}
