import { describe, expect, it } from 'vitest'
import { GROUPING_JSON_SCHEMA, MATERIALIZE_JSON_SCHEMA } from '../src/shared/roomPrompts'
import {
  buildDigestPrompt,
  buildDraftPrompt,
  buildRefreshPrompt,
  buildSweepPrompt,
  DIGEST_INPUT_MAX,
  DIGEST_JSON_SCHEMA,
  DRAFT_JSON_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  digestSchema,
  draftSchema,
  interpretDigest,
  interpretDraft,
  interpretRefresh,
  interpretSweep,
  MAX_DRAFT_MILESTONES,
  REFRESH_JSON_SCHEMA,
  REFRESH_SYSTEM_PROMPT,
  refreshSchema,
  SWEEP_JSON_SCHEMA,
  sweepSchema
} from '../src/shared/progressPrompts'
import type { Milestone } from '../src/shared/milestones'

const known = {
  commits: new Map([['a1b2c3d', '2026-10-02']]),
  checkboxes: new Map([['docs/plan.md:3', true]]),
  chatIds: new Set(['cc-1'])
}

const row = (over: Record<string, unknown> = {}) => ({ title: 'Login', status: 'done', done_on: '2026-10-01', evidence: 'commit', evidence_ref: 'a1b2c3d', ...over })

describe('schemas', () => {
  const schemas = { sweep: SWEEP_JSON_SCHEMA, digest: DIGEST_JSON_SCHEMA, draft: DRAFT_JSON_SCHEMA, refresh: REFRESH_JSON_SCHEMA }

  it('keep the fake model dispatch unique', () => {
    const required = (s: { required: readonly string[] }): string => [...s.required].sort().join(',')
    const all = [...Object.values(schemas), MATERIALIZE_JSON_SCHEMA, GROUPING_JSON_SCHEMA].map(required)
    expect(new Set(all).size).toBe(all.length)
    for (const s of Object.values(schemas)) {
      expect(s.required).not.toContain('items')
      expect(s.required).not.toContain('areas')
    }
  })

  it('match their zod schemas', () => {
    expect(sweepSchema.safeParse({ chat_ids: ['x'] }).success).toBe(true)
    expect(digestSchema.safeParse({ done: [{ item: 'x', day: '2026-10-01' }], planned: ['y'] }).success).toBe(true)
    expect(draftSchema.safeParse({ milestones: [row()] }).success).toBe(true)
    expect(
      refreshSchema.safeParse({ proposals: [{ kind: 'add', milestone_id: '', title: 'x', after_id: '', evidence: 'chat', evidence_ref: 'cc-1', done_on: '' }] }).success
    ).toBe(true)
  })
})

describe('interpretSweep', () => {
  it('keeps only ids from the batch, once', () => {
    expect(interpretSweep({ chat_ids: ['a', 'zzz', 'a', 'b'] }, ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })
})

describe('buildDigestPrompt', () => {
  it('clips long chats from the start, keeping the newest, and says so', () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i} ` + 'w '.repeat(500), day: '2026-10-01' }))
    const prompt = buildDigestPrompt({ title: 'Big chat', messages })
    expect(prompt.length).toBeLessThanOrEqual(DIGEST_INPUT_MAX + 1000)
    expect(prompt).toContain('m59 ')
    expect(prompt).not.toContain('m0 ')
    expect(prompt).toMatch(/\d+ earlier messages left out/)
  })
})

describe('interpretDigest', () => {
  it('drops items with a bad day and empty planned lines', () => {
    expect(interpretDigest({ done: [{ item: 'Deployed', day: '2026-10-02' }, { item: 'x', day: 'yesterday' }], planned: [' Payments ', ''] })).toEqual({
      done: [{ item: 'Deployed', day: '2026-10-02' }],
      planned: ['Payments']
    })
  })
})

describe('interpretDraft', () => {
  it('keeps evidence that exists', () => {
    const [m] = interpretDraft(draftSchema.parse({ milestones: [row()] }), known)
    expect(m).toEqual({ title: 'Login', status: 'done', doneOn: '2026-10-01', evidence: 'commit', evidenceRef: 'a1b2c3d' })
  })

  it('shows a made-up commit or plan line as chat evidence, never as confirmed', () => {
    const out = interpretDraft(draftSchema.parse({ milestones: [row({ evidence_ref: 'deadbee' }), row({ title: 'Plan', evidence: 'plan', evidence_ref: 'docs/plan.md:99' })] }), known)
    expect(out.map((m) => [m.evidence, m.evidenceRef])).toEqual([
      ['chat', null],
      ['chat', null]
    ])
  })

  it('matches a longer hash by its short form and keeps known chats', () => {
    const out = interpretDraft(draftSchema.parse({ milestones: [row({ evidence_ref: 'a1b2c3d4e5f6' }), row({ title: 'Talked', evidence: 'chat', evidence_ref: 'cc-1' }), row({ title: 'Other', evidence: 'chat', evidence_ref: 'nope' })] }), known)
    expect(out.map((m) => m.evidenceRef)).toEqual(['a1b2c3d', 'cc-1', null])
  })

  it('a planned milestone has no day; a done one with a bad day keeps none', () => {
    const out = interpretDraft(draftSchema.parse({ milestones: [row({ status: 'planned' }), row({ title: 'B', done_on: 'last week', evidence: 'chat', evidence_ref: 'cc-1' })] }), known)
    expect(out.map((m) => m.doneOn)).toEqual([null, null])
  })

  it('trims and caps titles, drops empty ones and repeats, and caps the count', () => {
    const many = Array.from({ length: MAX_DRAFT_MILESTONES + 5 }, (_, i) => row({ title: `Step ${i}` }))
    expect(interpretDraft(draftSchema.parse({ milestones: many }), known)).toHaveLength(MAX_DRAFT_MILESTONES)
    const out = interpretDraft(draftSchema.parse({ milestones: [row({ title: '  ' + 'x'.repeat(100) }), row({ title: '' }), row({ title: 'Login' }), row({ title: 'login!' })] }), known)
    expect(out.map((m) => m.title.length)).toEqual([80, 5])
  })
})

describe('interpretRefresh', () => {
  const ids = { ...known, milestoneIds: new Set(['m1', 'm2']) }
  const p = (over: Record<string, unknown>) => ({ kind: 'add', milestone_id: '', title: 'Emails', after_id: '', evidence: 'chat', evidence_ref: 'cc-1', done_on: '', ...over })

  it('drops a tick for an unknown milestone and nulls an unknown after_id', () => {
    const out = interpretRefresh(refreshSchema.parse({ proposals: [p({ kind: 'tick', milestone_id: 'zzz', title: 'Ghost' }), p({ after_id: 'zzz' }), p({ title: 'Docs', after_id: 'm1' })] }), ids)
    expect(out).toEqual([
      { kind: 'add', milestoneId: null, title: 'Emails', afterId: null, evidence: 'chat', evidenceRef: 'cc-1', doneOn: null },
      { kind: 'add', milestoneId: null, title: 'Docs', afterId: 'm1', evidence: 'chat', evidenceRef: 'cc-1', doneOn: null }
    ])
  })

  it('checks a tick\'s evidence like the draft does', () => {
    const [t] = interpretRefresh(refreshSchema.parse({ proposals: [p({ kind: 'tick', milestone_id: 'm2', title: 'Pay', evidence: 'commit', evidence_ref: 'deadbee', done_on: '2026-11-01' })] }), ids)
    expect(t).toMatchObject({ kind: 'tick', milestoneId: 'm2', evidence: 'chat', evidenceRef: null, doneOn: '2026-11-01' })
  })
})

describe('the draft and refresh prompts', () => {
  const milestone: Milestone = {
    id: 'm1',
    title: 'Stripe',
    originalTitle: 'Payments',
    position: 0,
    status: 'planned',
    doneOn: null,
    evidence: 'chat',
    evidenceRef: null,
    edited: true,
    statusByUser: false,
    deletedAt: null
  }
  const input = {
    title: 'Shop',
    digests: [{ chatId: 'cc-1', title: 'Day one', digest: { done: [{ item: 'Set up repo', day: '2026-10-01' }], planned: ['Payments'] } }],
    commits: [{ hash: 'a1b2c3d', day: '2026-10-02', refs: 'main', subject: 'feat: login' }],
    checkboxes: [{ file: 'docs/plan.md', line: 3, done: false, text: 'Payments' }]
  }

  it('give the model every piece of evidence with its reference', () => {
    const prompt = buildDraftPrompt(input)
    for (const s of ['cc-1', 'Set up repo', 'a1b2c3d', 'feat: login', 'docs/plan.md:3', 'Payments']) expect(prompt).toContain(s)
  })

  it('list each milestone with its id and whether the person edited it', () => {
    const prompt = buildRefreshPrompt({ ...input, milestones: [milestone] })
    expect(prompt).toContain('m1')
    expect(prompt).toMatch(/edited by the person/i)
  })

  it('say what a milestone is, the evidence rule, and JSON only', () => {
    for (const system of [DRAFT_SYSTEM_PROMPT, REFRESH_SYSTEM_PROMPT]) {
      expect(system).toMatch(/not a single commit/i)
      expect(system).toMatch(/evidence/i)
      expect(system).toMatch(/JSON/)
    }
  })
})
