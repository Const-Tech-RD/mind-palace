import { describe, expect, it } from 'vitest'
import type { HistoryRows } from '../src/shared/engine'
import { DOORWAY, HALL_TILES, iso, LOBBY, PAINTED_WALL, PALACE_TILES, TILE, ROOM_ORIGIN, roomAt, tileAt, WALL_FULL, WALL_LOW } from '../src/shared/floor'
import { buildPalace } from '../src/shared/palace'
import { addDays } from './shared'
import { catalog } from './helpers'

const TODAY = '2026-11-12'
const rows = (roomId: string, days: number, goals = 0): HistoryRows => ({
  chats: [{ id: 'c1', roomId }],
  messages: Array.from({ length: days }, (_, i) => ({ chatId: 'c1', role: 'user', createdAt: `${addDays(TODAY, -i)}T16:00:00.000Z` })),
  goalCompletions: Array.from({ length: goals }, (_, i) => ({ projectId: `p${i}`, roomId, localDay: addDays(TODAY, -i - 1) }))
})
const floorOf = (r: HistoryRows, seen: Record<string, string[] | null> = {}) =>
  buildPalace({ catalog, rows: r, timeZone: 'America/Santo_Domingo', today: TODAY, seen }).floor
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
  it('are wide enough that no painted wall reaches the floor of the room behind it', () => {
    // A wall rises PAINTED_WALL units; one tile of hallway moves a front room's wall base 32 px down the screen.
    expect(HALL_TILES * TILE.h).toBeGreaterThanOrEqual(PAINTED_WALL * TILE.unit)
    expect(LOBBY).toBe(10.5)
  })
})

describe('the connected floor', () => {
  it('is 21 x 21 with four rooms drawn back to front: coding, then art and music, then the mail room', () => {
    const floor = floorOf(empty)
    expect(floor.tiles).toBe(21)
    expect(PALACE_TILES).toBe(21)
    expect(floor.rooms.map((r) => r.id)).toEqual(['coding', 'music', 'art', 'mailroom'])
    expect(floor.rooms.map((r) => r.origin)).toEqual([[0, 0], [0, 13], [13, 0], [13, 13]])
  })

  it('has two hallways that cross, and no room on them', () => {
    const floor = floorOf(empty)
    expect(floor.halls).toEqual([{ x: 8, y: 0, w: 5, d: 21 }, { x: 0, y: 8, w: 21, d: 5 }])
    expect(roomAt(3, 3)).toBe('coding')
    expect(roomAt(14, 1)).toBe('art')
    expect(roomAt(1, 14)).toBe('music')
    expect(roomAt(20.9, 20.9)).toBe('mailroom')
    expect(roomAt(8.5, 3)).toBeNull()
    expect(roomAt(12.9, 3)).toBeNull()
    expect(roomAt(3, 9)).toBeNull()
    expect(roomAt(21, 3)).toBeNull()
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
      const [ox, oy] = ROOM_ORIGIN[room.id]!
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
    expect(bounds).toEqual({ minX: -672, maxX: 672, minY: -153.6, maxY: 672 })
  })
})
