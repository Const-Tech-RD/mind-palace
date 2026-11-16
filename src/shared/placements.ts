/**
 * Where each earned item stands, given what the user arranged. Pure.
 *
 * The engine decides what a room has earned (`RoomState`). The user decides
 * where it goes: a `placements` row moves an item to another slot, picks a
 * variant, or hides it. Rows always win: the engine never moves, hides or
 * removes an item the user placed. Items without a row go to their catalog
 * slot when it is free; otherwise they wait in the room's inventory.
 */
import type { Catalog, ItemDef, SlotDef } from './catalog'
import type { PlacedItem, RoomState } from './engine'

/** One `placements` row. `slot` null means the item's default slot. */
export interface Placement {
  roomId: string
  /** The engine's key for the item: `item@defaultSlot#index`. */
  instance: string
  slot: string | null
  variant: string | null
  hidden: boolean
}

export interface ResolvedItem extends PlacedItem {
  instance: string
  /** `slot` is where it stands now; this is where the catalog puts it. */
  defaultSlot: string
  variant: string | null
  userPlaced: boolean
}

export type InventoryReason = 'hidden' | 'replaced' | 'no_free_slot' | 'needs_host' | 'invalid_slot'

export interface InventoryItem {
  instance: string
  item: string
  reason: InventoryReason
}

export interface ResolvedRoom {
  placed: ResolvedItem[]
  inventory: InventoryItem[]
}

/** The same key the palace uses for an engine-placed item. */
export const instanceKey = (item: Pick<PlacedItem, 'item' | 'slot' | 'index'>): string => `${item.item}@${item.slot}#${item.index}`

const capacityOf = (slot: SlotDef): number => slot.capacity ?? 1

/** Slots other slots stand on (`desk`, `wall_left_b`), with the slots they carry. */
function hostSlots(catalog: Catalog): Set<string> {
  return new Set(Object.values(catalog.rules.layout.slots).flatMap((s) => (s.host ? [s.host] : [])))
}

/** Whether an item may stand in a slot: same kind; floor and rug footprints fit (mirrored too); wall items fit the run. */
export function fits(item: ItemDef, slot: SlotDef): boolean {
  if (!item.slots.includes(slot.kind)) return false
  if (slot.kind === 'wall') return (item.width ?? 1) <= (slot.width ?? 1)
  if (slot.kind === 'floor' || slot.kind === 'rug') {
    const [w, d] = item.footprint ?? [1, 1]
    const [sw, sd] = slot.footprint ?? [w, d]
    return (w <= sw && d <= sd) || (item.mirrorable && d <= sw && w <= sd)
  }
  return true
}

export function resolvePlacements(state: RoomState, rows: readonly Placement[], catalog: Catalog): ResolvedRoom {
  const slots = catalog.rules.layout.slots
  const rowOf = new Map(rows.filter((r) => r.roomId === state.roomId).map((r) => [r.instance, r]))
  const occupants = new Map<string, number>()
  const take = (slot: string): void => void occupants.set(slot, (occupants.get(slot) ?? 0) + 1)
  const free = (slot: string): boolean => (occupants.get(slot) ?? 0) < capacityOf(slots[slot]!)

  const placed: ResolvedItem[] = []
  const inventory: InventoryItem[] = []
  const shelve = (p: PlacedItem, reason: InventoryReason): void => void inventory.push({ instance: instanceKey(p), item: p.item, reason })
  const put = (p: PlacedItem, slot: string, row: Placement | undefined): void => {
    take(slot)
    placed.push({ ...p, slot, instance: instanceKey(p), defaultSlot: p.slot, variant: row?.variant ?? null, userPlaced: row !== undefined })
  }

  // 1. What the user arranged, for everything the room has earned.
  const earned = [...state.items, ...state.replaced]
  for (const p of earned) {
    const row = rowOf.get(instanceKey(p))
    if (!row) continue
    if (row.hidden) {
      shelve(p, 'hidden')
      continue
    }
    const slot = row.slot ?? p.slot
    const def = catalog.items[p.item]
    if (!slots[slot] || !def || (slot !== p.slot && !fits(def, slots[slot]!))) shelve(p, 'invalid_slot')
    else if (!free(slot)) shelve(p, 'no_free_slot')
    else put(p, slot, row)
  }

  // 2. Everything else where the catalog puts it, if the user left that slot free.
  for (const p of state.items) {
    if (rowOf.has(instanceKey(p))) continue
    if (!slots[p.slot]) shelve(p, 'invalid_slot')
    else if (free(p.slot)) put(p, p.slot, undefined)
    else shelve(p, 'no_free_slot')
  }
  for (const p of state.replaced) if (!rowOf.has(instanceKey(p))) shelve(p, 'replaced')

  // 3. Things on a desk or shelf need it to be there.
  const standing = placed.filter((p) => {
    const host = slots[p.slot]?.host
    if (host === undefined || placed.some((q) => q.slot === host)) return true
    shelve(p, 'needs_host')
    return false
  })

  return { placed: standing, inventory }
}

/** A change the room editor asks for. Only the fields given change. */
export interface PlacementChange {
  roomId: string
  instance: string
  slot?: string | null
  variant?: string | null
  hidden?: boolean
}

export type PlacementCheck = { ok: true } | { ok: false; reason: string }

/**
 * The row an item has after a change. Only the fields given change, except
 * that moving an item to a spot also shows it unless the change says otherwise.
 */
export function nextPlacement(current: Placement | undefined, change: PlacementChange): Placement {
  return {
    roomId: change.roomId,
    instance: change.instance,
    slot: change.slot !== undefined ? change.slot : (current?.slot ?? null),
    variant: change.variant !== undefined ? change.variant : (current?.variant ?? null),
    hidden: change.hidden ?? (change.slot != null ? false : (current?.hidden ?? false))
  }
}

export function checkPlacement(change: PlacementChange, state: RoomState, rows: readonly Placement[], catalog: Catalog): PlacementCheck {
  const slots = catalog.rules.layout.slots
  const earned = [...state.items, ...state.replaced].find((p) => instanceKey(p) === change.instance)
  if (!earned) return { ok: false, reason: `"${change.instance}" is not unlocked in this room` }
  const def = catalog.items[earned.item]
  if (!def) return { ok: false, reason: `"${earned.item}" has no item definition` }

  if (change.variant != null && !def.variants.includes(change.variant)) {
    return { ok: false, reason: `"${earned.item}" has no variant "${change.variant}"` }
  }

  // Judge where the item really ends up, not only the fields the change names:
  // showing it, or sending it back to its default spot, must not bump anything.
  const current = rows.find((r) => r.roomId === change.roomId && r.instance === change.instance)
  const next = nextPlacement(current, change)
  if (next.hidden) return { ok: true }
  const target = next.slot ?? earned.slot
  const hosts = hostSlots(catalog)
  const slot = slots[target]
  if (!slot) return { ok: false, reason: `there is no slot "${target}"` }
  if (target !== earned.slot) {
    if (hosts.has(earned.slot)) return { ok: false, reason: `"${earned.item}" carries other things and cannot be moved; hide it instead` }
    if (hosts.has(target)) return { ok: false, reason: `slot "${target}" is reserved for what stands on it` }
    if (!fits(def, slot)) return { ok: false, reason: `"${earned.item}" does not fit in slot "${target}"` }
  }
  const placed = resolvePlacements(state, rows, catalog).placed
  const others = placed.filter((p) => p.slot === target && p.instance !== change.instance)
  if (others.length >= capacityOf(slot)) return { ok: false, reason: `slot "${target}" is taken by ${others.map((p) => p.item).join(', ')}` }
  if (slot.host !== undefined && !placed.some((p) => p.slot === slot.host && p.instance !== change.instance)) {
    return { ok: false, reason: `slot "${target}" needs what it stands on, which is not in the room` }
  }
  return { ok: true }
}
