/**
 * The room editor's rules, pure: where an item may go, which slot is under a
 * tile, and what to call a slot. The main process re-checks every change with
 * `checkPlacement`; these only decide what the editor offers.
 */
import type { Catalog, SlotDef } from './catalog'
import type { PalaceRoom } from './palace'
import { fits } from './placements'

/** `item@defaultSlot#index` → its parts. */
export function parseInstance(instance: string): { item: string; defaultSlot: string; index: number } | null {
  const match = /^(.+)@(.+)#(\d+)$/.exec(instance)
  return match ? { item: match[1]!, defaultSlot: match[2]!, index: Number(match[3]) } : null
}

/** Slots that carry other slots (the desk, the trophy shelf's wall spot). */
function hostSlots(catalog: Catalog): Set<string> {
  return new Set(Object.values(catalog.rules.layout.slots).flatMap((s) => (s.host ? [s.host] : [])))
}

/**
 * The free slots an item fits, in layout order. Never its own current slot, a
 * host slot, or anything for a host item (the desk carries other things).
 */
export function dropTargets(instance: string, room: Pick<PalaceRoom, 'placed'>, catalog: Catalog): string[] {
  const parts = parseInstance(instance)
  if (!parts) return []
  const hosts = hostSlots(catalog)
  if (hosts.has(parts.defaultSlot)) return []
  const def = catalog.items[parts.item]
  if (!def) return []
  const current = room.placed.find((p) => p.instance === instance)?.slot ?? null
  const used = new Map<string, number>()
  for (const p of room.placed) if (p.instance !== instance) used.set(p.slot, (used.get(p.slot) ?? 0) + 1)

  return Object.entries(catalog.rules.layout.slots)
    .filter(([id, slot]) => {
      if (id === current || hosts.has(id) || !fits(def, slot)) return false
      if ((used.get(id) ?? 0) >= (slot.capacity ?? 1)) return false
      return slot.host === undefined || room.placed.some((p) => p.slot === slot.host)
    })
    .map(([id]) => id)
}

/**
 * The slot under a point on the room's floor, in room tiles: a desk-top spot
 * first, then a floor spot (or the desk), then the rug beneath. Wall slots
 * are not on the floor; the editor lists them instead.
 */
export function slotAt(layout: Readonly<Record<string, SlotDef>>, x: number, y: number): string | null {
  const slots = Object.entries(layout)
  const under = (id: string): boolean => {
    const slot = layout[id]!
    const own = slot.tile ? slot : slot.host ? layout[slot.host] : undefined
    if (!slot.tile || !own) return false
    const [tx, ty] = slot.tile
    const [w, d] = slot.kind === 'desk_surface' ? [1, 1] : (slot.footprint ?? [1, 1])
    return x >= tx && x < tx + w && y >= ty && y < ty + d
  }
  for (const kinds of [['desk_surface'], ['floor', 'desk'], ['rug']]) {
    const hit = slots.find(([id, slot]) => kinds.includes(slot.kind) && under(id))
    if (hit) return hit[0]
  }
  return null
}

const SLOT_WORDS: Record<string, string> = {
  desk: 'The desk',
  desk_left: 'Desk, left',
  desk_center: 'Desk, middle',
  desk_right: 'Desk, right',
  seat: 'The seat',
  beside_seat: 'Beside the seat',
  corner_right: 'Right corner',
  floor_right: 'Floor, right',
  floor_left: 'Floor, left',
  plant: 'Plant corner',
  couch: 'Along the left wall',
  lamp: 'Lamp corner',
  rug: 'The rug',
  wall_right_a: 'Right wall, first spot',
  wall_right_b: 'Right wall, second spot',
  wall_left_a: 'Left wall, first spot',
  wall_left_b: 'Left wall, second spot',
  trophy_shelf: 'Trophy shelf'
}

/** A slot's name in words. */
export function slotLabel(slotId: string): string {
  return SLOT_WORDS[slotId] ?? slotId.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
