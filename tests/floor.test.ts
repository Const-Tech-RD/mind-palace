import { describe, expect, it } from 'vitest'
import type { HistoryRows } from '../src/shared/engine'
import { buildFloor, DOORWAY, HALL_TILES, iso, nextCell, TILE, roomAt, tileAt, WALL_FULL, WALL_LOW, type Cell } from '../src/shared/floor'
import { catalogWithRooms } from '../src/shared/rooms'
import { CODING } from './fixtures/rooms'
import type { Placement } from '../src/shared/placements'
import { buildPalace } from '../src/shared/palace'
import { addDays } from './shared'
import { catalog } from './helpers'

const TODAY = '2026-11-12'
const rows = (roomId: string, days: number, goals = 0): HistoryRows => ({
  chats: [{ id: 'c1', roomId }],
  messages: Array.from({ length: days }, (_, i) => ({ chatId: 'c1', role: 'user', createdAt: `${addDays(TODAY, -i)}T16:00:00.000Z` })),
  goalCompletions: Array.from({ length: goals }, (_, i) => ({ projectId: `p${i}`, roomId, localDay: addDays(TODAY, -i - 1) }))
})
const floorOf = (r: HistoryRows, seen: Record<string, string[] | null> = {}, focus: string | null = null, placements: Placement[] = []) =>
  buildPalace({ catalog, rows: r, timeZone: 'America/Santo_Domingo', today: TODAY, seen, placements, focus }).floor
const empty: HistoryRows = { chats: [], messages: [], goalCompletions: [] }

describe('iso', () => {
  it('maps the back corner to the origin and runs x down-right, y down-left, z up', () => {
    expect(iso(0, 0)).toEqual({ x: 0, y: 0 })
    expect(iso(1, 0)).toEqual({ x: 32, y: 16 })
    expect(iso(0, 1)).toEqual({ x: -32, y: 16 })
    expect(iso(0, 0, 1)).toEqual({ x: 0, y: -32 })
  })

  it('tileAt undoes it on the floor', () => {
    const tile = tileAt(iso(11.5, 3.25))
    expect(tile.x).toBeCloseTo(11.5)
    expect(tile.y).toBeCloseTo(3.25)
  })
})

describe('the hallways', () => {
  it('are 2 tiles wide, as plan v2 and the asset spec say', () => {
    expect(HALL_TILES).toBe(2)
    expect(floorOf(empty).lobby).toEqual([9, 9])
  })

  it('only ever have low walls facing them, so no wall in front hides a room behind', () => {
    for (const room of floorOf(empty).rooms) {
      for (const wall of room.walls) {
        const outer = (wall.along === 'x' && wall.y === 0 && !wall.front) || (wall.along === 'y' && wall.x === 0 && !wall.front)
        if (!outer) expect(wall.height, `${room.id} ${wall.along} wall at ${wall.x},${wall.y}`).toBe(WALL_LOW)
      }
    }
  })
})

describe('the connected floor', () => {
  it('is 18 x 18 with four rooms drawn back to front: coding, then art and music, then the mail room', () => {
    const floor = floorOf(empty)
    expect(floor.tiles).toBe(18)
    expect(floor.rooms.map((r) => r.id)).toEqual(['coding', 'music', 'art', 'mailroom'])
    expect(floor.rooms.map((r) => r.origin)).toEqual([[0, 0], [0, 10], [10, 0], [10, 10]])
  })

  it('has two hallways that cross, and no room on them', () => {
    const floor = floorOf(empty)
    // The same tiles as the two crossing hallways of the fixed four-room palace.
    expect(hallTiles(floor.halls)).toEqual(hallTiles([{ x: 8, y: 0, w: 2, d: 18 }, { x: 0, y: 8, w: 18, d: 2 }]))
    expect(roomAt(floor, 3, 3)).toBe('coding')
    expect(roomAt(floor, 11, 1)).toBe('art')
    expect(roomAt(floor, 1, 11)).toBe('music')
    expect(roomAt(floor, 17.9, 17.9)).toBe('mailroom')
    expect(roomAt(floor, 8.5, 3)).toBeNull()
    expect(roomAt(floor, 9.9, 3)).toBeNull()
    expect(roomAt(floor, 3, 9)).toBeNull()
    expect(roomAt(floor, 18, 3)).toBeNull()
  })

  it('gives outer back walls full height and makes every wall onto a hallway low with a doorway', () => {
    const walls = Object.fromEntries(floorOf(empty).rooms.map((r) => [r.id, r.walls]))
    const back = (id: string) => walls[id]!.filter((w) => !w.front).map((w) => [w.along, w.height, w.doorway])
    expect(back('coding')).toEqual([['x', WALL_FULL, null], ['y', WALL_FULL, null]])
    expect(back('art')).toEqual([['x', WALL_FULL, null], ['y', WALL_LOW, DOORWAY]])
    expect(back('music')).toEqual([['x', WALL_LOW, DOORWAY], ['y', WALL_FULL, null]])
    expect(back('mailroom')).toEqual([['x', WALL_LOW, DOORWAY], ['y', WALL_LOW, DOORWAY]])
    // Front walls only where a hallway is: two for the back room, one each at the sides, none at the front.
    const front = (id: string) => walls[id]!.filter((w) => w.front)
    expect(front('coding')).toHaveLength(2)
    expect(front('art')).toHaveLength(1)
    expect(front('music')).toHaveLength(1)
    expect(front('mailroom')).toHaveLength(0)
    expect(front('coding').every((w) => w.height === WALL_LOW && w.doorway !== null)).toBe(true)
  })

  it('places the starting furniture of every room at its slot, offset by the room', () => {
    const floor = floorOf(empty)
    for (const room of floor.rooms) {
      const [ox, oy] = room.origin
      const desk = room.blocks.find((b) => b.item === 'base_desk')!
      expect([desk.x, desk.y, desk.w, desk.d, desk.z]).toEqual([ox + 2, oy, 3, 1, 0])
      const crate = room.blocks.find((b) => b.item === 'base_crate')!
      expect([crate.x, crate.y]).toEqual([ox + 3, oy + 1])
      expect(room.seat).toEqual([ox + 3, oy + 1])
      expect(room.helperSpots).toHaveLength(3)
    }
  })

  it('stands a desk item on the desk, not on the floor', () => {
    const coding = floorOf(empty).rooms.find((r) => r.id === 'coding')!
    const laptop = coding.blocks.find((b) => b.item === 'coding_laptop')!
    const desk = coding.blocks.find((b) => b.item === 'base_desk')!
    expect(laptop.z).toBe(desk.h)
    expect(laptop.x).toBeGreaterThan(3)
    expect(laptop.x + laptop.w).toBeLessThan(4)
    expect(laptop.depth).toBeGreaterThan(desk.depth)
  })

  it('hangs wall items on their wall and stands trophies on the shelf', () => {
    const coding = floorOf(rows('coding', 8, 3)).rooms.find((r) => r.id === 'coding')!
    const board = coding.blocks.find((b) => b.item === 'coding_whiteboard')!
    expect([board.x, board.y, board.w, board.z]).toEqual([5, 0, 2, 2]) // right wall, tiles 5-6, two units up
    expect(board.d).toBeLessThan(0.5)
    const shelf = coding.blocks.find((b) => b.item === 'trophy_shelf')!
    expect([shelf.x, shelf.y, shelf.d]).toEqual([0, 4, 2]) // left wall, tiles 4-5
    const trophies = coding.blocks.filter((b) => b.item === 'trophy')
    expect(trophies).toHaveLength(3)
    for (const trophy of trophies) {
      expect(trophy.z).toBeCloseTo(shelf.z + shelf.h)
      expect(trophy.y).toBeGreaterThanOrEqual(4)
      expect(trophy.y + trophy.d).toBeLessThanOrEqual(6)
    }
    expect(new Set(trophies.map((t) => t.y)).size).toBe(3) // side by side, not stacked
  })

  it('draws the rug first and nearer things later', () => {
    const blocks = floorOf(rows('coding', 13)).rooms.find((r) => r.id === 'coding')!.blocks
    const order = blocks.filter((b) => b.layer !== 'wall_item').map((b) => b.item)
    expect(order[0]).toBe('base_rug')
    expect(order.indexOf('base_desk')).toBeLessThan(order.indexOf('base_chair'))
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.depth).toBeGreaterThanOrEqual(blocks[i - 1]!.depth)
  })

  it('marks what is new since the last visit', () => {
    const before = buildPalace({ catalog, rows: rows('coding', 1), timeZone: 'UTC', today: TODAY, seen: {} })
    const seen = { coding: before.rooms.find((r) => r.id === 'coding')!.state.items.map((i) => `${i.item}@${i.slot}#${i.index}`).concat('shell:bare') }
    const coding = floorOf(rows('coding', 2), seen).rooms.find((r) => r.id === 'coding')!
    expect(coding.blocks.filter((b) => b.isNew).map((b) => b.item)).toEqual(['base_chair'])
  })

  it('reports a screen box that holds the whole floor and the tallest walls', () => {
    const { bounds } = floorOf(empty)
    expect(bounds).toEqual({ minX: -576, maxX: 576, minY: -128, maxY: 576 })
  })
})

describe('focus, placements and decay on the floor', () => {
  // A goal unlocks the trophy shelf on wall_left_b: Art's left wall is low, onto a hallway.
  const withShelf = (roomId: string): HistoryRows => rows(roomId, 1, 1)
  const art = (focus: string | null) => floorOf(withShelf('art'), {}, focus).rooms.find((r) => r.id === 'art')!

  it('leaves out items on a low wall in the whole-palace view and counts them', () => {
    const room = art(null)
    expect(room.blocks.some((b) => b.item === 'trophy_shelf')).toBe(false)
    expect(room.hiddenWallItems).toBe(2) // the shelf and its trophy
  })

  it("raises the focused room's back walls and shows everything on them", () => {
    const room = art('art')
    expect(room.walls.filter((w) => !w.front).every((w) => w.height === WALL_FULL)).toBe(true)
    expect(room.blocks.filter((b) => b.item === 'trophy_shelf' || b.item === 'trophy').map((b) => b.onLowWall)).toEqual([true, true])
    expect(room.hiddenWallItems).toBe(0)
  })

  it('keeps wall items on the outer walls in view, focused or not', () => {
    const coding = floorOf(withShelf('coding')).rooms.find((r) => r.id === 'coding')!
    expect(coding.blocks.some((b) => b.item === 'trophy_shelf' && !b.onLowWall)).toBe(true)
    expect(coding.hiddenWallItems).toBe(0)
  })

  it('draws a moved item at its new slot, with its instance and variant', () => {
    const placements: Placement[] = [{ roomId: 'coding', instance: 'base_crate@seat#0', slot: 'beside_seat', variant: 'pine', hidden: false }]
    const coding = floorOf(empty, {}, null, placements).rooms.find((r) => r.id === 'coding')!
    const crate = coding.blocks.find((b) => b.item === 'base_crate')!
    expect(crate).toMatchObject({ slot: 'beside_seat', instance: 'base_crate@seat#0', variant: 'pine', x: 5, y: 1 })
  })

  it("carries each room's decay level and light spot", () => {
    const r: HistoryRows = { ...empty, projects: [{ id: 'p', roomId: 'music', state: 'active', lastActivityDay: '2026-10-01' }] }
    const floor = floorOf(r)
    expect(floor.rooms.find((x) => x.id === 'music')!.decay).toBe(4)
    expect(floor.rooms.find((x) => x.id === 'coding')!.decay).toBe(0)
    // The coding room's light is its desk_center item (the laptop), on the desk.
    const coding = floor.rooms.find((x) => x.id === 'coding')!
    expect(coding.lightAt).toEqual([3.5, 0.5])
  })
})


/** Every hallway tile as "x,y", sorted. */
function hallTiles(halls: ReadonlyArray<{ x: number; y: number; w: number; d: number }>): string[] {
  const tiles = new Set<string>()
  for (const h of halls) for (let x = h.x; x < h.x + h.w; x++) for (let y = h.y; y < h.y + h.d; y++) tiles.add(`${x},${y}`)
  return [...tiles].sort()
}

describe('a palace that grows', () => {
  const only = (ids: string[]) => ({ ...catalog, rooms: Object.fromEntries(ids.map((id) => [id, catalog.rooms[id]!])) })
  const floorFor = (cat: typeof catalog, ethereal: { cell: Cell; name: string } | null = null) =>
    buildPalace({ catalog: cat, rows: empty, timeZone: 'UTC', today: TODAY, seen: {}, ethereal }).floor

  it('fills cells behind and beside the Mail room, nearest first', () => {
    const cells: Cell[] = [[0, 0]]
    for (let i = 0; i < 8; i++) cells.push(nextCell(cells))
    expect(cells.slice(1)).toEqual([[-1, 0], [0, -1], [-1, -1], [-2, 0], [0, -2], [-2, -1], [-1, -2], [-2, -2]])
  })

  it('never puts a room in front of the Mail room', () => {
    const cells: Cell[] = [[0, 0]]
    for (let i = 0; i < 20; i++) cells.push(nextCell(cells))
    for (const [x, y] of cells) expect(x <= 0 && y <= 0).toBe(true)
  })

  it('starts as the Mail room alone: 8 x 8, no hallways, full back walls', () => {
    const floor = floorFor(only(['mailroom']))
    expect(floor.tiles).toBe(8)
    expect(floor.halls).toEqual([])
    expect(floor.lobby).toBeNull()
    expect(floor.rooms[0]!.origin).toEqual([0, 0])
    expect(floor.rooms[0]!.walls.filter((w) => !w.front).map((w) => w.height)).toEqual([WALL_FULL, WALL_FULL])
    expect(floor.rooms[0]!.walls.filter((w) => w.front)).toEqual([])
  })

  it('makes a back wall low exactly where a room stands behind it', () => {
    // Mail room and the music cell beside it on the left.
    const floor = floorFor(only(['mailroom', 'music']))
    const mail = floor.rooms.find((r) => r.id === 'mailroom')!
    const music = floor.rooms.find((r) => r.id === 'music')!
    expect(mail.walls.filter((w) => !w.front).map((w) => [w.along, w.height])).toEqual([['x', WALL_FULL], ['y', WALL_LOW]])
    expect(music.walls.filter((w) => !w.front).map((w) => [w.along, w.height])).toEqual([['x', WALL_FULL], ['y', WALL_FULL]])
    expect(music.walls.filter((w) => w.front).map((w) => [w.along, w.height])).toEqual([['y', WALL_LOW]])
    expect(mail.walls.filter((w) => w.front)).toEqual([])
    expect(floor.halls).toEqual([{ x: 8, y: 0, w: 2, d: 8 }])
  })

  it('keeps every room where it was when another is added', () => {
    const fifth = { ...CODING, id: 'fifth', cell: [-2, 0] as [number, number], area: 'fifth' }
    const before = floorFor(catalog)
    const after = floorFor(catalogWithRooms(catalog, [fifth]))
    for (const room of before.rooms) {
      const moved = after.rooms.find((r) => r.id === room.id)!
      // The whole palace shifts by one cell to make room on the left; no room moves against the others.
      expect([moved.origin[0] - room.origin[0], moved.origin[1] - room.origin[1]]).toEqual([10, 0])
    }
    expect(after.rooms.find((r) => r.id === 'fifth')!.origin).toEqual([0, 10])
    expect(after.tiles).toBe(28)
  })

  it('draws a suggested room in the next free cell and makes room for it', () => {
    const floor = floorFor(only(['mailroom']), { cell: [-1, 0], name: '3D printing' })
    expect(floor.ethereal).toEqual({ origin: [0, 0], cell: [-1, 0], name: '3D printing' })
    expect(floor.rooms[0]!.origin).toEqual([10, 0])
    expect(floor.halls).toEqual([{ x: 8, y: 0, w: 2, d: 8 }])
    expect(floor.bounds.maxX).toBeGreaterThan(floorFor(only(["mailroom"])).bounds.maxX)
  })

  it('gives each room a door onto a hallway, on the way to the lobby', () => {
    const floor = floorFor(catalog)
    expect(floor.doors['coding']).toEqual([4, 9])
    expect(floor.doors['mailroom']).toEqual([9, 14])
    expect(Object.keys(floor.doors).sort()).toEqual(['art', 'coding', 'mailroom', 'music'])
  })

  it('builds the floor without any palace (no rooms at all)', () => {
    const floor = buildFloor(catalog, [], null)
    expect(floor.rooms).toEqual([])
    expect(floor.halls).toEqual([])
  })
})
