import { describe, expect, it } from 'vitest'
import type { HistoryRows } from '../src/shared/engine'
import { buildPalace, itemKey, itemLabel, newSince, rewardText, seenKeys, trackProgress } from '../src/shared/palace'
import { addDays } from './shared'
import { catalog } from './helpers'

const TZ = 'America/Santo_Domingo'
// A Thursday, so a five-day run ending today has no weekend in it.
const TODAY = '2026-11-12'
const roomIds = Object.keys(catalog.rooms)

/** A chat in `roomId` with one user message at noon local time on each of the last `days` days. */
function history(roomId: string, days: number, goals: Array<{ projectId: string; localDay: string }> = []): HistoryRows {
  return {
    chats: [{ id: 'c1', roomId }],
    messages: Array.from({ length: days }, (_, i) => ({
      chatId: 'c1',
      role: 'user',
      createdAt: `${addDays(TODAY, -i)}T16:00:00.000Z`
    })),
    goalCompletions: goals.map((g) => ({ ...g, roomId }))
  }
}

const palace = (rows: HistoryRows, seen: Record<string, string[] | null> = {}) =>
  buildPalace({ catalog, rows, timeZone: TZ, today: TODAY, seen })
const roomOf = (view: ReturnType<typeof palace>, id: string) => view.rooms.find((r) => r.id === id)!

describe('buildPalace', () => {
  it('gives every catalog room a state, even with no chats at all', () => {
    const view = palace({ chats: [], messages: [], goalCompletions: [] })
    expect(view.today).toBe(TODAY)
    expect(view.rooms.map((r) => r.id).sort()).toEqual([...roomIds].sort())
    for (const room of view.rooms) {
      expect(room.state.shell).toBe('bare')
      expect(room.state.streak.current).toBe(0)
      expect(room.state.items.length).toBeGreaterThan(0) // the starting furniture
      expect(room.newItems).toEqual([])
      expect(room.newShell).toBeNull()
    }
  })

  it('a five-day streak with three goals furnishes only that room', () => {
    const view = palace(
      history('coding', 5, [
        { projectId: 'p1', localDay: addDays(TODAY, -3) },
        { projectId: 'p2', localDay: addDays(TODAY, -2) },
        { projectId: 'p3', localDay: addDays(TODAY, -1) }
      ])
    )
    const coding = roomOf(view, 'coding').state
    expect(coding.streak.current).toBe(5)
    expect(coding.shell).toBe('painted')
    expect(coding.goals).toMatchObject({ count: 3, trophies: 3 })
    const names = coding.items.map((i) => i.item)
    for (const item of ['base_desk', 'base_chair', 'base_rug', 'coding_monitor', 'trophy_shelf', 'base_poster', 'base_floor_lamp']) {
      expect(names).toContain(item)
    }
    expect(names).not.toContain('base_crate') // replaced by the chair
    expect(roomOf(view, 'music').state.streak.current).toBe(0)
    expect(roomOf(view, 'music').state.shell).toBe('bare')
  })
})

describe('what is new since the last visit', () => {
  const before = roomOf(palace(history('coding', 1)), 'coding').state
  const after = roomOf(palace(history('coding', 5)), 'coding').state

  it('a room never visited reports nothing new', () => {
    expect(newSince(null, after)).toEqual({ items: [], shell: null })
  })

  it('reports the items and the shell tier gained since the stored visit', () => {
    const fresh = newSince(seenKeys(before), after)
    const labels = after.items.filter((i) => fresh.items.includes(itemKey(i))).map((i) => i.item).sort()
    expect(labels).toEqual(['base_chair', 'base_rug', 'coding_monitor'])
    expect(fresh.shell).toBe('painted')
  })

  it('nothing is new right after a visit, and lost items are not news', () => {
    expect(newSince(seenKeys(after), after)).toEqual({ items: [], shell: null })
    // Going back (a chat moved away) shows the crate again, which was seen before.
    expect(newSince(seenKeys(after), before)).toEqual({ items: [], shell: null })
  })

  it('buildPalace applies the stored visit per room', () => {
    const view = palace(history('coding', 5), { coding: seenKeys(before), music: null })
    expect(roomOf(view, 'coding').newItems).toHaveLength(3)
    expect(roomOf(view, 'coding').newShell).toBe('painted')
    expect(roomOf(view, 'music').newItems).toEqual([])
  })
})

describe('labels', () => {
  it.each([
    ['base_chair', 'Chair'],
    ['base_bookshelf_low', 'Low bookshelf'],
    ['base_plant_large', 'Large plant'],
    ['base_floor_lamp', 'Floor lamp'],
    ['coding_whiteboard', 'Whiteboard'],
    ['art_pottery_wheel', 'Pottery wheel'],
    ['mail_sorting_shelf', 'Sorting shelf'],
    ['trophy_shelf', 'Trophy shelf'],
    ['cardboard_box', 'Cardboard box'],
    ['window', 'Window']
  ])('%s → %s', (id, label) => {
    expect(itemLabel(id, roomIds)).toBe(label)
  })

  it('every item the catalog can place has a non-empty, prefix-free label', () => {
    const view = palace(history('coding', 34))
    for (const room of view.rooms) {
      for (const item of [...room.state.items, ...room.state.replaced]) {
        const label = itemLabel(item.item, roomIds)
        expect(label).toMatch(/^[A-Z]/)
        expect(label).not.toMatch(/_|^Base |^Coding /)
      }
    }
  })
})

describe('trackProgress', () => {
  it('an empty room is working towards the first milestones', () => {
    const state = roomOf(palace({ chats: [], messages: [], goalCompletions: [] }), 'coding').state
    const streak = trackProgress(state, 'streak', roomIds)
    expect(streak).toMatchObject({ value: 0, target: 2, fraction: 0 })
    expect(streak.caption).toBe('2 more days in a row for the chair.')
    const goals = trackProgress(state, 'goals', roomIds)
    expect(goals).toMatchObject({ value: 0, target: 1 })
    expect(goals.caption).toBe('1 more finished project for the trophy shelf.')
  })

  it('fills the bar as the value out of the target, so it is never empty right after a milestone', () => {
    // Streak 6: past the milestone at 5, heading for 8.
    const state = roomOf(palace(history('coding', 6)), 'coding').state
    const streak = trackProgress(state, 'streak', roomIds)
    expect(streak).toMatchObject({ value: 6, target: 8 })
    expect(streak.fraction).toBeCloseTo(6 / 8)
    // Exactly on a milestone: 5 of 8, not zero.
    const onMilestone = roomOf(palace(history('coding', 5)), 'coding').state
    expect(trackProgress(onMilestone, 'streak', roomIds).fraction).toBeCloseTo(5 / 8)
    expect(streak.caption).toBe('2 more days in a row for the whiteboard.')
  })

  it('names every reward of a milestone that gives more than one', () => {
    const state = roomOf(palace(history('coding', 3)), 'coding').state
    const next = state.nextUnlock.streak!
    expect(next.at).toBe(5)
    expect(rewardText(next, roomIds)).toBe('painted room and rug')
  })

  it('says so when a track is complete', () => {
    const state = roomOf(palace(history('coding', 34)), 'coding').state
    expect(trackProgress(state, 'streak', roomIds)).toMatchObject({ target: null, fraction: 1, caption: 'Everything on this track is unlocked.' })
  })
})
