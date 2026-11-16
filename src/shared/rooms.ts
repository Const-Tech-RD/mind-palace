/**
 * Rooms the person made, joined to the catalog. Pure.
 *
 * The catalog files hold the rules, the items, the library and the Mail room.
 * Every other room comes from the `rooms` table; `catalogWithRooms` adds them so
 * the engine, the palace and the classifier see one `Catalog` as before.
 */
import type { Catalog, RoomDef } from './catalog'

/** How many accent tokens the theme defines (`--mp-room-accent-0` … `-7`). */
export const ROOM_ACCENTS = 8

/** The token name for a palette index; indexes past the palette wrap around. */
export const accentToken = (index: number): string => `mp-room-accent-${((index % ROOM_ACCENTS) + ROOM_ACCENTS) % ROOM_ACCENTS}`

/** The catalog with `rooms` added. Throws on a duplicate id or cell, or an item or slot the catalog does not have. */
export function catalogWithRooms(base: Catalog, rooms: readonly RoomDef[]): Catalog {
  const all: Record<string, RoomDef> = { ...base.rooms }
  const cells = new Map(Object.values(all).map((room) => [room.cell.join(','), room.id]))
  for (const room of rooms) {
    if (all[room.id]) throw new Error(`Room "${room.id}" is defined twice.`)
    const cell = room.cell.join(',')
    const other = cells.get(cell)
    if (other !== undefined) throw new Error(`Rooms "${other}" and "${room.id}" are both in cell ${cell}.`)
    for (const step of room.signature) {
      if (!base.items[step.item]) throw new Error(`Room "${room.id}": signature item "${step.item}" is not in the catalog.`)
      for (const slot of step.slots) {
        if (!base.rules.layout.slots[slot]) throw new Error(`Room "${room.id}": there is no slot "${slot}".`)
      }
    }
    all[room.id] = room
    cells.set(cell, room.id)
  }
  return { ...base, rooms: all }
}
