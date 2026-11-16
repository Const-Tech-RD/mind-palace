import { describe, expect, it } from 'vitest'
import { decayLevel, DECAY_THRESHOLDS } from '../src/shared/engine'
import { nextReminderAt, reminderDue } from '../src/shared/reminders'
import type { Milestone } from '../src/shared/milestones'
import {
  dimOutlook,
  doneRange,
  milestonesPerDay,
  nextMilestone,
  paceEstimate,
  quietWeekdays,
  reviewItems,
  sortForList,
  statusOf,
  type ListProject
} from '../src/shared/projectPage'

// 2026-11-16 is a Monday.
const MON = '2026-11-16'

function ms(title: string, over: Partial<Milestone> = {}): Milestone {
  return {
    id: title,
    title,
    originalTitle: title,
    position: 0,
    status: 'planned',
    doneOn: null,
    evidence: 'commit',
    evidenceRef: 'abc1234',
    edited: false,
    statusByUser: false,
    deletedAt: null,
    ...over
  }
}
const done = (title: string, day: string, over: Partial<Milestone> = {}): Milestone => ms(title, { status: 'done', doneOn: day, ...over })

describe('decayLevel (pulled out of roomState)', () => {
  it('starts each level at its threshold', () => {
    expect(DECAY_THRESHOLDS).toEqual([7, 14, 21, 30])
    expect([0, 6, 7, 13, 14, 21, 29, 30, 99].map(decayLevel)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4])
  })
})

describe('quietWeekdays', () => {
  it('counts Monday to Friday since the last activity, like decay does', () => {
    expect(quietWeekdays('2026-11-06', MON)).toBe(6) // Fri Nov 6 → Mon Nov 16: Nov 9-13 and 16
    expect(quietWeekdays(MON, MON)).toBe(0)
    expect(quietWeekdays(null, MON)).toBe(0)
  })
})

describe('dimOutlook', () => {
  it('says when the room starts to dim', () => {
    expect(dimOutlook('2026-11-06', MON)).toEqual({ quiet: 6, threshold: 7, weekdaysLeft: 1, dimsOn: '2026-11-17', dimming: false })
  })

  it('skips the weekend when counting forward', () => {
    // Quiet since Mon Nov 9: Tue-Fri is 4, Mon Nov 16 is 5; dims after 2 more weekdays: Wed Nov 18.
    expect(dimOutlook('2026-11-09', MON)).toMatchObject({ quiet: 5, weekdaysLeft: 2, dimsOn: '2026-11-18' })
    // From a Friday with 6 quiet, the 7th weekday is Monday.
    expect(dimOutlook('2026-11-05', '2026-11-13')).toMatchObject({ quiet: 6, dimsOn: '2026-11-16' })
  })

  it('says dimming once past the threshold, and nothing without activity', () => {
    expect(dimOutlook('2026-10-01', MON)).toMatchObject({ dimming: true, weekdaysLeft: 0, dimsOn: null })
    expect(dimOutlook(null, MON)).toBeNull()
  })
})

describe('statusOf', () => {
  const now = new Date('2026-11-16T15:00:00Z')
  const base = { state: 'active' as const, lastActivityDay: '2026-11-06', snoozedUntil: null }

  it('shows paused, snoozed, active today and quiet', () => {
    expect(statusOf({ ...base, state: 'paused' }, MON, now)).toEqual({ kind: 'paused' })
    expect(statusOf({ ...base, snoozedUntil: '2026-11-30T12:00:00Z' }, MON, now)).toEqual({ kind: 'snoozed', until: '2026-11-30T12:00:00Z' })
    expect(statusOf({ ...base, snoozedUntil: '2026-11-01T12:00:00Z' }, MON, now)).toEqual({ kind: 'quiet', weekdays: 6 })
    expect(statusOf({ ...base, lastActivityDay: MON }, MON, now)).toEqual({ kind: 'active_today' })
    expect(statusOf({ ...base, state: 'done' }, MON, now)).toEqual({ kind: 'done' })
    expect(statusOf({ ...base, state: 'dropped' }, MON, now)).toEqual({ kind: 'dropped' })
  })

  it('a weekend-only gap is still quiet 0 weekdays, not active today', () => {
    expect(statusOf({ ...base, lastActivityDay: '2026-11-14' }, MON, now)).toEqual({ kind: 'quiet', weekdays: 1 })
    expect(statusOf({ ...base, lastActivityDay: '2026-11-13' }, '2026-11-15', now)).toEqual({ kind: 'quiet', weekdays: 0 })
  })
})

describe('milestonesPerDay', () => {
  it('counts done milestones on each day from the start to today', () => {
    const list = [done('a', '2026-11-01'), done('b', '2026-11-01'), done('c', '2026-11-03'), ms('d'), done('e', '2026-10-30')]
    expect(milestonesPerDay(list, '2026-11-01', '2026-11-04')).toEqual([
      { day: '2026-11-01', count: 2 },
      { day: '2026-11-02', count: 0 },
      { day: '2026-11-03', count: 1 },
      { day: '2026-11-04', count: 0 }
    ])
  })

  it('ignores deleted milestones', () => {
    expect(milestonesPerDay([done('a', '2026-11-01', { deletedAt: 'x' })], '2026-11-01', '2026-11-01')).toEqual([{ day: '2026-11-01', count: 0 }])
  })
})

describe('paceEstimate', () => {
  it('remaining divided by milestones per active day', () => {
    const list = [done('a', '2026-11-01'), done('b', '2026-11-01'), done('c', '2026-11-01'), done('d', '2026-11-02'), done('e', '2026-11-06'), done('f', '2026-11-06'), ms('g'), ms('h'), ms('i'), ms('j')]
    expect(paceEstimate(list)).toEqual({ done: 6, activeDays: 3, perActiveDay: 2, remaining: 4, activeDaysNeeded: 2 })
  })

  it('is hidden below 3 dated done milestones', () => {
    expect(paceEstimate([done('a', '2026-11-01'), done('b', '2026-11-02'), done('c', '2026-11-02', { doneOn: null }), ms('d')])).toBeNull()
  })

  it('needs no days when nothing is left', () => {
    expect(paceEstimate([done('a', '2026-11-01'), done('b', '2026-11-02'), done('c', '2026-11-03')])).toMatchObject({ remaining: 0, activeDaysNeeded: 0 })
  })
})

describe('review, next and done range', () => {
  const list = [
    done('Colony model', '2026-11-01'),
    done('Crops goals', '2026-11-06', { evidence: 'chat', evidenceRef: 'cc-1' }),
    done('Confirmed by hand', '2026-11-04', { evidence: 'chat', edited: true }),
    ms('Food screen', { position: 3, evidence: 'chat' }),
    ms('Roles panel', { position: 4 }),
    done('Gone', '2026-11-02', { evidence: 'chat', deletedAt: 'x' })
  ]

  it('review holds done milestones only chats back, untouched by the person', () => {
    expect(reviewItems(list).map((m) => m.title)).toEqual(['Crops goals'])
  })

  it('next is the first open milestone', () => {
    expect(nextMilestone(list)?.title).toBe('Food screen')
    expect(nextMilestone([done('a', '2026-11-01')])).toBeNull()
  })

  it('the done range spans the confirmed done milestones', () => {
    expect(doneRange(list)).toEqual({ count: 2, from: '2026-11-01', to: '2026-11-04' })
    expect(doneRange([ms('a')])).toEqual({ count: 0, from: null, to: null })
  })
})

describe('nextReminderAt (pulled out of reminderDue)', () => {
  const project = { id: 'p', state: 'active' as const, lastActivityAt: '2026-11-06T12:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z', snoozedUntil: null, remindersSent: 1 }

  it('is the next cadence point after the last activity, or the end of a snooze', () => {
    expect(nextReminderAt(project)).toBe('2026-11-13T12:00:00.000Z')
    expect(nextReminderAt({ ...project, snoozedUntil: '2026-11-30T00:00:00.000Z' })).toBe('2026-11-30T00:00:00.000Z')
    expect(nextReminderAt({ ...project, state: 'paused' })).toBeNull()
  })

  it('agrees with reminderDue', () => {
    const at = nextReminderAt(project)!
    expect(reminderDue(project, new Date(Date.parse(at) - 1))).toBeNull()
    expect(reminderDue(project, new Date(at))?.dueAt).toBe(at)
  })
})

describe('sortForList', () => {
  const p = (id: string, over: Partial<ListProject> = {}): ListProject => ({ id, title: id, state: 'active', quietWeekdays: 0, snoozed: false, ...over })

  it('quiet first, snoozed after, done and paused set aside', () => {
    const { shown, hidden } = sortForList([
      p('fresh'),
      p('quiet', { quietWeekdays: 6 }),
      p('quieter', { quietWeekdays: 9 }),
      p('snoozed', { quietWeekdays: 12, snoozed: true }),
      p('finished', { state: 'done' }),
      p('held', { state: 'paused' }),
      p('gone', { state: 'dropped' })
    ])
    expect(shown.map((x) => x.id)).toEqual(['quieter', 'quiet', 'fresh', 'snoozed'])
    expect(hidden.map((x) => x.id)).toEqual(['held', 'finished', 'gone'])
  })
})
