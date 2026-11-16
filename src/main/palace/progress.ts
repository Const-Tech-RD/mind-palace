import { buildRoomEvents, computeRoomState, localDayOf, type KeptProgress } from '@shared/engine'
import type { Catalog } from '@shared/catalog'
import { goalMarkAfterReopen, progressMarks } from '@shared/progress'
import { eq, sql } from 'drizzle-orm'
import type { Store } from '../db/client'
import { goalCompletions, roomProgress } from '../db/schema'
import { historyRows } from './view'

/**
 * Keeps each room's high-water marks in `room_progress` (earned stays earned).
 * `record()` must run before anything moves chats or projects between rooms.
 */
export function createProgressKeeper(deps: { store: Store; catalog: () => Catalog; timeZone: () => string; now?: () => Date }) {
  const { store } = deps
  const now = deps.now ?? (() => new Date())

  /** Counted goal days in a room now (at most one completion counts per day). */
  function goalDays(roomId: string): number {
    return (
      store.db
        .select({ n: sql<number>`count(distinct ${goalCompletions.localDay})` })
        .from(goalCompletions)
        .where(eq(goalCompletions.roomId, roomId))
        .get()?.n ?? 0
    )
  }

  function kept(): Record<string, KeptProgress> {
    return Object.fromEntries(
      store.db
        .select()
        .from(roomProgress)
        .all()
        .map((row) => [row.roomId, { bestStreak: row.bestStreak, goalCount: row.goalCount }])
    )
  }

  return {
    kept,

    /** Stores every mark that rose since the last call. */
    record(): void {
      const catalog = deps.catalog()
      const timeZone = deps.timeZone()
      const events = buildRoomEvents(historyRows(store, timeZone), timeZone)
      const today = localDayOf(now(), timeZone)
      const before = kept()
      const states = Object.keys(catalog.rooms).map((roomId) => computeRoomState(roomId, events, catalog, today, before[roomId]))
      const at = now().toISOString()
      for (const mark of progressMarks(states, before)) {
        const row = { roomId: mark.roomId, bestStreak: mark.bestStreak, goalCount: mark.goalCount, updatedAt: at }
        store.db.insert(roomProgress).values(row).onConflictDoUpdate({ target: roomProgress.roomId, set: row }).run()
      }
    },

    goalDays,

    /** After a goal is reopened (a deliberate undo): the mark drops by the goal days that reopen removed, no more. */
    resetGoals(roomId: string, daysBefore: number): void {
      const mark = kept()[roomId]
      if (!mark) return
      const daysNow = goalDays(roomId)
      const goalCount = goalMarkAfterReopen(mark.goalCount, Math.max(0, daysBefore - daysNow), daysNow)
      store.db.update(roomProgress).set({ goalCount, updatedAt: now().toISOString() }).where(eq(roomProgress.roomId, roomId)).run()
    }
  }
}

export type ProgressKeeper = ReturnType<typeof createProgressKeeper>
