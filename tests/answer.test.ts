import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Answer } from '../src/renderer/src/components/Answer'

const render = (text: string): string => renderToStaticMarkup(createElement(Answer, { text }))

describe('Answer markdown', () => {
  it('renders a GitHub-style table as a real table', () => {
    const html = render('| | Resin | FDM |\n|---|---|---|\n| **Entry printer** | $150 | $200 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Resin</th>')
    expect(html).toContain('<td><strong>Entry printer</strong></td>')
    expect(html).not.toContain('|---|')
  })

  it('wraps a table so a wide one scrolls inside the bubble', () => {
    expect(render('| a | b |\n|---|---|\n| 1 | 2 |')).toMatch(/<div class="table-scroll"><table>/)
  })

  it('opens links in the browser, including bare URLs', () => {
    const html = render('See https://example.com for more.')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">')
  })

  it('renders strikethrough', () => {
    expect(render('~~old~~ new')).toContain('<del>old</del>')
  })
})
