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

/** One signature pick as stored: the item and its slot(s); its position gives its number. */
export interface StoredSignatureStep {
  item: string
  slots: string[]
}

/** The text the classifier reads to file chats into the room. */
export interface RoomClassifierText {
  belongs: string
  not_here: string
  examples: string[]
}

/** A `rooms` row, with its JSON columns parsed. */
export interface RoomRow {
  id: string
  name: string
  area: string
  /** Palette index; see `accentToken`. */
  accent: number
  cellX: number
  cellY: number
  signature: StoredSignatureStep[]
  classifier: RoomClassifierText
  createdAt: string
}

/** A stored room as the engine sees it: pick 1 is there from the start, picks 2-5 come with the streak ladder. */
export function roomDefFromRow(row: RoomRow): RoomDef {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    accent: accentToken(row.accent),
    cell: [row.cellX, row.cellY],
    belongs: row.classifier.belongs,
    not_here: row.classifier.not_here,
    examples: row.classifier.examples,
    signature: row.signature.map((step, i) => ({
      n: i + 1,
      unlock: i === 0 ? ('start' as const) : ('streak' as const),
      item: step.item,
      slots: [...step.slots]
    })),
    assets: {}
  }
}

/** Like `catalogWithRooms`, but a room the catalog cannot hold (an item or slot gone, a clash) is left out with a warning instead of failing all of them. */
export function catalogWithValidRooms(base: Catalog, rooms: readonly RoomDef[], warn: (message: string) => void): Catalog {
  let catalog = base
  for (const room of rooms) {
    try {
      catalog = catalogWithRooms(catalog, [room])
    } catch (error) {
      warn(`room "${room.id}" is left out: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return catalog
}
