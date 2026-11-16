import { describe, expect, it } from 'vitest'
import { dropTargets, slotAt, slotLabel } from '../src/shared/editMode'
import { buildPalace } from '../src/shared/palace'
import type { HistoryRows } from '../src/shared/engine'
import type { Placement } from '../src/shared/placements'
import { addDays } from './shared'
import { catalog } from './helpers'

const TODAY = '2026-11-12'
const rows = (days: number, goals = 0): HistoryRows => ({
  chats: [{ id: 'c1', roomId: 'coding' }],
  messages: Array.from({ length: days }, (_, i) => ({ chatId: 'c1', role: 'user', createdAt: `${addDays(TODAY, -i)}T16:00:00.000Z` })),
  goalCompletions: Array.from({ length: goals }, (_, i) => ({ projectId: `p${i}`, roomId: 'coding', localDay: addDays(TODAY, -i - 1) }))
})
const coding = (r: HistoryRows, placements: Placement[] = []) =>
  buildPalace({ catalog, rows: r, timeZone: 'America/Santo_Domingo', today: TODAY, seen: {}, placements }).rooms.find((x) => x.id === 'coding')!

describe('dropTargets', () => {
  it('lists the free floor slots a chair fits, never the rug, walls, the desk or its own slot', () => {
    const targets = dropTargets('base_chair@seat#0', coding(rows(2)), catalog)
    expect(targets).toEqual(['beside_seat', 'corner_right', 'floor_right', 'floor_left', 'plant', 'couch', 'lamp'])
  })

  it('leaves out slots someone else stands in', () => {
    const room = coding(rows(13)) // the low bookshelf and the small plant are in floor_left and plant
    const targets = dropTargets('base_chair@seat#0', room, catalog)
    expect(targets).not.toContain('floor_left')
    expect(targets).not.toContain('plant')
  })

  it('offers nothing for the desk, which carries other things', () => {
    expect(dropTargets('base_desk@desk#0', coding(rows(1)), catalog)).toEqual([])
  })

  it('offers an item waiting in the inventory its own default slot when that is free again', () => {
    // The crate was replaced by the chair; the chair is moved away, so the seat is free.
    const room = coding(rows(2), [{ roomId: 'coding', instance: 'base_chair@seat#0', slot: 'beside_seat', variant: null, hidden: false }])
    expect(dropTargets('base_crate@seat#0', room, catalog)).toContain('seat')
  })
})

describe('slotAt', () => {
  it('finds the floor slot under a tile of the room', () => {
    expect(slotAt(catalog.rules.layout.slots, 5.5, 1.5)).toBe('beside_seat')
    expect(slotAt(catalog.rules.layout.slots, 0.5, 5.2)).toBe('couch')
    expect(slotAt(catalog.rules.layout.slots, 3.5, 3.5)).toBe('rug')
    expect(slotAt(catalog.rules.layout.slots, 7.5, 7.5)).toBeNull()
  })
})

describe('slotLabel', () => {
  it('names a slot in words', () => {
    expect(slotLabel('beside_seat')).toBe('Beside the seat')
    expect(slotLabel('wall_left_a')).toBe('Left wall, first spot')
    expect(slotLabel('floor_right')).toBe('Floor, right')
  })
})

describe('the editor data buildPalace hands the renderer', () => {
  it("carries each earned item's drop targets and every item's variants", () => {
    const room = coding(rows(2))
    expect(room.editor.targets['base_chair@seat#0']).toEqual(dropTargets('base_chair@seat#0', room, catalog))
    expect(room.editor.targets['base_crate@seat#0']).toEqual(dropTargets('base_crate@seat#0', room, catalog))
    expect(room.editor.variants['base_desk']).toEqual([])
  })

  it('puts the slot layout on the floor model for clicks', () => {
    const floor = buildPalace({ catalog, rows: rows(1), timeZone: 'UTC', today: TODAY, seen: {} }).floor
    expect(floor.slots['beside_seat']).toMatchObject({ kind: 'floor', tile: [5, 1] })
  })
})

