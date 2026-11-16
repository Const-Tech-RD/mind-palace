import { describe, expect, it } from 'vitest'
import { parseCheckboxes, parseGitLog, planMentions } from '../src/shared/repoEvidence'

describe('parseGitLog', () => {
  it('reads hash, day, refs and subject', () => {
    const tab = (...fields: string[]): string => fields.join('\t')
    const out = [tab('a1b2c3d', '2026-10-03', 'HEAD -> main, origin/main', 'feat: x'), tab('9f8e7d6', '2026-10-01', '', 'fix: y has  two spaces'), ''].join('\n')
    expect(parseGitLog(out)).toEqual([
      { hash: 'a1b2c3d', day: '2026-10-03', refs: 'HEAD -> main, origin/main', subject: 'feat: x' },
      { hash: '9f8e7d6', day: '2026-10-01', refs: '', subject: 'fix: y has  two spaces' }
    ])
  })
})

describe('parseCheckboxes', () => {
  it('finds ticked and open boxes with 1-based lines, outside code fences', () => {
    const text = ['# Plan', '- [x] Login', '- [ ] Payments', '```', '- [ ] not a task', '```', '  * [X] Nested done'].join('\n')
    expect(parseCheckboxes('docs/plan.md', text)).toEqual([
      { file: 'docs/plan.md', line: 2, done: true, text: 'Login' },
      { file: 'docs/plan.md', line: 3, done: false, text: 'Payments' },
      { file: 'docs/plan.md', line: 7, done: true, text: 'Nested done' }
    ])
  })
})

describe('planMentions', () => {
  it('finds the project name in the first 40 lines or the file name, folded', () => {
    expect(planMentions('# TuAutoRD plan\n', ['tuautord'])).toBe(true)
    expect(planMentions('x\n'.repeat(40) + 'tuautord', ['tuautord'])).toBe(false)
    expect(planMentions('nothing here', ['tuautord'], 'docs/plans/2026-tuautord-search.md')).toBe(true)
    expect(planMentions('Lista de compras', ['lista compras'])).toBe(true)
  })
})

describe('planMentions with a Windows file path', () => {
  it('reads only the file name', () => {
    const path = ['C:', 'Users', 'projects', 'tuautord', 'docs', 'plan.md'].join(String.fromCharCode(92))
    expect(planMentions('nothing', ['tuautord'], path)).toBe(false)
  })
})
