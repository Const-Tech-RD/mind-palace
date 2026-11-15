import { describe, expect, it } from 'vitest'
import type { ProjectAction } from '../src/shared/projects'
import {
  buildNudgePrompt,
  cleanNudge,
  fallbackNudge,
  offsetDays,
  planReminders,
  reminderDue,
  type ReminderItem,
  type ReminderOutcome,
  type ReminderProject
} from '../src/shared/reminders'
import type { JsonAnswer } from '../src/main/chat/claude'
import type { ReminderRepo } from '../src/main/reminders/repo'
import { createReminderService } from '../src/main/reminders/service'

const T0 = '2026-11-01T12:00:00.000Z'
const plusDays = (days: number, from = T0): Date => new Date(Date.parse(from) + days * 86_400_000)

const project = (over: Partial<ReminderProject> = {}): ReminderProject => ({
  id: 'p1',
  state: 'active',
  lastActivityAt: T0,
  createdAt: '2026-10-01T00:00:00.000Z',
  snoozedUntil: null,
  remindersSent: 0,
  ...over
})

describe('offsetDays', () => {
  it('is 3, 7, 14, then every 14 days', () => {
    expect([0, 1, 2, 3, 4, 5].map(offsetDays)).toEqual([3, 7, 14, 28, 42, 56])
  })
})

describe('reminderDue', () => {
  it('nothing before 3 quiet days; the first reminder at 3', () => {
    expect(reminderDue(project(), plusDays(2.99))).toBeNull()
    expect(reminderDue(project(), plusDays(3))).toEqual({ projectId: 'p1', dueAt: plusDays(3).toISOString(), remindersSent: 1 })
  })

  it('then at 7 and 14 days, then every 14', () => {
    expect(reminderDue(project({ remindersSent: 1 }), plusDays(6.9))).toBeNull()
    expect(reminderDue(project({ remindersSent: 1 }), plusDays(7))).toMatchObject({ remindersSent: 2 })
    expect(reminderDue(project({ remindersSent: 2 }), plusDays(14))).toMatchObject({ remindersSent: 3 })
    expect(reminderDue(project({ remindersSent: 3 }), plusDays(27))).toBeNull()
    expect(reminderDue(project({ remindersSent: 3 }), plusDays(28))).toMatchObject({ dueAt: plusDays(28).toISOString(), remindersSent: 4 })
  })

  it('after weeks with the machine off, one reminder covers every missed point', () => {
    // 20 quiet days, nothing sent: the 3, 7 and 14 day points have all passed.
    const due = reminderDue(project(), plusDays(20))
    expect(due).toEqual({ projectId: 'p1', dueAt: plusDays(3).toISOString(), remindersSent: 3 })
    // With those counted, the next one is the 28-day point, not an immediate second reminder.
    expect(reminderDue(project({ remindersSent: 3 }), plusDays(20))).toBeNull()
  })

  it('counts from creation when the project has had no activity', () => {
    expect(reminderDue(project({ lastActivityAt: null, createdAt: T0 }), plusDays(3))).toMatchObject({ remindersSent: 1 })
  })

  it('only active projects are reminded', () => {
    for (const state of ['suggested', 'paused', 'done', 'dropped'] as const) {
      expect(reminderDue(project({ state }), plusDays(30))).toBeNull()
    }
  })

  it('a snooze holds the reminder until it ends', () => {
    const snoozed = project({ snoozedUntil: plusDays(17).toISOString() })
    expect(reminderDue(snoozed, plusDays(10))).toBeNull()
    // When the snooze ends, one reminder, and the passed points are counted.
    expect(reminderDue(snoozed, plusDays(17))).toEqual({ projectId: 'p1', dueAt: plusDays(17).toISOString(), remindersSent: 3 })
    // A snooze that already ended changes nothing.
    expect(reminderDue(project({ snoozedUntil: plusDays(1).toISOString() }), plusDays(3))).toMatchObject({ remindersSent: 1 })
  })
})

describe('planReminders', () => {
  const projects = [
    project({ id: 'recent', lastActivityAt: plusDays(-3.5, plusDays(10).toISOString()).toISOString() }),
    project({ id: 'oldest', lastActivityAt: plusDays(-9, plusDays(10).toISOString()).toISOString() }),
    project({ id: 'middle', lastActivityAt: plusDays(-5, plusDays(10).toISOString()).toISOString() }),
    project({ id: 'fresh', lastActivityAt: plusDays(-1, plusDays(10).toISOString()).toISOString() })
  ]
  const now = plusDays(10)

  it('notifies the two longest overdue and leaves the rest for the inbox', () => {
    const plan = planReminders({ projects, now, notifiedToday: 0, notificationsOn: true })
    expect(plan.map((p) => [p.projectId, p.notify])).toEqual([
      ['oldest', true],
      ['middle', true],
      ['recent', false]
    ])
  })

  it('counts notifications already shown today', () => {
    expect(planReminders({ projects, now, notifiedToday: 1, notificationsOn: true }).map((p) => p.notify)).toEqual([true, false, false])
    expect(planReminders({ projects, now, notifiedToday: 2, notificationsOn: true }).map((p) => p.notify)).toEqual([false, false, false])
    expect(planReminders({ projects, now, notifiedToday: 5, notificationsOn: true }).map((p) => p.notify)).toEqual([false, false, false])
  })

  it('with notifications off every reminder still goes to the inbox', () => {
    const plan = planReminders({ projects, now, notifiedToday: 0, notificationsOn: false })
    expect(plan).toHaveLength(3)
    expect(plan.every((p) => !p.notify)).toBe(true)
  })
})

describe('nudge text', () => {
  it('the prompt names the project, its next step, and the end of the conversation', () => {
    const prompt = buildNudgePrompt({
      title: 'Pantry app',
      nextStep: 'Sketch the schema',
      messages: [
        { role: 'user', content: 'start'.padEnd(7000, '.') },
        { role: 'system', content: 'hidden' },
        { role: 'assistant', content: 'We stopped at the products table.' }
      ]
    })
    expect(prompt).toContain('Project: Pantry app')
    expect(prompt).toContain('Sketch the schema')
    expect(prompt).toContain('ASSISTANT: We stopped at the products table.')
    expect(prompt).not.toContain('hidden')
    // Long transcripts keep their end, not their beginning.
    expect(prompt).toContain('[…]')
    expect(prompt).not.toContain('USER: start')
  })

  it('cleanNudge accepts a message, flattens it, caps its length, and rejects anything else', () => {
    expect(cleanNudge({ message: '  Pantry app:\n add the products table.  ' })).toBe('Pantry app: add the products table.')
    expect(cleanNudge({ message: 'x'.repeat(500) })).toHaveLength(240)
    expect(cleanNudge({ message: '   ' })).toBeNull()
    expect(cleanNudge({ text: 'wrong key' })).toBeNull()
    expect(cleanNudge('a string')).toBeNull()
    expect(cleanNudge(null)).toBeNull()
  })

  it('fallbackNudge works with and without a next step', () => {
    expect(fallbackNudge('Pantry app', 'Sketch the schema')).toBe('Pantry app: Sketch the schema')
    expect(fallbackNudge('Pantry app', null)).toBe('Pantry app: pick one small next step.')
  })
})

/** In-memory stand-in for the SQLite reminder repo. */
function harness(options: { notificationsOn?: boolean; nudge?: JsonAnswer | Error } = {}) {
  const projects = new Map<string, ReminderProject & { title: string; nextStep: string | null; chatIds: string[] }>()
  const rows: Array<{ id: string; projectId: string; dueAt: string; message: string; sentAt: string | null; action: ReminderOutcome | null }> = []
  const shown: ReminderItem[] = []
  const actions: Array<[string, ProjectAction]> = []
  const prompts: string[] = []
  let changed = 0
  let clock = plusDays(0)
  let nudge = options.nudge ?? ({ ok: true, value: { message: 'Open it and do one small thing.' }, tokensIn: 1, tokensOut: 1 } satisfies JsonAnswer)
  let canNotify = true

  const toItem = (row: (typeof rows)[number]): ReminderItem => {
    const p = projects.get(row.projectId)!
    return { id: row.id, projectId: row.projectId, projectTitle: p.title, roomId: 'coding', message: row.message, dueAt: row.dueAt, notified: row.sentAt !== null, chatId: p.chatIds.at(-1) ?? null }
  }
  const repo: ReminderRepo = {
    activeProjects: () => [...projects.values()].filter((p) => p.state === 'active').map(({ title: _t, nextStep: _n, chatIds: _c, ...p }) => p),
    nudgeSource: (id) => {
      const p = projects.get(id)
      return p ? { title: p.title, nextStep: p.nextStep, chatIds: p.chatIds } : undefined
    },
    create(input) {
      const id = `r${rows.length + 1}`
      rows.push({ id, projectId: input.projectId, dueAt: input.dueAt, message: input.message, sentAt: null, action: null })
      projects.get(input.projectId)!.remindersSent = input.remindersSent
      return id
    },
    markNotified(id, at) {
      rows.find((r) => r.id === id)!.sentAt = at
    },
    notifiedSince: (since) => rows.filter((r) => r.sentAt !== null && r.sentAt >= since).map((r) => r.sentAt!),
    projectOf: (id) => rows.find((r) => r.id === id)?.projectId,
    resolve(projectId, outcome) {
      const waiting = rows.filter((r) => r.projectId === projectId && r.action === null)
      for (const r of waiting) r.action = outcome
      return waiting.length
    },
    waiting: () => rows.filter((r) => r.action === null).map(toItem).reverse(),
    item(id) {
      return this.waiting().find((item) => item.id === id)
    }
  }

  const service = createReminderService({
    repo,
    messagesOf: (chatId) => [{ role: 'user', content: `message in ${chatId}` }],
    askModel: async (prompt) => {
      prompts.push(prompt)
      if (nudge instanceof Error) throw nudge
      return nudge
    },
    notify: (item) => {
      if (!canNotify) return false
      shown.push(item)
      return true
    },
    notificationsOn: () => options.notificationsOn ?? true,
    timeZone: () => 'America/Santo_Domingo',
    projectAct: (projectId, action) => {
      actions.push([projectId, action])
      // The real projects service calls back into the reminders service.
      service.afterProjectAction(projectId, action)
    },
    onChanged: () => changed++,
    now: () => clock
  })

  const add = (id: string, quietDays: number, over: Partial<ReminderProject> = {}): void => {
    projects.set(id, { ...project({ id, lastActivityAt: plusDays(-quietDays, clock.toISOString()).toISOString(), ...over }), title: `Project ${id}`, nextStep: 'Next thing', chatIds: [`chat-${id}`] })
  }
  return {
    service, projects, rows, shown, actions, prompts, add,
    changed: () => changed,
    setNow: (date: Date) => (clock = date),
    setNudge: (value: JsonAnswer | Error) => (nudge = value),
    setCanNotify: (value: boolean) => (canNotify = value)
  }
}

describe('reminder service', () => {
  it('creates a reminder with the model text, notifies, and advances the cadence', async () => {
    const h = harness()
    h.add('a', 3)
    expect(await h.service.tick()).toBe(1)
    expect(h.rows).toMatchObject([{ projectId: 'a', message: 'Open it and do one small thing.', action: null }])
    expect(h.rows[0]!.sentAt).not.toBeNull()
    expect(h.shown.map((s) => s.projectTitle)).toEqual(['Project a'])
    expect(h.projects.get('a')!.remindersSent).toBe(1)
    expect(h.prompts[0]).toContain('Project: Project a')
    expect(h.prompts[0]).toContain('USER: message in chat-a')
    expect(h.changed()).toBe(1)
    // The same tick again does nothing: the next point is day 7.
    expect(await h.service.tick()).toBe(0)
  })

  it('at most two notifications a day across projects; the rest wait in the inbox', async () => {
    const h = harness()
    h.add('a', 4)
    h.add('b', 9)
    h.add('c', 5)
    expect(await h.service.tick()).toBe(3)
    expect(h.shown.map((s) => s.projectId)).toEqual(['b', 'c'])
    expect(h.rows.filter((r) => r.sentAt !== null).map((r) => r.projectId)).toEqual(['b', 'c'])
    expect(h.service.list().map((i) => [i.projectId, i.notified]).sort()).toEqual([['a', false], ['b', true], ['c', true]])

    // Later the same local day another project comes due: inbox only.
    h.add('d', 3)
    h.setNow(plusDays(0.2))
    await h.service.tick()
    expect(h.shown).toHaveLength(2)
    // The next local day the cap is fresh.
    h.add('e', 3)
    h.setNow(plusDays(1))
    await h.service.tick()
    expect(h.shown.map((s) => s.projectId)).toEqual(['b', 'c', 'e'])
  })

  it('the daily cap follows the local day, not the UTC day', async () => {
    const h = harness()
    // 23:00 in Santo Domingo on the 14th is 03:00 UTC on the 15th.
    h.setNow(new Date('2026-11-15T03:00:00.000Z'))
    h.add('a', 3)
    h.add('b', 4)
    await h.service.tick()
    expect(h.shown).toHaveLength(2)
    // 01:00 UTC-4 on the 15th: a new local day, although still the 15th in UTC.
    h.setNow(new Date('2026-11-15T05:00:00.000Z'))
    h.add('c', 3)
    await h.service.tick()
    expect(h.shown).toHaveLength(3)
  })

  it('with notifications off nothing is shown but the inbox still fills', async () => {
    const h = harness({ notificationsOn: false })
    h.add('a', 3)
    await h.service.tick()
    expect(h.shown).toEqual([])
    expect(h.service.list()).toMatchObject([{ projectId: 'a', notified: false }])
  })

  it('a notification that could not be shown is not counted as sent', async () => {
    const h = harness()
    h.setCanNotify(false)
    h.add('a', 3)
    await h.service.tick()
    expect(h.rows[0]!.sentAt).toBeNull()
    expect(h.service.list()[0]!.notified).toBe(false)
  })

  it('falls back to a plain text when the model fails, throws, or answers badly', async () => {
    for (const bad of [{ ok: false, error: 'rate limited' } satisfies JsonAnswer, new Error('offline'), { ok: true, value: { nope: 1 }, tokensIn: 1, tokensOut: 1 } satisfies JsonAnswer]) {
      const h = harness({ nudge: bad })
      h.add('a', 3)
      expect(await h.service.tick()).toBe(1)
      expect(h.rows[0]!.message).toBe('Project a: Next thing')
    }
  })

  it('after a long absence one reminder fires, not one per missed point', async () => {
    const h = harness()
    h.add('a', 20)
    expect(await h.service.tick()).toBe(1)
    expect(h.projects.get('a')!.remindersSent).toBe(3)
    h.setNow(plusDays(0.02))
    expect(await h.service.tick()).toBe(0)
    expect(h.rows).toHaveLength(1)
  })

  it('a reminder nobody reacted to is marked ignored when the next one comes due', async () => {
    const h = harness()
    h.add('a', 3)
    await h.service.tick()
    h.setNow(plusDays(4))
    await h.service.tick()
    expect(h.rows.map((r) => r.action)).toEqual(['ignored', null])
    expect(h.service.list()).toHaveLength(1)
  })

  it('Open marks the reminder opened and says where to go', async () => {
    const h = harness()
    h.add('a', 3)
    await h.service.tick()
    const id = h.service.list()[0]!.id
    expect(h.service.respond(id, 'open')).toEqual({ projectId: 'a', chatId: 'chat-a' })
    expect(h.rows[0]!.action).toBe('opened')
    expect(h.actions).toEqual([])
    expect(h.service.list()).toEqual([])
    expect(() => h.service.respond(id, 'open')).toThrow('already been answered')
  })

  it.each([
    ['done', 'done'],
    ['snooze', 'snoozed'],
    ['pause', 'paused'],
    ['drop', 'dropped']
  ] as const)('%s carries out the project action and logs "%s"', async (response, outcome) => {
    const h = harness()
    h.add('a', 3)
    await h.service.tick()
    h.service.respond(h.service.list()[0]!.id, response)
    expect(h.actions).toEqual([['a', response]])
    expect(h.rows[0]!.action).toBe(outcome)
  })

  it('an action taken in the projects panel answers the waiting reminder; reopen does not', async () => {
    const h = harness()
    h.add('a', 3)
    h.add('b', 3)
    await h.service.tick()
    h.service.afterProjectAction('a', 'pause')
    h.service.afterProjectAction('b', 'reopen')
    expect(h.rows.map((r) => [r.projectId, r.action]).sort()).toEqual([['a', 'paused'], ['b', null]])
  })

  it('coming back to the chat on your own counts as opened', async () => {
    const h = harness()
    h.add('a', 3)
    await h.service.tick()
    h.service.afterProjectActivity('a')
    expect(h.rows[0]!.action).toBe('opened')
    // With nothing waiting, activity changes nothing and reports no change.
    const before = h.changed()
    h.service.afterProjectActivity('a')
    expect(h.changed()).toBe(before)
  })

  it('paused, done and dropped projects get no reminders', async () => {
    const h = harness()
    for (const state of ['paused', 'done', 'dropped'] as const) h.add(state, 30, { state })
    expect(await h.service.tick()).toBe(0)
  })

  it('overlapping ticks do not create duplicates', async () => {
    const h = harness()
    h.add('a', 3)
    const [first, second] = await Promise.all([h.service.tick(), h.service.tick()])
    expect(first + second).toBe(1)
    expect(h.rows).toHaveLength(1)
  })
})
