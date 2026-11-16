import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/main/catalog/loader'
import { computeRoomState } from '../src/shared/engine'
import { accentToken, catalogWithRooms, catalogWithValidRooms, ROOM_ACCENTS, roomDefFromRow, type RoomRow } from '../src/shared/rooms'
import { CODING, MUSIC } from './fixtures/rooms'
import { CATALOG_DIR, placed } from './helpers'

const base = loadCatalog(CATALOG_DIR)

describe('catalogWithRooms', () => {
  it('adds a room the engine can work on', () => {
    const catalog = catalogWithRooms(base, [CODING])
    expect(Object.keys(catalog.rooms).sort()).toEqual(['coding', 'mailroom'])
    const state = computeRoomState('coding', [], catalog, '2026-12-01')
    expect(placed(state)).toContain('coding_laptop@desk_center')
  })

  it('leaves the catalog it was given alone', () => {
    catalogWithRooms(base, [CODING])
    expect(Object.keys(base.rooms)).toEqual(['mailroom'])
  })

  it('rejects two rooms with one id', () => {
    expect(() => catalogWithRooms(base, [CODING, { ...MUSIC, id: 'coding' }])).toThrow(/"coding".*twice/)
  })

  it('rejects two rooms in one cell', () => {
    expect(() => catalogWithRooms(base, [CODING, { ...MUSIC, cell: [0, 0] }])).toThrow(/cell 0,0/)
  })

  it('rejects a signature item that is not in the catalog', () => {
    const bad = { ...CODING, signature: [{ n: 1, unlock: 'start' as const, item: 'flux_capacitor', slots: ['desk_center'] }] }
    expect(() => catalogWithRooms(base, [bad])).toThrow(/flux_capacitor/)
  })
})

describe('room accents', () => {
  it('are tokens, one per palette index', () => {
    expect(ROOM_ACCENTS).toBe(8)
    expect(accentToken(3)).toBe('mp-room-accent-3')
  })
})

describe('roomDefFromRow', () => {
  const row: RoomRow = {
    id: 'finance',
    name: 'Finance',
    area: 'finance',
    accent: 3,
    cellX: -1,
    cellY: 0,
    signature: [
      { item: 'finance_ledger', slots: ['desk_center'] },
      { item: 'finance_chart', slots: ['wall_right_b'] },
      { item: 'finance_safe', slots: ['corner_right'] }
    ],
    classifier: { belongs: 'Money, budgets, taxes, loans.', not_here: 'Shopping lists.', examples: ['Plan my budget for December'] },
    createdAt: '2026-11-16T12:00:00.000Z'
  }

  it('numbers the picks in order: the first is there from the start, the rest come with the streak', () => {
    const def = roomDefFromRow(row)
    expect(def.signature.map((s) => [s.n, s.unlock, s.item])).toEqual([
      [1, 'start', 'finance_ledger'],
      [2, 'streak', 'finance_chart'],
      [3, 'streak', 'finance_safe']
    ])
    expect(def.signature[0]!.slots).toEqual(['desk_center'])
  })

  it('carries the cell, the area, the accent token and the classifier text', () => {
    expect(roomDefFromRow(row)).toMatchObject({
      id: 'finance',
      name: 'Finance',
      area: 'finance',
      accent: 'mp-room-accent-3',
      cell: [-1, 0],
      belongs: 'Money, budgets, taxes, loans.',
      not_here: 'Shopping lists.',
      examples: ['Plan my budget for December'],
      assets: {}
    })
  })

  it('accepts a room with no signature items (base furniture only)', () => {
    const def = roomDefFromRow({ ...row, signature: [] })
    const state = computeRoomState('finance', [], catalogWithRooms(base, [def]), '2026-12-01')
    expect(placed(state)).toEqual(['base_crate@seat', 'base_desk@desk'])
  })
})

describe('catalogWithValidRooms', () => {
  it('leaves out a room the catalog cannot hold, keeps the rest, and says why', () => {
    const warnings: string[] = []
    const broken = { ...MUSIC, signature: [{ n: 1, unlock: 'start' as const, item: 'gone_item', slots: ['desk_center'] }] }
    const catalog = catalogWithValidRooms(base, [broken, CODING], (w) => warnings.push(w))
    expect(Object.keys(catalog.rooms).sort()).toEqual(['coding', 'mailroom'])
    expect(warnings.join('\n')).toContain('gone_item')
  })
})
