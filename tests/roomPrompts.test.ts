import { describe, expect, it } from 'vitest'
import {
  buildGroupingPrompt,
  buildMaterializePrompt,
  groupingSchema,
  interpretGrouping,
  interpretMaterialize,
  materializeSchema,
  type RawMaterialize
} from '../src/shared/roomPrompts'
import { catalog } from './helpers'

const answer = (items: RawMaterialize['items']): RawMaterialize => ({
  name: ' Finance ',
  belongs: 'Money, budgets, taxes and loans.',
  not_here: 'Shopping lists.',
  examples: ['Plan my December budget'],
  items
})

describe('interpretMaterialize', () => {
  it('keeps valid picks in order', () => {
    const room = interpretMaterialize(
      answer([
        { item: 'finance_ledger', slot: 'desk_center' },
        { item: 'finance_chart', slot: 'wall_right_b' }
      ]),
      catalog
    )
    expect(room.name).toBe('Finance')
    expect(room.classifier).toEqual({ belongs: 'Money, budgets, taxes and loans.', not_here: 'Shopping lists.', examples: ['Plan my December budget'] })
    expect(room.signature).toEqual([
      { item: 'finance_ledger', slots: ['desk_center'] },
      { item: 'finance_chart', slots: ['wall_right_b'] }
    ])
  })

  it('drops unknown items, slots that do not fit, host slots and repeated slots', () => {
    const room = interpretMaterialize(
      answer([
        { item: 'flux_capacitor', slot: 'corner_right' },
        { item: 'finance_safe', slot: 'wall_right_b' },
        { item: 'finance_safe', slot: 'desk' },
        { item: 'finance_safe', slot: 'nowhere' },
        { item: 'finance_safe', slot: 'corner_right' },
        { item: 'print3d_printer', slot: 'corner_right' }
      ]),
      catalog
    )
    expect(room.signature).toEqual([{ item: 'finance_safe', slots: ['corner_right'] }])
  })

  it('keeps at most five picks', () => {
    const room = interpretMaterialize(
      answer([
        { item: 'finance_ledger', slot: 'desk_center' },
        { item: 'finance_calculator', slot: 'desk_left' },
        { item: 'finance_chart', slot: 'wall_right_b' },
        { item: 'finance_safe', slot: 'corner_right' },
        { item: 'finance_filing_cabinet', slot: 'floor_right' },
        { item: 'print3d_spool_bin', slot: 'beside_seat' }
      ]),
      catalog
    )
    expect(room.signature.map((s) => s.item)).toEqual(['finance_ledger', 'finance_calculator', 'finance_chart', 'finance_safe', 'finance_filing_cabinet'])
  })

  it('returns no signature when nothing is valid, and falls back to the area name', () => {
    const room = interpretMaterialize({ ...answer([{ item: 'nope', slot: 'desk' }]), name: '  ' }, catalog, 'Finance')
    expect(room.signature).toEqual([])
    expect(room.name).toBe('Finance')
  })

  it('rejects an answer missing a field', () => {
    const { items: _i, ...rest } = answer([])
    expect(materializeSchema.safeParse(rest).success).toBe(false)
  })
})

describe('buildMaterializePrompt', () => {
  it('shows the chats and the library items with their areas and slots', () => {
    const prompt = buildMaterializePrompt({
      area: 'finance',
      name: 'Finance',
      chats: [{ title: 'December budget', firstMessage: 'Help me plan my budget' }],
      library: Object.values(catalog.library),
      slots: catalog.rules.layout.slots
    })
    expect(prompt).toContain('December budget')
    expect(prompt).toContain('Help me plan my budget')
    expect(prompt).toContain('finance_ledger')
    expect(prompt).toMatch(/finance_ledger.*finance/)
    expect(prompt).toContain('corner_right')
  })
})

describe('grouping', () => {
  it('lists the known areas and the sessions', () => {
    const prompt = buildGroupingPrompt({
      sessions: [{ id: 's1', title: 'Budget', firstMessage: 'Plan my budget' }],
      knownAreas: [{ key: 'software', name: 'Software' }]
    })
    expect(prompt).toContain('- software — Software')
    expect(prompt).toContain('s1')
    expect(prompt).toContain('Plan my budget')
  })

  it('keeps known sessions once each, with a normalised key', () => {
    const tags = interpretGrouping(
      {
        areas: [
          { key: '3D printing', name: '3D printing', session_ids: ['s1', 'ghost'] },
          { key: 'finance', name: 'Finance', session_ids: ['s1', 's2'] },
          { key: '!!', name: 'Nothing', session_ids: ['s3'] }
        ]
      },
      ['s1', 's2', 's3']
    )
    expect([...tags]).toEqual([
      ['s1', { key: '3d_printing', name: '3D printing' }],
      ['s2', { key: 'finance', name: 'Finance' }]
    ])
  })

  it('rejects an answer missing session ids', () => {
    expect(groupingSchema.safeParse({ areas: [{ key: 'x', name: 'X' }] }).success).toBe(false)
  })
})
