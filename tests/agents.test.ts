import { describe, expect, it } from 'vitest'
import { ACTIVITY_LIMIT, addActivity, agentState, ago, bubbleTail, chatChanges, roomAgents, type ActivityItem } from '../src/shared/agents'

const rooms = ['coding', 'music', 'art', 'mailroom']
const chats = [
  { id: 'c1', roomId: 'coding' },
  { id: 'c2', roomId: 'coding' },
  { id: 'c3', roomId: null },
  { id: 'c4', roomId: 'gone' }
]

describe('agentState', () => {
  it('follows the answer: idle, thinking, searching, writing', () => {
    expect(agentState(undefined)).toBe('idle')
    expect(agentState({ text: '', searching: null })).toBe('thinking')
    expect(agentState({ text: 'Half an answer', searching: 'weather' })).toBe('searching')
    expect(agentState({ text: 'Half an answer', searching: null })).toBe('writing')
  })
})

describe('bubbleTail', () => {
  it('keeps a short answer whole, without markdown marks', () => {
    expect(bubbleTail('**Yes.** Use `map` and see [the docs](https://example.com).')).toBe('Yes. Use map and see the docs.')
  })

  it('shows the end of a long answer, cut at a word', () => {
    const tail = bubbleTail(`${'word '.repeat(60)}and the very last words`, 40)
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.endsWith('and the very last words')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(41)
    expect(tail).not.toMatch(/^…ord/) // not cut mid-word
  })

  it('does not read code aloud', () => {
    expect(bubbleTail('Try this:\n```js\nconst a = 1\n```\nThat is all.')).toBe('Try this: (code) That is all.')
    expect(bubbleTail('Try this:\n```js\nconst a = 1')).toBe('Try this: (code)')
  })
})

describe('roomAgents', () => {
  it('every room has a helper, idle when nothing is happening', () => {
    const agents = roomAgents(chats, {}, rooms)
    expect(Object.keys(agents).sort()).toEqual([...rooms].sort())
    expect(agents.coding).toEqual({ state: 'idle', chatId: null, bubble: '' })
  })

  it('the helper of the chat\'s room is the busy one, with what it is saying', () => {
    const agents = roomAgents(chats, { c1: { text: 'Here is **the fix**', searching: null } }, rooms)
    expect(agents.coding).toEqual({ state: 'writing', chatId: 'c1', bubble: 'Here is the fix' })
    expect(agents.music!.state).toBe('idle')
  })

  it('a chat with no room, or an unknown one, is handled in the sorting room', () => {
    expect(roomAgents(chats, { c3: { text: '', searching: null } }, rooms).mailroom).toEqual({ state: 'thinking', chatId: 'c3', bubble: 'Thinking…' })
    expect(roomAgents(chats, { c4: { text: '', searching: 'tides' } }, rooms).mailroom).toEqual({ state: 'searching', chatId: 'c4', bubble: 'Searching: tides' })
    expect(roomAgents(chats, { unknown: { text: 'x', searching: null } }, rooms).mailroom!.state).toBe('writing')
  })

  it('with two answers in one room, the one furthest along shows', () => {
    const agents = roomAgents(chats, { c1: { text: '', searching: null }, c2: { text: 'Writing now', searching: null } }, rooms)
    expect(agents.coding).toMatchObject({ state: 'writing', chatId: 'c2' })
  })

  it('a room whose answer just ended says done, until something new starts there', () => {
    expect(roomAgents(chats, {}, rooms, { coding: 'c1' }).coding).toEqual({ state: 'done', chatId: 'c1', bubble: 'Done' })
    expect(roomAgents(chats, { c2: { text: '', searching: null } }, rooms, { coding: 'c1' }).coding).toMatchObject({ state: 'thinking', chatId: 'c2' })
  })
})

describe('the activity log', () => {
  const item = (text: string, chatId = 'c1'): Omit<ActivityItem, 'id'> => ({ at: '2026-11-15T12:00:00.000Z', kind: 'answered', text, chatId, roomId: 'coding' })

  it('is newest first with rising ids, and drops an immediate repeat', () => {
    let log = addActivity([], item('one'))
    log = addActivity(log, item('two'))
    log = addActivity(log, item('two'))
    expect(log.map((a) => [a.id, a.text])).toEqual([[2, 'two'], [1, 'one']])
  })

  it('is capped', () => {
    let log: ActivityItem[] = []
    for (let i = 0; i < ACTIVITY_LIMIT + 5; i++) log = addActivity(log, item(`n${i}`))
    expect(log).toHaveLength(ACTIVITY_LIMIT)
    expect(log[0]!.text).toBe(`n${ACTIVITY_LIMIT + 4}`)
  })
})

describe('chatChanges', () => {
  const name = (id: string) => ({ coding: 'Coding room', music: 'Music studio' })[id]
  const chat = { title: 'Fix the sync bug', roomId: 'coding', roomSource: 'model' as const, project: null, suggestion: null }

  it('reports a chat being filed, and where the scroll should travel', () => {
    expect(chatChanges({ roomId: null, project: null, suggestion: null }, chat, name)).toEqual([
      { kind: 'filed', text: '“Fix the sync bug” was filed in the Coding room', movedTo: 'coding' }
    ])
  })

  it('says so when the person moved it', () => {
    const moved = chatChanges({ roomId: 'coding', project: null, suggestion: null }, { ...chat, roomId: 'music', roomSource: 'user' }, name)
    expect(moved[0]!.text).toBe('You moved “Fix the sync bug” to the Music studio')
  })

  it('reports a project suggestion once, and a tracked project', () => {
    const suggested = { ...chat, suggestion: { title: 'Sync refactor' } }
    const before = { roomId: 'coding', project: null, suggestion: null }
    expect(chatChanges(before, suggested, name)).toEqual([{ kind: 'project', text: '“Fix the sync bug” looks like a project: Sync refactor' }])
    expect(chatChanges({ ...before, suggestion: { title: 'Sync refactor' } }, suggested, name)).toEqual([])
    expect(chatChanges(before, { ...chat, project: { title: 'Sync refactor' } }, name)[0]!.text).toBe('“Fix the sync bug” is now part of the project Sync refactor')
  })

  it('says nothing when nothing changed, the chat is gone, or the room is unknown', () => {
    expect(chatChanges({ roomId: 'coding', project: null, suggestion: null }, chat, name)).toEqual([])
    expect(chatChanges(undefined, undefined, name)).toEqual([])
    expect(chatChanges(undefined, { ...chat, roomId: 'attic' }, name)).toEqual([])
  })
})

describe('ago', () => {
  it('reads as people say it', () => {
    const now = '2026-11-15T12:00:00.000Z'
    expect(ago('2026-11-15T11:59:40.000Z', now)).toBe('just now')
    expect(ago('2026-11-15T11:57:00.000Z', now)).toBe('3 min ago')
    expect(ago('2026-11-15T10:00:00.000Z', now)).toBe('2 h ago')
    expect(ago('2026-11-13T10:00:00.000Z', now)).toBe('2026-11-13')
    expect(ago('2026-11-15T12:00:05.000Z', now)).toBe('just now') // a clock that is slightly ahead
  })
})
