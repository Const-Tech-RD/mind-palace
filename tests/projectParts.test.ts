/** Component tests for the project page's review banner and done collapse, rendered to markup. */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Milestone } from '../src/shared/milestones'
import { doneRange, reviewItems } from '../src/shared/projectPage'
import { DoneSection, ReviewBanner } from '../src/renderer/src/components/project/parts'

function ms(title: string, over: Partial<Milestone> = {}): Milestone {
  return { id: title, title, originalTitle: title, position: 0, status: 'done', doneOn: '2026-11-01', evidence: 'commit', evidenceRef: 'abc1234', edited: false, statusByUser: false, deletedAt: null, ...over }
}
const list = [
  ms('Colony model', { position: 0, doneOn: '2026-11-01' }),
  ms('Power page', { position: 1, doneOn: '2026-11-06' }),
  ms('Crops goals', { position: 2, doneOn: '2026-11-06', evidence: 'chat', evidenceRef: 'cc-1' }),
  ms('Food screen', { position: 3, status: 'planned', doneOn: null })
]

describe('ReviewBanner', () => {
  const render = (items: Milestone[]): string =>
    renderToStaticMarkup(createElement(ReviewBanner, { items, chatDayOf: () => '2026-11-06', onConfirm: () => {}, onReject: () => {} }))

  it('asks about each chat-backed done milestone, with Confirm and Not a milestone', () => {
    const html = render(reviewItems(list))
    expect(html).toContain('data-review-item="Crops goals"')
    expect(html).not.toContain('Colony model')
    expect(html).toMatch(/Found in your chat of [^<]*Nov[^<]*6[^<]*counted as done/)
    expect(html).toContain('aria-label="Confirm Crops goals"')
    expect(html).toContain('aria-label="Crops goals is not a milestone"')
  })

  it('renders nothing when there is nothing to review', () => {
    expect(render([])).toBe('')
  })
})

describe('DoneSection', () => {
  const range = doneRange(list)
  const done = list.filter((m) => m.status === 'done' && !reviewItems(list).some((r) => r.id === m.id))
  const html = renderToStaticMarkup(createElement(DoneSection, { items: done, from: range.from, to: range.to }))

  it('is collapsed: a details element, closed, with the count and the date range in its summary', () => {
    expect(html).toMatch(/^<details[^>]*data-done/)
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    const summary = html.match(/<summary[^>]*>(.*?)<\/summary>/)![1]!
    expect(summary).toContain('Done · 2 confirmed')
    expect(summary).toMatch(/Nov[^<]*1[^<]*–[^<]*Nov[^<]*6/)
  })

  it('lists every confirmed one inside, and not the one under review', () => {
    expect(html).toContain('Colony model')
    expect(html).toContain('Power page')
    expect(html).not.toContain('Crops goals')
  })

  it('renders nothing with no done milestones', () => {
    expect(renderToStaticMarkup(createElement(DoneSection, { items: [], from: null, to: null }))).toBe('')
  })
})
