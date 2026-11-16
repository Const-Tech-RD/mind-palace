import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/main/catalog/loader'
import { computeRoomState } from '../src/shared/engine'
import { accentToken, catalogWithRooms, ROOM_ACCENTS } from '../src/shared/rooms'
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
