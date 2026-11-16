import { describe, expect, it } from 'vitest'
import { checkPlacement, fits, instanceKey, nextPlacement, resolvePlacements, type Placement } from '../src/shared/placements'
import { catalog, chatsOn, goalOn, run } from './helpers'
import { computeRoomState, type RoomEvent } from './shared'

const MON = '2026-11-02'

/** A room's state after `days` consecutive chat days (and `goals` finished projects on those days). */
function stateAfter(roomId: string, days: number, goals = 0) {
  const dayList = run(MON, days)
  const events: RoomEvent[] = [...chatsOn(roomId, dayList), ...dayList.slice(0, goals).map((d, i) => goalOn(roomId, d, `p${i}`))]
  return computeRoomState(roomId, events, catalog, dayList[dayList.length - 1]!)
}

const row = (roomId: string, instance: string, over: Partial<Placement> = {}): Placement => ({
  roomId,
  instance,
  slot: null,
  variant: null,
  hidden: false,
  ...over
})

const where = (resolved: ReturnType<typeof resolvePlacements>): Record<string, string> =>
  Object.fromEntries(resolved.placed.map((p) => [p.instance, p.slot]))
const why = (resolved: ReturnType<typeof resolvePlacements>): Record<string, string> =>
  Object.fromEntries(resolved.inventory.map((i) => [i.instance, i.reason]))

describe('resolvePlacements', () => {
  it('without rows, places what the engine placed, and the replaced crate waits in the inventory', () => {
    const state = stateAfter('coding', 2)
    const resolved = resolvePlacements(state, [], catalog)
    expect(resolved.placed.map((p) => `${p.item}@${p.slot}`)).toEqual(state.items.map((p) => `${p.item}@${p.slot}`))
    expect(resolved.placed.every((p) => !p.userPlaced && p.variant === null)).toBe(true)
    expect(why(resolved)).toEqual({ 'base_crate@seat#0': 'replaced' })
  })

  it('keeps the laptop where the user moved it, and lands the monitor in the free default slot', () => {
    const rows = [row('coding', 'coding_laptop@desk_center#0', { slot: 'desk_left' })]
    const resolved = resolvePlacements(stateAfter('coding', 3), rows, catalog)
    expect(where(resolved)).toMatchObject({ 'coding_laptop@desk_center#0': 'desk_left', 'coding_monitor@desk_center#0': 'desk_center' })
    expect(resolved.placed.find((p) => p.item === 'coding_laptop')!.userPlaced).toBe(true)
  })

  it('never moves a user-placed item to make room for an upgrade', () => {
    const rows = [row('coding', 'base_crate@seat#0')]
    const resolved = resolvePlacements(stateAfter('coding', 2), rows, catalog)
    expect(where(resolved)['base_crate@seat#0']).toBe('seat')
    expect(why(resolved)).toEqual({ 'base_chair@seat#0': 'no_free_slot' })
  })

  it('treats the two Mail room boxes as separate items', () => {
    const rows = [row('mailroom', 'cardboard_box@corner_right#0', { hidden: true })]
    const resolved = resolvePlacements(stateAfter('mailroom', 3), rows, catalog)
    expect(why(resolved)).toMatchObject({ 'cardboard_box@corner_right#0': 'hidden' })
    expect(why(resolved)['cardboard_box@beside_seat#0']).toBeUndefined()
    expect(where(resolved)['cardboard_box@beside_seat#0']).toBe('beside_seat')
  })

  it('sends what stands on a hidden desk to the inventory', () => {
    const rows = [row('coding', 'base_desk@desk#0', { hidden: true })]
    const resolved = resolvePlacements(stateAfter('coding', 1), rows, catalog)
    expect(why(resolved)).toEqual({ 'base_desk@desk#0': 'hidden', 'coding_laptop@desk_center#0': 'needs_host' })
  })

  it('survives a row whose slot no longer exists', () => {
    const rows = [row('coding', 'base_crate@seat#0', { slot: 'ceiling' })]
    const resolved = resolvePlacements(stateAfter('coding', 1), rows, catalog)
    expect(why(resolved)).toEqual({ 'base_crate@seat#0': 'invalid_slot' })
  })

  it('ignores rows for items the room has not earned (yet, or any more)', () => {
    const rows = [row('coding', 'base_couch@couch#0', { slot: 'floor_right' })]
    const resolved = resolvePlacements(stateAfter('coding', 1), rows, catalog)
    expect(resolved.placed.some((p) => p.item === 'base_couch')).toBe(false)
    expect(resolved.inventory).toEqual([])
  })

  it('carries the chosen variant', () => {
    const rows = [row('coding', 'base_desk@desk#0', { variant: 'walnut' })]
    expect(resolvePlacements(stateAfter('coding', 1), rows, catalog).placed.find((p) => p.item === 'base_desk')!.variant).toBe('walnut')
  })

  it('lands a new unlock in its default slot without moving anything the user arranged', () => {
    const rows = [
      row('coding', 'base_chair@seat#0', { slot: 'beside_seat' }),
      row('coding', 'coding_monitor@desk_center#0', { slot: 'desk_right' }),
      row('coding', 'base_rug@rug#0', { hidden: true })
    ]
    const before = where(resolvePlacements(stateAfter('coding', 7), rows, catalog))
    const after = where(resolvePlacements(stateAfter('coding', 8), rows, catalog))
    const added = Object.keys(after).filter((k) => !(k in before))
    expect(added).toEqual(['coding_whiteboard@wall_right_b#0'])
    for (const [instance, slot] of Object.entries(before)) expect(after[instance], instance).toBe(slot)
  })
})

describe('fits', () => {
  const slots = catalog.rules.layout.slots
  it('matches the slot kind, footprint (also mirrored) and wall width', () => {
    expect(fits(catalog.items['base_chair']!, slots['beside_seat']!)).toBe(true)
    expect(fits(catalog.items['base_couch']!, slots['seat']!)).toBe(false)
    expect(fits(catalog.items['base_bookshelf_low']!, slots['floor_right']!)).toBe(true) // [1,2] mirrored into [2,1]
    expect(fits(catalog.items['window']!, slots['wall_left_a']!)).toBe(false)
    expect(fits(catalog.items['base_poster']!, slots['wall_right_a']!)).toBe(true)
    expect(fits(catalog.items['base_chair']!, slots['rug']!)).toBe(false)
  })
})

describe('checkPlacement', () => {
  const state = stateAfter('coding', 13, 5)
  it('refuses to move a host item, but lets it be hidden', () => {
    expect(checkPlacement({ roomId: 'coding', instance: 'base_desk@desk#0', slot: 'floor_right' }, state, [], catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/cannot be moved/)
    })
    expect(checkPlacement({ roomId: 'coding', instance: 'base_desk@desk#0', hidden: true }, state, [], catalog)).toEqual({ ok: true })
  })

  it('refuses a slot the item does not fit, a full slot, or an item the room has not earned', () => {
    expect(checkPlacement({ roomId: 'coding', instance: 'base_couch@couch#0', slot: 'seat' }, state, [], catalog).ok).toBe(false)
    expect(checkPlacement({ roomId: 'coding', instance: 'base_couch@couch#0', slot: 'floor_left' }, state, [], catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/does not fit/)
    })
    expect(checkPlacement({ roomId: 'coding', instance: 'base_floor_lamp@lamp#0', slot: 'seat' }, state, [], catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/taken/)
    })
    expect(checkPlacement({ roomId: 'coding', instance: 'coding_arcade@floor_right#0', slot: 'beside_seat' }, state, [], catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/not unlocked/)
    })
  })

  it('accepts a free slot that fits, and an unknown variant is refused', () => {
    expect(checkPlacement({ roomId: 'coding', instance: 'base_floor_lamp@lamp#0', slot: 'beside_seat' }, state, [], catalog)).toEqual({ ok: true })
    expect(checkPlacement({ roomId: 'coding', instance: 'base_chair@seat#0', variant: 'gold' }, state, [], catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/no variant "gold"/)
    })
  })

  it('names placed items the same way the engine does', () => {
    expect(instanceKey({ item: 'trophy', slot: 'trophy_shelf', index: 2 })).toBe('trophy@trophy_shelf#2')
  })
})

describe('review fixes', () => {
  const state = stateAfter('coding', 13, 5)

  it('refuses to show a hidden item whose spot the user has since filled', () => {
    const rows = [row('coding', 'base_chair@seat#0', { hidden: true }), row('coding', 'base_plant_small@plant#0', { slot: 'seat' })]
    // The plant really stands on the seat now.
    expect(resolvePlacements(state, rows, catalog).placed.find((p) => p.item === 'base_plant_small')!.slot).toBe('seat')
    expect(checkPlacement({ roomId: 'coding', instance: 'base_chair@seat#0', hidden: false }, state, rows, catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/taken/)
    })
  })

  it('refuses to move an item back to its default spot when someone else stands there', () => {
    const rows = [row('coding', 'base_chair@seat#0', { slot: 'beside_seat' }), row('coding', 'base_floor_lamp@lamp#0', { slot: 'seat' })]
    expect(checkPlacement({ roomId: 'coding', instance: 'base_chair@seat#0', slot: null }, state, rows, catalog).ok).toBe(false)
    expect(checkPlacement({ roomId: 'coding', instance: 'base_chair@seat#0', slot: 'seat' }, state, rows, catalog).ok).toBe(false)
  })

  it('refuses a desk-top spot while the desk is hidden', () => {
    const rows = [row('coding', 'base_desk@desk#0', { hidden: true })]
    expect(checkPlacement({ roomId: 'coding', instance: 'coding_monitor@desk_center#0', slot: 'desk_left' }, state, rows, catalog)).toEqual({
      ok: false,
      reason: expect.stringMatching(/needs/)
    })
  })

  it('shows an item that is moved, unless the change says otherwise', () => {
    const hidden = row('coding', 'base_chair@seat#0', { hidden: true })
    expect(nextPlacement(hidden, { roomId: 'coding', instance: hidden.instance, slot: 'beside_seat' })).toMatchObject({ slot: 'beside_seat', hidden: false })
    expect(nextPlacement(hidden, { roomId: 'coding', instance: hidden.instance, variant: 'oak' })).toMatchObject({ variant: 'oak', hidden: true })
    expect(nextPlacement(undefined, { roomId: 'coding', instance: hidden.instance, hidden: true })).toMatchObject({ slot: null, variant: null, hidden: true })
  })
})

