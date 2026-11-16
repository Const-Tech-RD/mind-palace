/**
 * The connected palace as data: 8 x 8 rooms on a grid of cells joined by
 * 2-tile hallways, with every wall and every placed item
 * given a position on that one floor. Pure: the canvas only draws what this
 * returns. Until sprites exist each item is a block sized by its footprint and
 * height (plan v2, "Before sprites exist").
 *
 * The Mail room is cell [0, 0], the front door. Rooms the person makes fill
 * cells behind and beside it (`nextCell`), never in front, and never move.
 *
 * Tile coordinates are [x, y] with the palace's back corner at [0, 0]: x runs
 * down-right on screen, y down-left, z is up. That matches the room layout in
 * rules.json, where x runs along a room's right wall and y along its left wall.
 */
import type { Catalog, Rules, ShellTier } from './catalog'
import type { DecayLevel, PlacedItem, RoomState } from './engine'
import type { ResolvedItem } from './placements'

/** Logical pixels (asset spec v0.2 section 1): a 64 x 32 floor diamond, 32 px per unit of height. */
export const TILE = { w: 64, h: 32, unit: 32 } as const
export const ROOM_TILES = 8
/** Plan v2 and the asset spec: 2-tile hallways. Walls facing a hallway are low, so none hides a room behind. */
export const HALL_TILES = 2
/** From one cell's back corner to the next: a room and a hallway. */
const CELL_TILES = ROOM_TILES + HALL_TILES

/** A room's place on the palace grid. The Mail room is [0, 0]; x grows down-right, y down-left. */
export type Cell = readonly [number, number]

/**
 * Where the next room goes: the first free cell, behind or beside the Mail
 * room (x <= 0 and y <= 0), that touches a room already there. Nearest ring
 * first, then the cell closest to the front, then the one on the left.
 */
export function nextCell(occupied: readonly Cell[]): Cell {
  const taken = new Set(occupied.map((c) => c.join(',')))
  const touches = ([x, y]: Cell): boolean =>
    taken.size === 0 || [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some((n) => taken.has(n.join(',')))
  for (let ring = 1; ; ring++) {
    const candidates: Cell[] = []
    for (let x = -ring; x <= 0; x++) for (let y = -ring; y <= 0; y++) if (Math.max(-x, -y) === ring) candidates.push([x, y])
    candidates.sort((a, b) => -(a[0] + a[1]) - -(b[0] + b[1]) || a[0] - b[0])
    const free = candidates.find((c) => !taken.has(c.join(',')) && touches(c))
    if (free) return free
  }
}

export const WALL_FULL = 4
export const WALL_LOW = 1
/** The doorway in a low wall: these tiles along the wall are left open. */
export const DOORWAY: readonly [number, number] = [3, 5]

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
  /** The engine's key for the item (`item@defaultSlot#index`), stable when the user moves it. */
  instance: string
  variant: string | null
  /** Hangs on (or stands on a shelf on) one of the room's low walls. */
  onLowWall: boolean
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
  cell: Cell
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
  decay: DecayLevel
  /** Wall items left out of the whole-palace view because their wall is low; shown when the room is focused. */
  hiddenWallItems: number
  /** Where the room's light glows from: its desk_center item, else the middle of the room. */
  lightAt: readonly [number, number]
}

export interface FloorView {
  /** The floor's longer side, in tiles. */
  tiles: number
  rooms: FloorRoom[]
  /** Hallway rectangles between neighbouring rooms, and the squares where they cross. */
  halls: Array<{ x: number; y: number; w: number; d: number }>
  /** The hallway spot nearest the Mail room's back corner, where walkers pass; null with no hallways. */
  lobby: readonly [number, number] | null
  /** Per room, the hallway spot outside its door on the way to the lobby. */
  doors: Record<string, readonly [number, number]>
  /** The suggested room, drawn as a ghost in the cell it would take. */
  ethereal: { origin: readonly [number, number]; cell: Cell; name: string } | null
  /** The slot layout shared by every room, in room tiles: the room editor hit-tests clicks against it. */
  slots: Rules['layout']['slots']
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
  return catalog.items[item]?.height ?? catalog.rooms[roomId]?.assets[item]?.height ?? 1
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
): Omit<FloorBlock, 'isNew' | 'key' | 'instance' | 'variant' | 'onLowWall'> | null {
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

/** Which sides of a cell have a neighbour (a room, or the suggested room). */
interface Sides {
  /** Behind the right wall (the wall along x): cell [x, y - 1]. */
  backX: boolean
  /** Behind the left wall (the wall along y): cell [x - 1, y]. */
  backY: boolean
  /** In front, across the right-hand front edge: cell [x + 1, y]. */
  frontY: boolean
  /** In front, across the left-hand front edge: cell [x, y + 1]. */
  frontX: boolean
}

function wallsOf(origin: readonly [number, number], sides: Sides, focused: boolean): FloorWall[] {
  const [ox, oy] = origin
  // A focused room's back walls rise to full height so what hangs on them shows (plan decision 2).
  const outerRight = !sides.backX || focused
  const outerLeft = !sides.backY || focused
  const walls: FloorWall[] = [
    // Back walls: full height on the outside of the palace, low with a doorway onto a hallway.
    { along: 'x', x: ox, y: oy, length: ROOM_TILES, height: outerRight ? WALL_FULL : WALL_LOW, doorway: outerRight ? null : DOORWAY, front: false },
    { along: 'y', x: ox, y: oy, length: ROOM_TILES, height: outerLeft ? WALL_FULL : WALL_LOW, doorway: outerLeft ? null : DOORWAY, front: false }
  ]
  // Front walls exist only where they face a hallway, and are always low, so a
  // front room never hides a back one. The palace's own front edge stays open.
  if (sides.frontY) walls.push({ along: 'y', x: ox + ROOM_TILES, y: oy, length: ROOM_TILES, height: WALL_LOW, doorway: DOORWAY, front: true })
  if (sides.frontX) walls.push({ along: 'x', x: ox, y: oy + ROOM_TILES, length: ROOM_TILES, height: WALL_LOW, doorway: DOORWAY, front: true })
  return walls
}

type Hall = { x: number; y: number; w: number; d: number }

/** Hallway strips between neighbouring cells, and the square where hallways cross (3 or 4 cells around it). */
function hallsOf(cells: readonly Cell[], originOf: (cell: Cell) => readonly [number, number]): Hall[] {
  const taken = new Set(cells.map((c) => c.join(',')))
  const has = (x: number, y: number): boolean => taken.has(`${x},${y}`)
  const halls: Hall[] = []
  for (const [cx, cy] of [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const [ox, oy] = originOf([cx, cy])
    if (has(cx + 1, cy)) halls.push({ x: ox + ROOM_TILES, y: oy, w: HALL_TILES, d: ROOM_TILES })
    if (has(cx, cy + 1)) halls.push({ x: ox, y: oy + ROOM_TILES, w: ROOM_TILES, d: HALL_TILES })
    const around = [has(cx, cy), has(cx + 1, cy), has(cx, cy + 1), has(cx + 1, cy + 1)].filter(Boolean).length
    if (around >= 3) halls.push({ x: ox + ROOM_TILES, y: oy + ROOM_TILES, w: HALL_TILES, d: HALL_TILES })
  }
  return halls
}

const centreOf = (h: Hall): [number, number] => [h.x + h.w / 2, h.y + h.d / 2]
const distance = (a: readonly [number, number], b: readonly [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1])
const touchesRoom = (h: Hall, [ox, oy]: readonly [number, number]): boolean =>
  h.x <= ox + ROOM_TILES && h.x + h.w >= ox && h.y <= oy + ROOM_TILES && h.y + h.d >= oy &&
  // Strips only (not crossing squares), sharing a whole side with the room.
  (h.w === ROOM_TILES || h.d === ROOM_TILES) &&
  ((h.w === ROOM_TILES && h.x === ox) || (h.d === ROOM_TILES && h.y === oy))

/** The whole floor for the given room states. Rooms the layout has no place for are left out. */
export function buildFloor(
  catalog: Catalog,
  rooms: ReadonlyArray<{
    id: string
    name: string
    accent: string
    cell: Cell
    state: RoomState
    newItems: readonly string[]
    /** Where each item stands after the user's placements. */
    placed: readonly ResolvedItem[]
    decay: DecayLevel
  }>,
  focus: string | null = null,
  ethereal: { cell: Cell; name: string } | null = null
): FloorView {
  const slots = catalog.rules.layout.slots as Record<string, Slot>
  const seatTile = slots['seat']?.tile ?? [3, 1]
  // Every cell in use, the suggested one too: hallways reach it and walls next to it are low.
  const cells: Cell[] = [...rooms.map((r) => r.cell), ...(ethereal ? [ethereal.cell] : [])]
  const minX = Math.min(0, ...cells.map((c) => c[0]))
  const minY = Math.min(0, ...cells.map((c) => c[1]))
  const originOf = ([cx, cy]: Cell): readonly [number, number] => [(cx - minX) * CELL_TILES, (cy - minY) * CELL_TILES]
  const taken = new Set(cells.map((c) => c.join(',')))
  const has = (x: number, y: number): boolean => taken.has(`${x},${y}`)
  const floorRooms: FloorRoom[] = []
  for (const room of rooms) {
    const origin = originOf(room.cell)
    const [cx, cy] = room.cell
    const sides: Sides = { backX: has(cx, cy - 1), backY: has(cx - 1, cy), frontY: has(cx + 1, cy), frontX: has(cx, cy + 1) }
    const fresh = new Set(room.newItems)
    const focused = focus === room.id
    const lowWall = (side: 'left' | 'right' | undefined): boolean =>
      side === 'right' ? sides.backX : side === 'left' ? sides.backY : false
    const blocks: FloorBlock[] = []
    let hiddenWallItems = 0
    for (const placed of room.placed) {
      const block = placeBlock(catalog, room.id, origin, placed, room.placed)
      if (!block) continue
      const slot = slots[placed.slot]
      const side = slot?.wall ?? (slot?.host ? slots[slot.host]?.wall : undefined)
      const onLowWall = lowWall(side)
      if (onLowWall && !focused) {
        hiddenWallItems += 1
        continue
      }
      blocks.push({ ...block, key: placed.instance, instance: placed.instance, variant: placed.variant, onLowWall, isNew: fresh.has(placed.instance) })
    }
    const light = blocks.find((b) => b.slot === 'desk_center')
    blocks.sort((a, b) => a.depth - b.depth || a.z - b.z)
    floorRooms.push({
      id: room.id,
      name: room.name,
      accent: room.accent,
      cell: room.cell,
      origin,
      shell: room.state.shell,
      streak: room.state.streak.current,
      walls: wallsOf(origin, sides, focused),
      blocks,
      seat: [origin[0] + seatTile[0], origin[1] + seatTile[1]],
      helperSpots: [
        [origin[0] + 6, origin[1] + 2],
        [origin[0] + 3, origin[1] + 5],
        [origin[0] + 6, origin[1] + 6]
      ],
      order: origin[0] + origin[1],
      decay: room.decay,
      hiddenWallItems,
      lightAt: light ? [light.x + light.w / 2, light.y + light.d / 2] : [origin[0] + ROOM_TILES / 2, origin[1] + ROOM_TILES / 2]
    })
  }
  floorRooms.sort((a, b) => a.order - b.order || a.origin[0] - b.origin[0])

  const halls = hallsOf(cells, originOf)
  // Walkers cross at the hallway spot nearest the Mail room's back corner.
  const mail = floorRooms.find((r) => r.id === catalog.rules.classification.fallback_room)
  const lobby =
    halls.length === 0
      ? null
      : halls.map(centreOf).sort((a, b) => distance(a, mail?.origin ?? [0, 0]) - distance(b, mail?.origin ?? [0, 0]))[0]!
  const doors: Record<string, readonly [number, number]> = {}
  if (lobby) {
    for (const room of floorRooms) {
      const near = halls
        .filter((h) => touchesRoom(h, room.origin))
        .map(centreOf)
        .sort((a, b) => distance(a, lobby) - distance(b, lobby) || a[0] - b[0])[0]
      if (near) doors[room.id] = near
    }
  }

  const width = cells.length === 0 ? 0 : (Math.max(...cells.map((c) => c[0])) - minX) * CELL_TILES + ROOM_TILES
  const depth = cells.length === 0 ? 0 : (Math.max(...cells.map((c) => c[1])) - minY) * CELL_TILES + ROOM_TILES
  const corners = [iso(0, 0, WALL_FULL), iso(width, 0, WALL_FULL), iso(0, depth, WALL_FULL), iso(width, depth)]
  return {
    tiles: Math.max(width, depth),
    rooms: floorRooms,
    slots: catalog.rules.layout.slots,
    halls,
    lobby,
    doors,
    ethereal: ethereal ? { origin: originOf(ethereal.cell), cell: ethereal.cell, name: ethereal.name } : null,
    bounds: {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y))
    }
  }
}

/** Which room a floor tile belongs to, or null for a hallway or outside the palace. */
export function roomAt(floor: Pick<FloorView, 'rooms'>, x: number, y: number): string | null {
  for (const { id, origin: [ox, oy] } of floor.rooms) {
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
