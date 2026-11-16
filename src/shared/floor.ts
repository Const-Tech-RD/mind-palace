/**
 * The connected palace as data: four 8 x 8 rooms in a 2 x 2 grid joined by
 * hallways, with every wall and every placed item
 * given a position on that one floor. Pure: the canvas only draws what this
 * returns. Until sprites exist each item is a block sized by its footprint and
 * height (plan v2, "Before sprites exist").
 *
 * Tile coordinates are [x, y] with the palace's back corner at [0, 0]: x runs
 * down-right on screen, y down-left, z is up. That matches the room layout in
 * rules.json, where x runs along a room's right wall and y along its left wall.
 */
import type { Catalog, ShellTier } from './catalog'
import type { PlacedItem, RoomState } from './engine'

/** Logical pixels (asset spec v0.2 section 1): a 64 x 32 floor diamond, 32 px per unit of height. */
export const TILE = { w: 64, h: 32, unit: 32 } as const
export const ROOM_TILES = 8
/**
 * Plan v2 asks for 2-tile hallways. The rooms are shown as their paintings,
 * whose back walls are almost five units tall; at 2 tiles a front room's walls
 * would cover the floor of the room behind it. Five tiles is the narrowest
 * hallway at which no painted wall reaches another room's floor.
 */
export const HALL_TILES = 5
/** The middle of the lobby, where the hallways cross. */
export const LOBBY = ROOM_TILES + HALL_TILES / 2
/** How tall a painted room's back walls are, in units (measured on the cut-outs). */
export const PAINTED_WALL = 4.8
export const PALACE_TILES = ROOM_TILES * 2 + HALL_TILES
const FAR = ROOM_TILES + HALL_TILES

/** Coding room back, Art workshop right, Music studio left, Mail room front. */
export const ROOM_ORIGIN: Readonly<Record<string, readonly [number, number]>> = {
  coding: [0, 0],
  art: [FAR, 0],
  music: [0, FAR],
  mailroom: [FAR, FAR]
}

export const WALL_FULL = 4
export const WALL_LOW = 1
/** The doorway in a low wall: these tiles along the wall are left open. */
export const DOORWAY: readonly [number, number] = [3, 5]

/** Heights, in units, of items the catalog does not describe yet (NOTES item 8). */
const BASE_HEIGHT: Readonly<Record<string, number>> = {
  base_desk: 1,
  base_crate: 0.7,
  base_chair: 1.5,
  base_rug: 0.04,
  base_bookshelf_low: 1.5,
  base_plant_small: 1,
  base_plant_large: 2,
  base_floor_lamp: 2.5,
  base_couch: 1,
  base_poster: 1.4,
  window: 1.6,
  trophy_shelf: 0.25,
  trophy: 0.45
}

export interface ScreenPoint {
  x: number
  y: number
}

/** Where a point on the floor lands on screen, in logical pixels from the back corner. */
export function iso(x: number, y: number, z = 0): ScreenPoint {
  return { x: ((x - y) * TILE.w) / 2, y: ((x + y) * TILE.h) / 2 - z * TILE.unit }
}

export interface FloorBlock {
  key: string
  item: string
  slot: string
  layer: string
  /** Back corner on the palace floor, footprint, bottom and height, all in tiles or units. */
  x: number
  y: number
  w: number
  d: number
  z: number
  h: number
  isNew: boolean
  /** Draw order inside the room: lower first. */
  depth: number
}

export interface FloorWall {
  /** `x`: runs along x at a fixed y. `y`: runs along y at a fixed x. */
  along: 'x' | 'y'
  x: number
  y: number
  length: number
  height: number
  /** Tiles along the wall left open, or null for a solid wall. */
  doorway: readonly [number, number] | null
  /** Front walls are drawn after the room's furniture, back walls before. */
  front: boolean
}

export interface FloorRoom {
  id: string
  name: string
  accent: string
  origin: readonly [number, number]
  shell: ShellTier
  streak: number
  walls: FloorWall[]
  blocks: FloorBlock[]
  /** Where a character sits for a running session, and where helpers stand. */
  seat: readonly [number, number]
  helperSpots: ReadonlyArray<readonly [number, number]>
  /** Draw order between rooms: back to front. */
  order: number
}

export interface FloorView {
  tiles: number
  rooms: FloorRoom[]
  /** The two hallways, as rectangles of tiles; they cross in the lobby. */
  halls: Array<{ x: number; y: number; w: number; d: number }>
  /** Screen box of the whole floor including full-height walls, in logical pixels. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

type Slot = {
  layer: string
  tile?: readonly [number, number]
  footprint?: readonly [number, number]
  host?: string
  wall?: 'left' | 'right'
  from_tile?: number
  width?: number
  bottom_z?: number
  capacity?: number
}

function heightOf(catalog: Catalog, roomId: string, item: string): number {
  return catalog.rooms[roomId]?.assets[item]?.height ?? BASE_HEIGHT[item] ?? 1
}

/** A wall slot's run along its wall, in room tiles. */
function wallRun(slot: Slot): { from: number; width: number; bottom: number } {
  return { from: slot.from_tile ?? 0, width: slot.width ?? 1, bottom: slot.bottom_z ?? 2 }
}

const WALL_THICKNESS = 0.12
const SURFACE_INSET = 0.2

/**
 * One placed item as a block on the palace floor, or null when its slot is
 * unknown to the layout. `items` is the room's whole set, needed to find the
 * height of what a surface item sits on.
 */
export function placeBlock(
  catalog: Catalog,
  roomId: string,
  origin: readonly [number, number],
  placed: PlacedItem,
  items: readonly PlacedItem[]
): Omit<FloorBlock, 'isNew' | 'key'> | null {
  const slots = catalog.rules.layout.slots as Record<string, Slot>
  const slot = slots[placed.slot]
  if (!slot) return null
  const [ox, oy] = origin
  const h = heightOf(catalog, roomId, placed.item)
  const base = { item: placed.item, slot: placed.slot, layer: slot.layer }

  const onWall = (wallSlot: Slot, from: number, width: number, z: number, height: number, lift: number) =>
    wallSlot.wall === 'right'
      ? { ...base, x: ox + from, y: oy, w: width, d: WALL_THICKNESS, z, h: height, depth: lift + (from + width) / 100 }
      : { ...base, x: ox, y: oy + from, w: WALL_THICKNESS, d: width, z, h: height, depth: lift + (from + width) / 100 }

  if (slot.wall) {
    const run = wallRun(slot)
    return onWall(slot, run.from, run.width, run.bottom, h, -2)
  }

  const host = slot.host ? slots[slot.host] : undefined
  if (host?.wall) {
    // Things on a wall shelf (trophies): spread evenly along it, standing on top.
    const run = wallRun(host)
    const capacity = slot.capacity ?? 1
    const each = run.width / capacity
    const shelfItem = items.find((i) => i.slot === slot.host)
    const top = run.bottom + (shelfItem ? heightOf(catalog, roomId, shelfItem.item) : 0)
    const size = Math.min(each * 0.6, 0.3)
    return onWall(host, run.from + each * placed.index + (each - size) / 2, size, top, h, -1)
  }

  if (slot.layer === 'surface_item' && slot.tile) {
    const hostItem = items.find((i) => i.slot === slot.host)
    const z = hostItem ? heightOf(catalog, roomId, hostItem.item) : 1
    const [tx, ty] = slot.tile
    const size = 1 - SURFACE_INSET * 2
    // Drawn right after whatever it stands on.
    const [hx, hy] = host?.tile ?? [tx, ty]
    const [hw, hd] = host?.footprint ?? [1, 1]
    return { ...base, x: ox + tx + SURFACE_INSET, y: oy + ty + SURFACE_INSET, w: size, d: size, z, h, depth: hx + hw + hy + hd + 0.01 }
  }

  if (!slot.tile) return null
  const [tx, ty] = slot.tile
  const [w, d] = slot.footprint ?? [1, 1]
  // Rugs lie under everything; the rest sort by their front corner.
  const depth = slot.layer === 'rug' ? -0.5 : tx + w + ty + d
  return { ...base, x: ox + tx, y: oy + ty, w, d, z: 0, h, depth }
}

function wallsOf(origin: readonly [number, number]): FloorWall[] {
  const [ox, oy] = origin
  const outerRight = oy === 0
  const outerLeft = ox === 0
  const walls: FloorWall[] = [
    // Back walls: full height on the outside of the palace, low with a doorway onto a hallway.
    { along: 'x', x: ox, y: oy, length: ROOM_TILES, height: outerRight ? WALL_FULL : WALL_LOW, doorway: outerRight ? null : DOORWAY, front: false },
    { along: 'y', x: ox, y: oy, length: ROOM_TILES, height: outerLeft ? WALL_FULL : WALL_LOW, doorway: outerLeft ? null : DOORWAY, front: false }
  ]
  // Front walls exist only where they face a hallway, and are always low, so a
  // front room never hides a back one. The palace's own front edge stays open.
  if (ox === 0) walls.push({ along: 'y', x: ox + ROOM_TILES, y: oy, length: ROOM_TILES, height: WALL_LOW, doorway: DOORWAY, front: true })
  if (oy === 0) walls.push({ along: 'x', x: ox, y: oy + ROOM_TILES, length: ROOM_TILES, height: WALL_LOW, doorway: DOORWAY, front: true })
  return walls
}

/** The whole floor for the given room states. Rooms the layout has no place for are left out. */
export function buildFloor(
  catalog: Catalog,
  rooms: ReadonlyArray<{ id: string; name: string; accent: string; state: RoomState; newItems: readonly string[] }>,
  itemKey: (item: PlacedItem) => string
): FloorView {
  const slots = catalog.rules.layout.slots as Record<string, Slot>
  const seatTile = slots['seat']?.tile ?? [3, 1]
  const floorRooms: FloorRoom[] = []
  for (const room of rooms) {
    const origin = ROOM_ORIGIN[room.id]
    if (!origin) continue
    const fresh = new Set(room.newItems)
    const blocks: FloorBlock[] = []
    for (const placed of room.state.items) {
      const block = placeBlock(catalog, room.id, origin, placed, room.state.items)
      if (!block) continue
      const key = itemKey(placed)
      blocks.push({ ...block, key, isNew: fresh.has(key) })
    }
    blocks.sort((a, b) => a.depth - b.depth || a.z - b.z)
    floorRooms.push({
      id: room.id,
      name: room.name,
      accent: room.accent,
      origin,
      shell: room.state.shell,
      streak: room.state.streak.current,
      walls: wallsOf(origin),
      blocks,
      seat: [origin[0] + seatTile[0], origin[1] + seatTile[1]],
      helperSpots: [
        [origin[0] + 6, origin[1] + 2],
        [origin[0] + 3, origin[1] + 5],
        [origin[0] + 6, origin[1] + 6]
      ],
      order: origin[0] + origin[1]
    })
  }
  floorRooms.sort((a, b) => a.order - b.order || a.origin[0] - b.origin[0])

  const corners = [iso(0, 0, PAINTED_WALL), iso(PALACE_TILES, 0, PAINTED_WALL), iso(0, PALACE_TILES, PAINTED_WALL), iso(PALACE_TILES, PALACE_TILES)]
  return {
    tiles: PALACE_TILES,
    rooms: floorRooms,
    halls: [
      { x: ROOM_TILES, y: 0, w: HALL_TILES, d: PALACE_TILES },
      { x: 0, y: ROOM_TILES, w: PALACE_TILES, d: HALL_TILES }
    ],
    bounds: {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y))
    }
  }
}

/** Which room a floor tile belongs to, or null for a hallway or outside the palace. */
export function roomAt(x: number, y: number): string | null {
  for (const [id, [ox, oy]] of Object.entries(ROOM_ORIGIN)) {
    if (x >= ox && x < ox + ROOM_TILES && y >= oy && y < oy + ROOM_TILES) return id
  }
  return null
}

/** The floor tile under a screen point (the inverse of `iso` at z = 0). */
export function tileAt(point: ScreenPoint): { x: number; y: number } {
  const a = point.x / (TILE.w / 2)
  const b = point.y / (TILE.h / 2)
  return { x: (a + b) / 2, y: (b - a) / 2 }
}
