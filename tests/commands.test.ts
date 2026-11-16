import { describe, expect, it } from 'vitest'
import { allCommands, normalise, searchCommands, type CommandData } from '../src/shared/commands'

const data: CommandData = {
  rooms: [
    { id: 'coding', name: 'Coding room' },
    { id: 'music', name: 'Music studio' }
  ],
  chats: [
    { id: 'c1', title: 'Fix the sync bug', roomId: 'coding', lastMessageAt: '2026-11-10T10:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 'c2', title: 'Letra para la canción nueva', roomId: 'music', lastMessageAt: '2026-11-12T10:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' },
    { id: 'c3', title: 'Resync the calendar', roomId: null, lastMessageAt: null, createdAt: '2026-11-11T00:00:00.000Z' },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `old${i}`,
      title: `Old chat ${i}`,
      roomId: 'coding',
      lastMessageAt: `2026-10-0${i + 1}T00:00:00.000Z`,
      createdAt: '2026-10-01T00:00:00.000Z'
    }))
  ],
  projects: [
    { id: 'p1', title: 'Sync module refactor', roomId: 'coding', state: 'active', chatIds: ['c1'] },
    { id: 'p2', title: 'EP mix', roomId: 'music', state: 'paused', chatIds: [] },
    { id: 'p3', title: 'Sync old thing', roomId: 'coding', state: 'done', chatIds: ['c1'] }
  ]
}
const titles = (query: string, limit?: number) => searchCommands(query, data, limit).map((c) => c.title)

describe('the command bar search', () => {
  it('ignores case and accents', () => {
    expect(normalise('Canción ÑU')).toBe('cancion nu')
    expect(titles('cancion')).toEqual(['Letra para la canción nueva'])
  })

  it('with nothing typed offers the actions, the rooms and the five most recent chats', () => {
    const list = searchCommands('', data, 50)
    expect(list.filter((c) => c.kind === 'action').map((c) => c.title)).toEqual(['New chat', 'Palace', 'Projects', 'Reminders'])
    expect(list.filter((c) => c.kind === 'room').map((c) => c.title)).toEqual(['Coding room', 'Music studio'])
    expect(list.filter((c) => c.kind === 'chat').map((c) => c.id)).toEqual(['chat:c2', 'chat:c3', 'chat:c1', 'chat:old5', 'chat:old4'])
    expect(list.some((c) => c.kind === 'project')).toBe(false)
  })

  it('puts a title that starts with the word before one that merely contains it', () => {
    const list = titles('sync')
    expect(list[0]).toBe('Sync module refactor')
    expect(list.indexOf('Fix the sync bug')).toBeLessThan(list.indexOf('Resync the calendar'))
  })

  it('needs every word, in the title or the hint', () => {
    expect(titles('sync bug')).toEqual(['Fix the sync bug'])
    expect(titles('letra music')).toEqual(['Letra para la canción nueva']) // "music" is the room, in the hint
    expect(titles('sync zebra')).toEqual([])
  })

  it('finds rooms and offers a chat filed there', () => {
    const list = searchCommands('music', data)
    expect(list[0]).toMatchObject({ title: 'Music studio', target: { type: 'room', roomId: 'music' } })
    expect(list).toContainEqual(expect.objectContaining({ target: { type: 'chat-in', roomId: 'music' } }))
  })

  it('lists only open projects; one opens its latest chat, or the projects view when it has none', () => {
    const projects = allCommands(data).filter((c) => c.kind === 'project')
    expect(projects.map((c) => c.title)).toEqual(['Sync module refactor', 'EP mix'])
    expect(projects[0]!.target).toEqual({ type: 'chat', chatId: 'c1' })
    expect(projects[1]).toMatchObject({ hint: 'Paused project · Music studio', target: { type: 'projects' } })
  })

  it('respects the limit', () => {
    expect(searchCommands('chat', data, 3)).toHaveLength(3)
  })
})
