import { describe, expect, it } from 'vitest'
import { catalog, chatsOn, goalOn, placed, run } from './helpers'
import {
  addDays,
  buildRoomEvents,
  computeRoomState,
  diffRoomStates,
  localDayOf,
  reopenGoal,
  weekdayOf,
  weekdaysBetween,
  type Catalog,
  type HistoryRows,
  type RoomEvent
} from './shared'

// Calendar used throughout (November 2026):
//   Mon 2 · Tue 3 · Wed 4 · Thu 5 · Fri 6 · Sat 7 · Sun 8 · Mon 9 · Tue 10 · Wed 11
const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const THU = '2026-11-05'
const FRI = '2026-11-06'
const SAT = '2026-11-07'
const SUN = '2026-11-08'
const MON2 = '2026-11-09'
const TUE2 = '2026-11-10'
const WED2 = '2026-11-11'

describe('calendar fixture', () => {
  it('has the weekdays the cases assume', () => {
    expect([MON, WED, FRI, SAT, SUN, MON2].map(weekdayOf)).toEqual([
      'monday',
      'wednesday',
      'friday',
      'saturday',
      'sunday',
      'monday'
    ])
  })
})

describe('streaks', () => {
  interface Case {
    name: string
    chatDays: string[]
    today: string
    current: number
    best: number
  }

  const cases: Case[] = [
    { name: 'no chats at all', chatDays: [], today: WED, current: 0, best: 0 },
    { name: 'first chat today', chatDays: [WED], today: WED, current: 1, best: 1 },
    { name: 'three weekdays in a row', chatDays: [MON, TUE, WED], today: WED, current: 3, best: 3 },

    // --- a streak across a weekend with no chats ---
    { name: 'weekend with no chats: Thu Fri, then Monday', chatDays: [THU, FRI, MON2], today: MON2, current: 3, best: 3 },
    { name: 'weekend with no chats: seen on Saturday', chatDays: [THU, FRI], today: SAT, current: 2, best: 2 },
    { name: 'weekend with no chats: seen on Sunday', chatDays: [THU, FRI], today: SUN, current: 2, best: 2 },
    { name: 'weekend with no chats: Monday before chatting', chatDays: [THU, FRI], today: MON2, current: 2, best: 2 },
    { name: 'weekend with no chats: Monday skipped, seen Tuesday', chatDays: [THU, FRI], today: TUE2, current: 0, best: 2 },

    // --- a weekend with chats ---
    { name: 'weekend with chats adds both days', chatDays: [THU, FRI, SAT, SUN, MON2], today: MON2, current: 5, best: 5 },
    { name: 'only Saturday chatted: Sunday is forgiven', chatDays: [FRI, SAT, MON2], today: MON2, current: 3, best: 3 },
    { name: 'only Sunday chatted: Saturday is forgiven', chatDays: [FRI, SUN, MON2], today: MON2, current: 3, best: 3 },
    { name: 'a run can start on a weekend', chatDays: [SAT, SUN], today: SUN, current: 2, best: 2 },

    // --- a missed weekday ---
    { name: 'missed Wednesday resets the counter', chatDays: [MON, TUE, THU], today: THU, current: 1, best: 2 },
    { name: 'missed Wednesday, seen on Wednesday itself: run still alive', chatDays: [MON, TUE], today: WED, current: 2, best: 2 },
    { name: 'missed Wednesday, seen on Thursday before chatting', chatDays: [MON, TUE], today: THU, current: 0, best: 2 },
    { name: 'missed Friday is not covered by the weekend', chatDays: [WED, THU, MON2], today: MON2, current: 1, best: 2 },
    { name: 'missed Monday after a quiet weekend', chatDays: [THU, FRI, TUE2], today: TUE2, current: 1, best: 2 },

    // --- bookkeeping ---
    { name: 'several chats on one day are one room day', chatDays: [MON, MON, MON, TUE], today: TUE, current: 2, best: 2 },
    { name: 'event order does not matter', chatDays: [WED, MON, TUE], today: WED, current: 3, best: 3 },
    { name: 'days after today are ignored', chatDays: [MON, TUE, WED, THU], today: TUE, current: 2, best: 2 },
    { name: 'best keeps the longest run', chatDays: [MON, TUE, WED, FRI, MON2, TUE2], today: TUE2, current: 3, best: 3 },
    { name: 'a long gap', chatDays: ['2026-09-01', '2026-09-02', WED], today: WED, current: 1, best: 2 }
  ]

  it.each(cases)('$name', ({ chatDays, today, current, best }) => {
    const state = computeRoomState('coding', chatsOn('coding', chatDays), catalog, today)
    expect({ current: state.streak.current, best: state.streak.best }).toEqual({ current, best })
  })

  it('today without a chat shows yesterday\'s value until midnight, then drops', () => {
    const events = chatsOn('coding', [MON, TUE, WED])
    expect(computeRoomState('coding', events, catalog, WED).streak.current).toBe(3)
    expect(computeRoomState('coding', events, catalog, THU).streak.current).toBe(3) // Thursday, no chat yet
    expect(computeRoomState('coding', events, catalog, FRI).streak.current).toBe(0) // Thursday was missed
  })

  it('a broken streak resets the counter, not the furniture', () => {
    const events = chatsOn('coding', [MON, TUE, WED, FRI]) // missed Thursday
    const state = computeRoomState('coding', events, catalog, FRI)
    expect(state.streak).toMatchObject({ current: 1, best: 3, lastRoomDay: FRI, milestonesReached: [2, 3] })
    expect(placed(state)).toContain('base_chair@seat') // from the 2-day milestone
    expect(placed(state)).toContain('coding_monitor@desk_center') // from the 3-day milestone
    // The next unlock is the lowest milestone not yet reached, counted from the new run.
    expect(state.nextUnlock.streak).toMatchObject({ at: 5, remaining: 4, milestone: true })
  })

  it('only counts chats of the room asked for', () => {
    const events = [...chatsOn('coding', [MON, WED]), ...chatsOn('music', [TUE])]
    expect(computeRoomState('coding', events, catalog, WED).streak.current).toBe(1)
    expect(computeRoomState('music', events, catalog, WED).streak.current).toBe(1) // Tuesday; Wednesday not over yet
    expect(computeRoomState('music', events, catalog, THU).streak.current).toBe(0)
    expect(computeRoomState('art', events, catalog, WED).streak.current).toBe(0)
  })

  it('grace days come from the rules and can be widened', () => {
    const widened: Catalog = structuredClone(catalog)
    widened.rules.tracks.streak.grace_weekdays = ['friday', 'saturday', 'sunday']
    const events = chatsOn('coding', [WED, THU, MON2]) // no chat on Friday
    expect(computeRoomState('coding', events, catalog, MON2).streak.current).toBe(1)
    expect(computeRoomState('coding', events, widened, MON2).streak.current).toBe(3)

    const none: Catalog = structuredClone(catalog)
    none.rules.tracks.streak.grace_weekdays = []
    const overWeekend = chatsOn('coding', [THU, FRI, MON2])
    expect(computeRoomState('coding', overWeekend, none, MON2).streak.current).toBe(1)
  })

  it('rejects an unknown room and a malformed day', () => {
    expect(() => computeRoomState('garage', [], catalog, WED)).toThrow(/Unknown room "garage"/)
    expect(() => computeRoomState('coding', [], catalog, '2026-02-30')).toThrow(/no such date/)
    expect(() => computeRoomState('coding', chatsOn('coding', ['yesterday']), catalog, WED)).toThrow(/Invalid local day/)
  })
})

describe('the 34-day ladder', () => {
  const FIRST = '2026-10-01'
  const days = run(FIRST, 34) // a chat every single day, weekends included
  const stateOn = (n: number) => computeRoomState('coding', chatsOn('coding', days.slice(0, n)), catalog, days[n - 1]!)

  const START = ['base_crate@seat', 'base_desk@desk', 'coding_laptop@desk_center']

  interface Rung {
    day: number
    shell: string
    /** What appears on exactly this day. */
    gained: string[]
    /** What it pushes out. */
    lost: string[]
    next: number | null
  }

  const ladder: Rung[] = [
    { day: 2, shell: 'bare', gained: ['base_chair@seat'], lost: ['base_crate@seat'], next: 3 },
    { day: 3, shell: 'bare', gained: ['coding_monitor@desk_center'], lost: ['coding_laptop@desk_center'], next: 5 },
    { day: 5, shell: 'painted', gained: ['base_rug@rug'], lost: [], next: 8 },
    { day: 8, shell: 'painted', gained: ['coding_whiteboard@wall_right_b'], lost: [], next: 13 },
    { day: 13, shell: 'painted', gained: ['base_bookshelf_low@floor_left', 'base_plant_small@plant'], lost: [], next: 21 },
    { day: 21, shell: 'finished', gained: ['coding_rack@corner_right'], lost: [], next: 34 },
    { day: 34, shell: 'finished', gained: ['coding_arcade@floor_right'], lost: [], next: null }
  ]

  it('starts with the desk, the crate and signature item 1 in a bare shell', () => {
    const state = stateOn(1)
    expect(placed(state)).toEqual(START)
    expect(state.shell).toBe('bare')
    expect(state.nextUnlock.streak).toMatchObject({ at: 2, remaining: 1 })
  })

  it.each(ladder)('day $day unlocks $gained', ({ day, shell, gained, lost, next }) => {
    const before = stateOn(day - 1)
    const state = stateOn(day)
    expect(state.streak.current).toBe(day)
    expect(state.shell).toBe(shell)
    expect(placed(state).filter((p) => !placed(before).includes(p))).toEqual([...gained].sort())
    expect(placed(before).filter((p) => !placed(state).includes(p))).toEqual([...lost].sort())
    expect(state.nextUnlock.streak?.at ?? null).toBe(next)
    if (next !== null) expect(state.nextUnlock.streak?.remaining).toBe(next - day)
  })

  it('nothing changes on the days between milestones', () => {
    const milestoneDays = new Set(ladder.map((r) => r.day))
    for (let day = 2; day <= 34; day++) {
      if (milestoneDays.has(day)) continue
      expect(diffRoomStates(stateOn(day - 1), stateOn(day)), `day ${day}`).toEqual([])
    }
  })

  it('ends with the whole streak ladder in place', () => {
    const state = stateOn(34)
    expect(state.streak.milestonesReached).toEqual([2, 3, 5, 8, 13, 21, 34])
    expect(placed(state)).toEqual(
      [
        'base_bookshelf_low@floor_left',
        'base_chair@seat',
        'base_desk@desk',
        'base_plant_small@plant',
        'base_rug@rug',
        'coding_arcade@floor_right',
        'coding_monitor@desk_center',
        'coding_rack@corner_right',
        'coding_whiteboard@wall_right_b'
      ].sort()
    )
  })

  it('weekdays only: 34 room days take longer but reach the same room', () => {
    const weekdays = run(FIRST, 60)
      .filter((d) => !['saturday', 'sunday'].includes(weekdayOf(d)))
      .slice(0, 34)
    const state = computeRoomState('coding', chatsOn('coding', weekdays), catalog, weekdays.at(-1)!)
    expect(state.streak.current).toBe(34)
    expect(placed(state)).toEqual(placed(stateOn(34)))
  })

  it('places the Music studio speakers twice (the "slots" spelling)', () => {
    const state = computeRoomState('music', chatsOn('music', days.slice(0, 3)), catalog, days[2]!)
    expect(placed(state)).toEqual(
      ['base_chair@seat', 'base_desk@desk', 'music_mic@beside_seat', 'music_speakers@desk_left', 'music_speakers@desk_right'].sort()
    )
    expect(computeRoomState('music', chatsOn('music', days.slice(0, 2)), catalog, days[1]!).nextUnlock.streak?.rewards).toEqual([
      { type: 'item', item: 'music_speakers', slots: ['desk_left', 'desk_right'], signature: 2, replaces: null }
    ])
  })

  it('places both Mail room cardboard boxes', () => {
    const state = computeRoomState('mailroom', chatsOn('mailroom', days.slice(0, 3)), catalog, days[2]!)
    expect(placed(state).filter((p) => p.startsWith('cardboard_box'))).toEqual([
      'cardboard_box@beside_seat',
      'cardboard_box@corner_right'
    ])
  })
})

describe('goals', () => {
  const goalsState = (events: RoomEvent[], today = '2026-12-31') => computeRoomState('art', events, catalog, today)

  it('two completions on one day count once', () => {
    const state = goalsState([goalOn('art', MON, 'p1'), goalOn('art', MON, 'p2')])
    expect(state.goals).toMatchObject({ count: 1, completions: 2, trophies: 1, milestonesReached: [] })
    expect(placed(state)).not.toContain('base_poster@wall_left_a') // needs 2 counted goals
  })

  it('the same two completions on different days count twice', () => {
    const state = goalsState([goalOn('art', MON, 'p1'), goalOn('art', TUE, 'p2')])
    expect(state.goals).toMatchObject({ count: 2, completions: 2, trophies: 2, milestonesReached: [2] })
    expect(placed(state)).toContain('base_poster@wall_left_a')
  })

  it('one goal a day is per room', () => {
    const events = [goalOn('art', MON, 'p1'), goalOn('music', MON, 'p2')]
    expect(computeRoomState('art', events, catalog, MON).goals.count).toBe(1)
    expect(computeRoomState('music', events, catalog, MON).goals.count).toBe(1)
    expect(computeRoomState('coding', events, catalog, MON).goals.count).toBe(0)
  })

  it('a reopened goal takes its completion, trophy and unlock back', () => {
    const events = [goalOn('art', MON, 'p1'), goalOn('art', TUE, 'p2')]
    const before = goalsState(events)
    const after = goalsState(reopenGoal(events, 'p2'))
    expect(before.goals.count).toBe(2)
    expect(after.goals).toMatchObject({ count: 1, completions: 1, trophies: 1, milestonesReached: [] })
    expect(placed(before)).toContain('base_poster@wall_left_a')
    expect(placed(after)).not.toContain('base_poster@wall_left_a')
    expect(after.nextUnlock.goals).toMatchObject({ at: 2, remaining: 1 })
    expect(diffRoomStates(before, after)).toEqual([]) // losing things is not an unlock
  })

  it('reopening one of two same-day goals leaves the day counted', () => {
    const events = [goalOn('art', MON, 'p1'), goalOn('art', MON, 'p2')]
    expect(goalsState(reopenGoal(events, 'p1')).goals).toMatchObject({ count: 1, completions: 1 })
    expect(goalsState(reopenGoal(reopenGoal(events, 'p1'), 'p2')).goals).toMatchObject({ count: 0, completions: 0 })
  })

  interface Rung {
    count: number
    trophies: number
    has: string[]
    hasNot: string[]
    next: number | null
  }
  const rungs: Rung[] = [
    { count: 0, trophies: 0, has: [], hasNot: ['trophy_shelf@wall_left_b', 'trophy@trophy_shelf#0'], next: 1 },
    { count: 1, trophies: 1, has: ['trophy_shelf@wall_left_b', 'trophy@trophy_shelf#0'], hasNot: ['base_poster@wall_left_a'], next: 2 },
    { count: 2, trophies: 2, has: ['base_poster@wall_left_a'], hasNot: ['base_floor_lamp@lamp'], next: 3 },
    { count: 3, trophies: 3, has: ['base_floor_lamp@lamp'], hasNot: ['base_couch@couch'], next: 5 },
    { count: 4, trophies: 4, has: ['trophy@trophy_shelf#3'], hasNot: ['base_couch@couch'], next: 5 },
    { count: 5, trophies: 5, has: ['base_couch@couch', 'trophy@trophy_shelf#4'], hasNot: ['window@wall_right_a'], next: 8 },
    { count: 6, trophies: 5, has: [], hasNot: ['trophy@trophy_shelf#5'], next: 8 },
    { count: 8, trophies: 5, has: ['window@wall_right_a'], hasNot: ['base_plant_large@plant'], next: 13 },
    { count: 13, trophies: 5, has: ['base_plant_large@plant'], hasNot: ['base_plant_small@plant'], next: null },
    { count: 20, trophies: 5, has: ['base_plant_large@plant'], hasNot: [], next: null }
  ]

  it.each(rungs)('$count counted goals: $trophies trophies, next at $next', ({ count, trophies, has, hasNot, next }) => {
    const events = run('2026-06-01', count).map((day, i) => goalOn('art', day, `p${i}`))
    const state = goalsState(events)
    expect(state.goals.count).toBe(count)
    expect(state.goals.trophies).toBe(trophies)
    for (const item of has) expect(placed(state)).toContain(item)
    for (const item of hasNot) expect(placed(state)).not.toContain(item)
    expect(state.nextUnlock.goals?.at ?? null).toBe(next)
  })

  it('flags the trophy shelf step as off the milestone list', () => {
    expect(goalsState([]).nextUnlock.goals).toEqual({
      track: 'goals',
      at: 1,
      remaining: 1,
      milestone: false,
      rewards: [{ type: 'item', item: 'trophy_shelf', slots: ['wall_left_b'], signature: null, replaces: null }]
    })
    expect(goalsState([goalOn('art', MON, 'p1')]).goals.milestonesReached).toEqual([])
    expect(goalsState([goalOn('art', MON, 'p1')]).nextUnlock.goals).toMatchObject({ at: 2, milestone: true })
  })

  it('goals do not need chats, and chats do not count as goals', () => {
    const state = computeRoomState('art', [...chatsOn('art', [MON, TUE]), goalOn('art', TUE, 'p1')], catalog, TUE)
    expect(state.streak.current).toBe(2)
    expect(state.goals.count).toBe(1)
  })
})

describe('both tracks together', () => {
  it('the large plant replaces the small one whichever was earned first', () => {
    const thirteenGoals = run('2026-06-01', 13).map((day, i) => goalOn('coding', day, `p${i}`))
    const thirteenDays = chatsOn('coding', run('2026-08-03', 13))

    const goalsFirst = computeRoomState('coding', thirteenGoals, catalog, '2026-07-01')
    expect(placed(goalsFirst)).toContain('base_plant_large@plant')

    const thenStreak = computeRoomState('coding', [...thirteenGoals, ...thirteenDays], catalog, '2026-08-15')
    expect(thenStreak.streak.best).toBe(13)
    expect(placed(thenStreak)).toContain('base_plant_large@plant')
    expect(placed(thenStreak)).not.toContain('base_plant_small@plant')
    // ...and the toast does not announce a plant that never shows up.
    const dayBefore = computeRoomState('coding', [...thirteenGoals, ...thirteenDays], catalog, '2026-08-14')
    expect(diffRoomStates(dayBefore, thenStreak).map((e) => (e.kind === 'item' ? e.item : e.shell))).toEqual([
      'base_bookshelf_low'
    ])
  })

  it('never puts two items in a single-capacity slot, in any room at any progress', () => {
    const streakSteps = [0, ...catalog.rules.tracks.streak.milestones]
    const goalSteps = Array.from({ length: 15 }, (_, i) => i)
    for (const roomId of Object.keys(catalog.rooms)) {
      for (const streak of streakSteps) {
        for (const goals of goalSteps) {
          const events = [
            ...chatsOn(roomId, run('2026-01-01', streak)),
            ...run('2026-01-01', goals).map((day, i) => goalOn(roomId, day, `p${i}`))
          ]
          const state = computeRoomState(roomId, events, catalog, '2026-03-01')
          const seen = new Set<string>()
          for (const p of state.items) {
            const key = `${p.slot}#${p.index}`
            expect(seen.has(key), `${roomId} streak ${streak} goals ${goals}: ${key} used twice`).toBe(false)
            seen.add(key)
            const capacity = catalog.rules.layout.slots[p.slot]?.capacity ?? 1
            expect(p.index).toBeLessThan(capacity)
          }
        }
      }
    }
  })
})

describe('moving a chat between rooms', () => {
  const rows = (roomOfChatA: string): HistoryRows => ({
    chats: [
      { id: 'a', roomId: roomOfChatA },
      { id: 'b', roomId: 'mailroom' },
      { id: 'unclassified', roomId: null }
    ],
    messages: [
      { chatId: 'a', role: 'user', createdAt: '2026-11-02T15:00:00.000Z' },
      { chatId: 'a', role: 'assistant', createdAt: '2026-11-02T15:00:05.000Z' },
      { chatId: 'a', role: 'user', createdAt: '2026-11-03T15:00:00.000Z' },
      { chatId: 'a', role: 'user', createdAt: '2026-11-04T15:00:00.000Z' },
      { chatId: 'b', role: 'user', createdAt: '2026-11-04T16:00:00.000Z' },
      // An assistant-only day and an unclassified chat never make a room day.
      { chatId: 'b', role: 'assistant', createdAt: '2026-11-05T16:00:00.000Z' },
      { chatId: 'unclassified', role: 'user', createdAt: '2026-11-05T16:00:00.000Z' }
    ],
    goalCompletions: []
  })
  const TZ = 'America/Santo_Domingo'

  it('from Mail room to Music studio: the whole history moves with it', () => {
    const before = buildRoomEvents(rows('mailroom'), TZ)
    const after = buildRoomEvents(rows('music'), TZ)

    const mailBefore = computeRoomState('mailroom', before, catalog, WED)
    const musicBefore = computeRoomState('music', before, catalog, WED)
    expect(mailBefore.streak.current).toBe(3)
    expect(placed(mailBefore)).toContain('cardboard_box@beside_seat') // Mail room signature 2, at 3 days
    expect(musicBefore.streak.current).toBe(0)
    expect(placed(musicBefore)).toEqual(['base_crate@seat', 'base_desk@desk', 'music_mic@beside_seat'])

    const mailAfter = computeRoomState('mailroom', after, catalog, WED)
    const musicAfter = computeRoomState('music', after, catalog, WED)
    // Chat b still gives the Mail room its one day; the 3-day unlocks are gone.
    expect(mailAfter.streak).toMatchObject({ current: 1, best: 1 })
    expect(placed(mailAfter)).toEqual(['base_crate@seat', 'base_desk@desk', 'cardboard_box@corner_right'])
    expect(musicAfter.streak).toMatchObject({ current: 3, best: 3 })
    expect(placed(musicAfter)).toEqual(
      ['base_chair@seat', 'base_desk@desk', 'music_mic@beside_seat', 'music_speakers@desk_left', 'music_speakers@desk_right'].sort()
    )

    // The move shows up as unlocks in the Music studio and as none in the Mail room.
    expect(diffRoomStates(musicBefore, musicAfter).map((e) => (e.kind === 'item' ? `${e.item}@${e.slot}` : e.shell))).toEqual([
      'base_chair@seat',
      'music_speakers@desk_left',
      'music_speakers@desk_right'
    ])
    // The crate is back in view there, but an item coming back is not an unlock.
    expect(mailBefore.replaced.map((p) => p.item)).toEqual(['base_crate'])
    expect(diffRoomStates(mailBefore, mailAfter)).toEqual([])
  })
})

describe('timezone change', () => {
  // Two user messages: 03:30 UTC and 20:00 UTC on 3 November.
  const rows: HistoryRows = {
    chats: [{ id: 'a', roomId: 'coding' }],
    messages: [
      { chatId: 'a', role: 'user', createdAt: '2026-11-03T03:30:00.000Z' },
      { chatId: 'a', role: 'user', createdAt: '2026-11-03T20:00:00.000Z' }
    ],
    // Completed while the timezone was Santo Domingo, late on Monday 2 November.
    goalCompletions: [{ projectId: 'p1', roomId: 'coding', localDay: MON }]
  }

  it('converts instants to local days', () => {
    expect(localDayOf('2026-11-03T03:30:00.000Z', 'America/Santo_Domingo')).toBe(MON) // 23:30 on the 2nd
    expect(localDayOf('2026-11-03T03:30:00.000Z', 'Europe/London')).toBe(TUE)
    expect(localDayOf('2026-11-03T20:00:00.000Z', 'Asia/Tokyo')).toBe(WED) // 05:00 on the 4th
    expect(localDayOf('2026-03-08T07:30:00.000Z', 'America/New_York')).toBe('2026-03-08') // 03:30 EDT, after the DST jump
    expect(localDayOf('2026-03-08T04:30:00.000Z', 'America/New_York')).toBe('2026-03-07') // 23:30 EST
    expect(() => localDayOf('not a date', 'UTC')).toThrow(/Invalid timestamp/)
    expect(() => localDayOf('2026-11-03T03:30:00.000Z', 'Mars/Olympus')).toThrow()
  })

  it('keeps the local day stored on a message when the setting changes', () => {
    // Written in Santo Domingo: Monday 23:30 and Tuesday 16:00, stored as such.
    const stored: HistoryRows = {
      ...rows,
      messages: [
        { chatId: 'a', role: 'user', createdAt: '2026-11-03T03:30:00.000Z', localDay: MON },
        { chatId: 'a', role: 'user', createdAt: '2026-11-03T20:00:00.000Z', localDay: TUE }
      ]
    }
    for (const tz of ['America/Santo_Domingo', 'Europe/London', 'Asia/Tokyo']) {
      const events = buildRoomEvents(stored, tz)
      expect(events.filter((e) => e.kind === 'user_message').map((e) => e.localDay)).toEqual([MON, TUE])
      // In London both instants are Tuesday, yet the two room days and the chair stay.
      const state = computeRoomState('coding', events, catalog, TUE)
      expect(state.streak).toMatchObject({ current: 2, best: 2, lastRoomDay: TUE })
      expect(placed(state)).toContain('base_chair@seat')
    }
  })

  it('derives the day from the timestamp only for rows written before days were stored', () => {
    // Santo Domingo (UTC-4): Monday 23:30 and Tuesday 16:00 -> two room days.
    const home = computeRoomState('coding', buildRoomEvents(rows, 'America/Santo_Domingo'), catalog, TUE)
    expect(home.streak).toMatchObject({ current: 2, best: 2, lastRoomDay: TUE })
    expect(placed(home)).toContain('base_chair@seat')

    // London (UTC+0): both messages fall on Tuesday -> one room day.
    const away = computeRoomState('coding', buildRoomEvents(rows, 'Europe/London'), catalog, TUE)
    expect(away.streak).toMatchObject({ current: 1, best: 1, lastRoomDay: TUE })
    expect(placed(away)).not.toContain('base_chair@seat')

    // Tokyo (UTC+9): Tuesday 12:30 and Wednesday 05:00 -> two room days again, one day later.
    const far = computeRoomState('coding', buildRoomEvents(rows, 'Asia/Tokyo'), catalog, WED)
    expect(far.streak).toMatchObject({ current: 2, best: 2, lastRoomDay: WED })
  })

  it('keeps the stored local day of goal completions', () => {
    for (const tz of ['America/Santo_Domingo', 'Europe/London', 'Asia/Tokyo']) {
      const events = buildRoomEvents(rows, tz)
      expect(events.filter((e) => e.kind === 'goal_completed')).toEqual([
        { kind: 'goal_completed', roomId: 'coding', localDay: MON, projectId: 'p1' }
      ])
      expect(computeRoomState('coding', events, catalog, WED).goals.count).toBe(1)
    }
  })

  it('leaves out days that are still in the future on the new calendar', () => {
    // Flying west: in Tokyo it was already Wednesday, in Santo Domingo it is still Tuesday.
    const events = buildRoomEvents(rows, 'Asia/Tokyo')
    expect(computeRoomState('coding', events, catalog, TUE).streak).toMatchObject({ current: 1, best: 1 })
  })
})

describe('unlock events', () => {
  it('reports the items and the shell tier gained between two states', () => {
    const days = run('2026-10-01', 5)
    const yesterday = computeRoomState('coding', chatsOn('coding', days.slice(0, 4)), catalog, days[3]!)
    const today = computeRoomState('coding', chatsOn('coding', days), catalog, days[4]!)
    expect(diffRoomStates(yesterday, today)).toEqual([
      { kind: 'shell', roomId: 'coding', shell: 'painted', previous: 'bare' },
      { kind: 'item', roomId: 'coding', item: 'base_rug', slot: 'rug', index: 0, source: 'streak', at: 5, signature: null, replaces: null }
    ])
  })

  it('says what an upgrade replaces', () => {
    const days = run('2026-10-01', 3)
    const yesterday = computeRoomState('coding', chatsOn('coding', days.slice(0, 2)), catalog, days[1]!)
    const today = computeRoomState('coding', chatsOn('coding', days), catalog, days[2]!)
    expect(diffRoomStates(yesterday, today)).toEqual([
      {
        kind: 'item',
        roomId: 'coding',
        item: 'coding_monitor',
        slot: 'desk_center',
        index: 0,
        source: 'streak',
        at: 3,
        signature: 2,
        replaces: 'coding_laptop'
      }
    ])
  })

  it('reports the shelf and the trophy for the first goal, then one trophy each', () => {
    const none = computeRoomState('art', [], catalog, WED)
    const one = computeRoomState('art', [goalOn('art', MON, 'p1')], catalog, WED)
    const two = computeRoomState('art', [goalOn('art', MON, 'p1'), goalOn('art', TUE, 'p2')], catalog, WED)
    const names = (events: ReturnType<typeof diffRoomStates>) =>
      events.map((e) => (e.kind === 'item' ? `${e.item}@${e.slot}#${e.index}` : e.shell))
    expect(names(diffRoomStates(none, one))).toEqual(['trophy_shelf@wall_left_b#0', 'trophy@trophy_shelf#0'])
    expect(names(diffRoomStates(one, two))).toEqual(['base_poster@wall_left_a#0', 'trophy@trophy_shelf#1'])
  })

  it('is empty when nothing changed, and when a day passes without a chat', () => {
    const events = chatsOn('coding', [MON, TUE, WED])
    const wed = computeRoomState('coding', events, catalog, WED)
    expect(diffRoomStates(wed, wed)).toEqual([])
    expect(diffRoomStates(wed, computeRoomState('coding', events, catalog, MON2))).toEqual([])
  })

  it('refuses to compare two different rooms', () => {
    const a = computeRoomState('coding', [], catalog, WED)
    const b = computeRoomState('music', [], catalog, WED)
    expect(() => diffRoomStates(a, b)).toThrow(/different rooms/)
  })
})

describe('purity', () => {
  it('does not mutate its inputs and gives the same answer twice', () => {
    const events = Object.freeze([...chatsOn('coding', [MON, TUE]), goalOn('coding', TUE, 'p1')].map((e) => Object.freeze(e)))
    const snapshot = JSON.stringify(catalog)
    const first = computeRoomState('coding', events, catalog, WED2)
    const second = computeRoomState('coding', events, catalog, WED2)
    expect(second).toEqual(first)
    expect(JSON.stringify(catalog)).toBe(snapshot)
  })
})

describe('decay', () => {
  /** The day `n` weekdays after `from`. */
  const afterWeekdays = (from: string, n: number): string => {
    let day = from
    for (let left = n; left > 0; ) {
      day = addDays(day, 1)
      if (!['saturday', 'sunday'].includes(weekdayOf(day))) left -= 1
    }
    return day
  }
  const project = (projectId: string, state: string, lastActivityDay: string | null, roomId = 'coding'): RoomEvent => ({
    kind: 'project',
    roomId,
    projectId,
    state,
    lastActivityDay
  })

  it('counts weekdays only: Friday to the next Friday is 5', () => {
    expect(weekdaysBetween('2026-11-06', '2026-11-13')).toBe(5)
    expect(weekdaysBetween(MON, MON)).toBe(0)
    expect(weekdaysBetween('2026-11-06', '2026-11-08')).toBe(0) // Friday to Sunday
  })

  it('never decays a room with no active project, however long ago', () => {
    const state = computeRoomState('coding', [project('p', 'paused', '2025-01-01')], catalog, MON)
    expect(state.decay).toEqual({ level: 0, weekdaysQuiet: 0, projectId: null })
  })

  it.each([
    [6, 0],
    [7, 1],
    [13, 1],
    [14, 2],
    [21, 3],
    [29, 3],
    [30, 4],
    [60, 4]
  ])('%i quiet weekdays on the quietest active project is level %i', (quiet, level) => {
    const today = afterWeekdays(MON, quiet)
    const state = computeRoomState('coding', [project('p', 'active', MON)], catalog, today)
    expect(state.decay).toEqual({ level, weekdaysQuiet: quiet, projectId: 'p' })
  })

  it('takes the quietest of several active projects and ignores closed ones and other rooms', () => {
    const today = afterWeekdays(MON, 20)
    const events = [
      project('busy', 'active', afterWeekdays(MON, 18)),
      project('quiet', 'active', afterWeekdays(MON, 5)),
      project('done', 'done', '2025-01-01'),
      project('dropped', 'dropped', '2025-01-01'),
      project('elsewhere', 'active', '2025-01-01', 'music')
    ]
    expect(computeRoomState('coding', events, catalog, today).decay).toEqual({ level: 2, weekdaysQuiet: 15, projectId: 'quiet' })
  })

  it('treats an active project with no activity yet as fresh', () => {
    expect(computeRoomState('coding', [project('p', 'active', null)], catalog, MON).decay.level).toBe(0)
  })

  it('comes from project rows through buildRoomEvents', () => {
    const rows: HistoryRows = {
      chats: [],
      messages: [],
      goalCompletions: [],
      projects: [{ id: 'p', roomId: 'art', state: 'active', lastActivityDay: MON }]
    }
    const state = computeRoomState('art', buildRoomEvents(rows, 'UTC'), catalog, afterWeekdays(MON, 7))
    expect(state.decay).toEqual({ level: 1, weekdaysQuiet: 7, projectId: 'p' })
  })
})
