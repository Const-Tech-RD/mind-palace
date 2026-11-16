/** Review fixes: evidence must back the status it is shown for, and the draft and refresh prompts stay within a budget. */
import { describe, expect, it } from 'vitest'
import {
  buildDraftPrompt,
  buildRefreshPrompt,
  draftSchema,
  EVIDENCE_INPUT_MAX,
  interpretDraft,
  interpretRefresh,
  refreshSchema,
  type KnownEvidence
} from '../src/shared/progressPrompts'

const known: KnownEvidence = {
  commits: new Map([['a1b2c3d', '2026-10-02']]),
  checkboxes: new Map([
    ['docs/plan.md:2', true],
    ['docs/plan.md:3', false]
  ]),
  chatIds: new Set(['cc-1'])
}

describe('plan evidence follows the checkbox', () => {
  it('a done milestone citing an unticked box is not confirmed', () => {
    const [m] = interpretDraft(draftSchema.parse({ milestones: [{ title: 'Payments', status: 'done', done_on: '2026-11-01', evidence: 'plan', evidence_ref: 'docs/plan.md:3' }] }), known)
    expect(m).toMatchObject({ evidence: 'chat', evidenceRef: null })
  })

  it('a done milestone citing a ticked box is', () => {
    const [m] = interpretDraft(draftSchema.parse({ milestones: [{ title: 'Login', status: 'done', done_on: '2026-10-01', evidence: 'plan', evidence_ref: 'docs/plan.md:2' }] }), known)
    expect(m).toMatchObject({ evidence: 'plan', evidenceRef: 'docs/plan.md:2' })
  })

  it('a planned milestone may cite an unticked box', () => {
    const [m] = interpretDraft(draftSchema.parse({ milestones: [{ title: 'Payments', status: 'planned', done_on: '', evidence: 'plan', evidence_ref: 'docs/plan.md:3' }] }), known)
    expect(m).toMatchObject({ evidence: 'plan', evidenceRef: 'docs/plan.md:3' })
  })

  it('a tick citing an unticked box is not confirmed', () => {
    const [p] = interpretRefresh(
      refreshSchema.parse({ proposals: [{ kind: 'tick', milestone_id: 'm1', title: 'Payments', after_id: '', evidence: 'plan', evidence_ref: 'docs/plan.md:3', done_on: '2026-11-01' }] }),
      { ...known, milestoneIds: new Set(['m1']) }
    )
    expect(p).toMatchObject({ evidence: 'chat', evidenceRef: null })
  })
})

describe('a commit gives its day', () => {
  it('a done milestone backed by a commit and no day takes the commit\'s day', () => {
    const [m] = interpretDraft(draftSchema.parse({ milestones: [{ title: 'Login', status: 'done', done_on: '', evidence: 'commit', evidence_ref: 'a1b2c3d' }] }), known)
    expect(m).toMatchObject({ doneOn: '2026-10-02', evidence: 'commit' })
  })
})

describe('the draft and refresh prompts stay within a budget', () => {
  const big = {
    title: 'Huge',
    digests: Array.from({ length: 400 }, (_, i) => ({
      chatId: `cc-${i}`,
      title: `Chat ${i}`,
      digest: { done: Array.from({ length: 10 }, (_, j) => ({ item: `did thing ${j} `.repeat(5), day: '2026-10-01' })), planned: ['more '.repeat(20)] }
    })),
    commits: Array.from({ length: 200 }, (_, i) => ({ hash: `h${String(i).padStart(6, '0')}`, day: '2026-10-01', refs: '', subject: 'x'.repeat(120) })),
    checkboxes: Array.from({ length: 2000 }, (_, i) => ({ file: 'docs/plan.md', line: i + 1, done: false, text: 'task '.repeat(20) }))
  }

  it('the draft prompt fits and says what was left out', () => {
    const prompt = buildDraftPrompt(big)
    expect(prompt.length).toBeLessThanOrEqual(EVIDENCE_INPUT_MAX + 2000)
    expect(prompt).toMatch(/left out/)
  })

  it('the refresh prompt fits too', () => {
    expect(buildRefreshPrompt({ ...big, milestones: [] }).length).toBeLessThanOrEqual(EVIDENCE_INPUT_MAX + 2000)
  })

  it('a small project is sent whole', () => {
    const small = { title: 'Small', digests: big.digests.slice(0, 2), commits: big.commits.slice(0, 3), checkboxes: big.checkboxes.slice(0, 3) }
    expect(buildDraftPrompt(small)).not.toMatch(/left out/)
  })
})
