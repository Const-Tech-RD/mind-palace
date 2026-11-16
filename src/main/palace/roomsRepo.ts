import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { RoomRow } from '@shared/rooms'
import type { Db } from '../db/client'
import { areaSuggestions, rooms } from '../db/schema'

const signatureJson = z.array(z.object({ item: z.string(), slots: z.array(z.string()).min(1) }))
const classifierJson = z.object({ belongs: z.string(), not_here: z.string(), examples: z.array(z.string()) })

/** The rooms the person made, and the areas they dismissed. */
export function createRoomsRepo(db: Db) {
  return {
    /** Every stored room, oldest first. A row whose JSON no longer parses is skipped and logged. */
    rows(log: (message: string) => void = console.warn): RoomRow[] {
      return db
        .select()
        .from(rooms)
        .orderBy(rooms.createdAt)
        .all()
        .flatMap((row) => {
          try {
            return [
              {
                ...row,
                signature: signatureJson.parse(JSON.parse(row.signature)),
                classifier: classifierJson.parse(JSON.parse(row.classifier))
              }
            ]
          } catch (error) {
            log(`[mind-palace] room "${row.id}" has unreadable JSON and is left out: ${error instanceof Error ? error.message : String(error)}`)
            return []
          }
        })
    },

    insert(row: RoomRow): void {
      db.insert(rooms)
        .values({ ...row, signature: JSON.stringify(row.signature), classifier: JSON.stringify(row.classifier) })
        .run()
    },

    rename(id: string, name: string): void {
      db.update(rooms).set({ name }).where(eq(rooms.id, id)).run()
    },

    dismissed(): Array<{ area: string; dismissedCount: number }> {
      return db.select({ area: areaSuggestions.area, dismissedCount: areaSuggestions.dismissedCount }).from(areaSuggestions).all()
    },

    dismiss(area: string, displayName: string, count: number, at: string): void {
      const row = { area, displayName, dismissedAt: at, dismissedCount: count }
      db.insert(areaSuggestions).values(row).onConflictDoUpdate({ target: areaSuggestions.area, set: row }).run()
    }
  }
}

export type RoomsRepo = ReturnType<typeof createRoomsRepo>
