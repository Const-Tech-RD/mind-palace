import { describe, expect, it } from 'vitest'
import { acceptProposal, applyEdit, draftRows, filterProposals, foldTitle, pendingProposals, progressOf, type Milestone, type Proposal } from '../src/shared/milestones'

let n = 0
const ctx = { today: '2026-11-16', now: '2026-11-16T12:00:00.000Z', newId: () => `new-${++n}` }

function ms(id: string, title: string, over: Partial<Milestone> = {}): Milestone {
  return {
    id,
    title,
    originalTitle: title,
    position: 0,
    status: 'planned',
    doneOn: null,
    evidence: 'chat',
    evidenceRef: null,
    edited: false,
    statusByUser: false,
    deletedAt: null,
    ...over
  }
}
const list = (): Milestone[] => [ms('a', 'Login', { position: 0, status: 'done', doneOn: '2026-10-01' }), ms('b', 'Payments', { position: 1 }), ms('c', 'Dashboard', { position: 2 })]
const byId = (l: Milestone[], id: string): Milestone => l.find((m) => m.id === id)!
const live = (l: Milestone[]): string[] => l.filter((m) => m.deletedAt === null).sort((x, y) => x.position - y.position).map((m) => m.id)

type Fresh = Omit<Proposal, 'id' | 'answered'>
const add = (title: string, over: Partial<Fresh> = {}): Fresh => ({ kind: 'add', milestoneId: null, title, afterId: null, evidence: 'chat', evidenceRef: null, doneOn: null, ...over })
const tick = (milestoneId: string, title: string, evidence: Fresh['evidence'], evidenceRef: string | null): Fresh => ({
  kind: 'tick',
  milestoneId,
  title,
  afterId: null,
  evidence,
  evidenceRef,
  doneOn: '2026-11-10'
})
const past = (p: Fresh, answered: Proposal['answered']): Proposal => ({ ...p, id: `p-${++n}`, answered })

describe('applyEdit', () => {
  it('a hand tick marks it done today, by the person', () => {
    const b = byId(applyEdit(list(), { kind: 'tick', id: 'b', done: true }, ctx), 'b')
    expect(b).toMatchObject({ status: 'done', evidence: 'user', evidenceRef: null, doneOn: '2026-11-16', statusByUser: true, edited: true })
  })

  it('a hand tick can carry a day', () => {
    expect(byId(applyEdit(list(), { kind: 'tick', id: 'b', done: true, doneOn: '2026-11-02' }, ctx), 'b').doneOn).toBe('2026-11-02')
  })

  it('an untick clears the day and is the person\'s', () => {
    const a = byId(applyEdit(list(), { kind: 'tick', id: 'a', done: false }, ctx), 'a')
    expect(a).toMatchObject({ status: 'planned', doneOn: null, statusByUser: true, edited: true })
  })

  it('an untick drops the evidence that it was done', () => {
    const done = ms('a', 'Login', { status: 'done', doneOn: '2026-10-01', evidence: 'commit', evidenceRef: 'a1b2c3d' })
    expect(byId(applyEdit([done], { kind: 'tick', id: 'a', done: false }, ctx), 'a')).toMatchObject({ evidence: 'user', evidenceRef: null })
  })

  it('a rename keeps the original title', () => {
    const b = byId(applyEdit(list(), { kind: 'rename', id: 'b', title: '  Stripe payments ' }, ctx), 'b')
    expect(b).toMatchObject({ title: 'Stripe payments', originalTitle: 'Payments', edited: true })
  })

  it('a move renumbers the live milestones', () => {
    const moved = applyEdit(list(), { kind: 'move', id: 'c', toIndex: 0 }, ctx)
    expect(live(moved)).toEqual(['c', 'a', 'b'])
    expect(moved.map((m) => m.position).sort()).toEqual([0, 1, 2])
    expect(byId(moved, 'c').edited).toBe(true)
  })

  it('an add goes after the given milestone, or at the end', () => {
    const after = applyEdit(list(), { kind: 'add', title: 'Emails', afterId: 'a' }, ctx)
    const added = after.find((m) => m.title === 'Emails')!
    expect(live(after)).toEqual(['a', added.id, 'b', 'c'])
    expect(added).toMatchObject({ originalTitle: 'Emails', status: 'planned', evidence: 'user', edited: true })
    const end = applyEdit(list(), { kind: 'add', title: 'Launch', afterId: null }, ctx)
    expect(live(end).at(-1)).toBe(end.find((m) => m.title === 'Launch')!.id)
  })

  it('a delete keeps a tombstone out of the order', () => {
    const gone = applyEdit(list(), { kind: 'delete', id: 'b' }, ctx)
    expect(byId(gone, 'b').deletedAt).toBe(ctx.now)
    expect(live(gone)).toEqual(['a', 'c'])
    expect(byId(gone, 'c').position).toBe(1)
  })

  it('refuses an empty title', () => {
    expect(() => applyEdit(list(), { kind: 'rename', id: 'b', title: '  ' }, ctx)).toThrow()
    expect(() => applyEdit(list(), { kind: 'add', title: '', afterId: null }, ctx)).toThrow()
  })
})

describe('foldTitle', () => {
  it('ignores case, accents and punctuation', () => {
    expect(foldTitle('Página de Pagos!')).toBe(foldTitle('pagina de pagos'))
  })
})

describe('filterProposals', () => {
  it('drops an add matching a live, deleted or original title, or a dismissed add', () => {
    let l = list()
    l = applyEdit(l, { kind: 'rename', id: 'b', title: 'Stripe' }, ctx)
    l = applyEdit(l, { kind: 'delete', id: 'c' }, ctx)
    const dismissed = past(add('Emails'), 'dismissed')
    const fresh = [add('LOGIN'), add('Payments'), add('dashboard'), add('emails'), add('Launch')]
    expect(filterProposals(fresh, l, [dismissed]).map((p) => p.title)).toEqual(['Launch'])
  })

  it('drops ticks on milestones the person set, or already done', () => {
    const l = applyEdit(list(), { kind: 'tick', id: 'b', done: false }, ctx)
    expect(filterProposals([tick('b', 'Payments', 'commit', 'abc1234'), tick('a', 'Login', 'commit', 'abc1234')], l, [])).toEqual([])
  })

  it('a dismissed tick blocks the same evidence only', () => {
    const old = past(tick('c', 'Dashboard', 'commit', 'abc1234'), 'dismissed')
    const kept = filterProposals([tick('c', 'Dashboard', 'commit', 'abc1234'), tick('c', 'Dashboard', 'commit', 'def5678')], list(), [old])
    expect(kept.map((p) => p.evidenceRef)).toEqual(['def5678'])
  })

  it('drops a proposal still waiting for an answer, and duplicates', () => {
    const waiting = past(add('Launch'), null)
    expect(filterProposals([add('Launch'), add('Docs'), add('docs')], list(), [waiting]).map((p) => p.title)).toEqual(['Docs'])
  })

  it('drops a tick for a milestone that is gone', () => {
    expect(filterProposals([tick('zzz', 'Ghost', 'chat', 'chat-1')], list(), [])).toEqual([])
  })
})

describe('acceptProposal', () => {
  it('an accepted add is inserted after its milestone, by the model', () => {
    const p = past(add('Emails', { afterId: 'a', evidence: 'plan', evidenceRef: 'docs/plan.md:4' }), null)
    const next = acceptProposal(list(), p, ctx)
    const added = next.find((m) => m.title === 'Emails')!
    expect(live(next)).toEqual(['a', added.id, 'b', 'c'])
    expect(added).toMatchObject({ status: 'planned', evidence: 'plan', evidenceRef: 'docs/plan.md:4', edited: false })
  })

  it('an accepted add with a day comes in done', () => {
    const p = past(add('Emails', { doneOn: '2026-11-01', evidence: 'commit', evidenceRef: 'abc1234' }), null)
    expect(acceptProposal(list(), p, ctx).find((m) => m.title === 'Emails')).toMatchObject({ status: 'done', doneOn: '2026-11-01' })
  })

  it('an accepted tick marks it done with the evidence', () => {
    const p = past(tick('b', 'Payments', 'commit', 'abc1234'), null)
    expect(byId(acceptProposal(list(), p, ctx), 'b')).toMatchObject({ status: 'done', doneOn: '2026-11-10', evidence: 'commit', evidenceRef: 'abc1234', statusByUser: false })
  })
})

describe('progressOf', () => {
  it('counts live milestones only', () => {
    expect(progressOf([])).toBeNull()
    expect(progressOf(applyEdit(list(), { kind: 'delete', id: 'c' }, ctx))).toEqual({ done: 1, total: 2 })
    expect(progressOf(applyEdit(list(), { kind: 'delete', id: 'a' }, ctx))).toEqual({ done: 0, total: 2 })
  })
})

describe('pendingProposals (review fix: waiting proposals follow later hand edits)', () => {
  const wait = (p: Fresh): Proposal => ({ ...p, id: `w-${++n}`, answered: null })

  it('drops a waiting tick once the person set that status, deleted it, or it is done', () => {
    let l = list()
    const onB = wait(tick('b', 'Payments', 'commit', 'abc1234'))
    const onC = wait(tick('c', 'Dashboard', 'commit', 'abc1234'))
    const onA = wait(tick('a', 'Login', 'commit', 'abc1234'))
    l = applyEdit(l, { kind: 'tick', id: 'b', done: false }, ctx)
    l = applyEdit(l, { kind: 'delete', id: 'c' }, ctx)
    expect(pendingProposals([onB, onC, onA], l)).toEqual([])
  })

  it('drops a waiting add once a milestone has that title, and keeps the rest', () => {
    const l = applyEdit(list(), { kind: 'add', title: 'Emails', afterId: null }, ctx)
    const emails = wait(add('emails'))
    const launch = wait(add('Launch'))
    expect(pendingProposals([emails, launch], l)).toEqual([launch])
  })

  it('ignores answered proposals', () => {
    expect(pendingProposals([past(add('Launch'), 'dismissed')], list())).toEqual([])
  })
})

describe('draftRows (review fix: a new draft after deleting everything)', () => {
  it('drops drafted titles that match a deleted or renamed milestone', () => {
    let l = applyEdit(list(), { kind: 'rename', id: 'b', title: 'Stripe' }, ctx)
    for (const id of ['a', 'b', 'c']) l = applyEdit(l, { kind: 'delete', id }, ctx)
    const drafted = [
      { title: 'login', status: 'done' as const, doneOn: '2026-10-01', evidence: 'chat' as const, evidenceRef: null },
      { title: 'Payments', status: 'planned' as const, doneOn: null, evidence: 'chat' as const, evidenceRef: null },
      { title: 'Launch', status: 'planned' as const, doneOn: null, evidence: 'chat' as const, evidenceRef: null }
    ]
    expect(draftRows(drafted, l).map((d) => d.title)).toEqual(['Launch'])
  })
})

describe('confirm (the review banner)', () => {
  it('marks a chat-backed done milestone as the person\'s, keeping its day and evidence', () => {
    const l = [ms('a', 'Crops goals', { status: 'done', doneOn: '2026-11-06', evidence: 'chat', evidenceRef: 'cc-1' })]
    expect(byId(applyEdit(l, { kind: 'confirm', id: 'a' }, ctx), 'a')).toMatchObject({ status: 'done', doneOn: '2026-11-06', evidence: 'chat', evidenceRef: 'cc-1', edited: true })
  })
})
