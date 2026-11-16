import { describe, expect, it } from 'vitest'
import { projectsToMove, RETURN_AFTER, SUGGEST_AT, suggestRooms, type SuggestChat } from '../src/shared/suggest'

const chat = (area: string | null, over: Partial<SuggestChat> = {}): SuggestChat => ({
  roomId: 'mailroom',
  area,
  areaName: area,
  lastMessageAt: '2026-11-10T12:00:00.000Z',
  ...over
})
const many = (n: number, area: string, over: Partial<SuggestChat> = {}): SuggestChat[] => Array.from({ length: n }, () => chat(area, over))

describe('suggestRooms', () => {
  it('suggests an area once 3 Mail-room chats share it', () => {
    expect(SUGGEST_AT).toBe(3)
    expect(suggestRooms(many(2, 'finance'), [], [], 'mailroom')).toEqual([])
    expect(suggestRooms(many(3, 'finance'), [], [], 'mailroom')).toEqual([
      { area: 'finance', name: 'finance', chats: 3, lastAt: '2026-11-10T12:00:00.000Z' }
    ])
  })

  it('counts only chats in the Mail room, and only tagged ones', () => {
    const chats = [...many(2, 'finance'), chat('finance', { roomId: 'coding' }), ...many(5, null as never)]
    expect(suggestRooms(chats, [], [], 'mailroom')).toEqual([])
  })

  it('leaves out an area that already has a room', () => {
    expect(suggestRooms(many(4, 'software'), ['software'], [], 'mailroom')).toEqual([])
  })

  it('brings a dismissed area back only after 5 more chats', () => {
    expect(RETURN_AFTER).toBe(5)
    const dismissed = [{ area: 'finance', dismissedCount: 3 }]
    expect(suggestRooms(many(7, 'finance'), [], dismissed, 'mailroom')).toEqual([])
    expect(suggestRooms(many(8, 'finance'), [], dismissed, 'mailroom').map((s) => s.chats)).toEqual([8])
  })

  it('names the area by its most common display name', () => {
    const chats = [chat('3d_printing', { areaName: '3D printing' }), chat('3d_printing', { areaName: '3D printing' }), chat('3d_printing', { areaName: '3d prints' })]
    expect(suggestRooms(chats, [], [], 'mailroom')[0]!.name).toBe('3D printing')
  })

  it('puts the busiest area first, then the most recent', () => {
    const chats = [
      ...many(3, 'finance', { lastMessageAt: '2026-11-01T00:00:00.000Z' }),
      ...many(3, 'cooking', { lastMessageAt: '2026-11-09T00:00:00.000Z' }),
      ...many(4, 'software', { lastMessageAt: '2026-10-01T00:00:00.000Z' })
    ]
    expect(suggestRooms(chats, [], [], 'mailroom').map((s) => s.area)).toEqual(['software', 'cooking', 'finance'])
  })
})

describe('projectsToMove', () => {
  const room = (rooms: Record<string, string>) => (chatId: string) => rooms[chatId] ?? null

  it('moves a project when more than half its chats are in the new room', () => {
    const projects = [{ id: 'p1', chatIds: ['a', 'b', 'c'] }]
    expect(projectsToMove(projects, room({ a: 'finance', b: 'finance', c: 'mailroom' }), 'finance')).toEqual(['p1'])
  })

  it('leaves it when only half or fewer moved, or it has no chats', () => {
    const projects = [
      { id: 'p1', chatIds: ['a', 'b'] },
      { id: 'p2', chatIds: [] }
    ]
    expect(projectsToMove(projects, room({ a: 'finance', b: 'mailroom' }), 'finance')).toEqual([])
  })
})
