import { describe, expect, it } from 'vitest'
import {
  buildStewardPrompt,
  checkAction,
  checkReply,
  confirmationAnswer,
  guessLanguage,
  needsConfirmation,
  splitActions,
  spokenSummary,
  type StewardContext
} from '../src/shared/steward'

const context: StewardContext = {
  where: 'the palace map',
  rooms: [
    { id: 'coding', name: 'Coding room' },
    { id: 'music', name: 'Music studio' }
  ],
  chats: [
    { id: 'c1', title: 'Fix the sync bug', roomId: 'coding' },
    { id: 'c2', title: 'Letra nueva', roomId: null }
  ],
  projects: [{ id: 'p1', title: 'Sync refactor', roomId: 'coding', state: 'active' }],
  reminders: [{ id: 'r1', projectTitle: 'Sync refactor' }],
  music: { chosen: true, playing: false }
}

describe('the prompt', () => {
  it('names everything the steward may act on, by id', () => {
    const prompt = buildStewardPrompt('  llévame al estudio  ', context)
    for (const piece of ['the palace map', 'Coding room (id coding)', '"Sync refactor" (id p1) in Coding room, active', 'about "Sync refactor" (id r1)', '"Letra nueva" (id c2), not filed yet', 'Music: chosen, not playing', 'The order: llévame al estudio']) {
      expect(prompt).toContain(piece)
    }
  })

  it('says so when a list is empty', () => {
    expect(buildStewardPrompt('hi', { ...context, reminders: [] })).toContain('Reminders waiting:\n- (none)')
  })
})

describe('checkAction', () => {
  it('accepts an action that names real things', () => {
    expect(checkAction({ type: 'go_room', roomId: 'music' }, context)).toEqual({ type: 'go_room', roomId: 'music' })
    expect(checkAction({ type: 'project_action', projectId: 'p1', action: 'done' }, context)).toEqual({ type: 'project_action', projectId: 'p1', action: 'done' })
    expect(checkAction({ type: 'reminder_respond', reminderId: 'r1', response: 'snooze' }, context)).toEqual({ type: 'reminder_respond', reminderId: 'r1', response: 'snooze' })
    expect(checkAction({ type: 'music', op: 'pause' }, context)).toEqual({ type: 'music', op: 'pause' })
    expect(checkAction({ type: 'new_chat', roomId: null, message: '  Plan my week  ' }, context)).toEqual({ type: 'new_chat', roomId: null, message: 'Plan my week' })
    expect(checkAction({ type: 'new_chat' }, context)).toEqual({ type: 'new_chat', roomId: null, message: null })
  })

  it('refuses an invented id, a missing field or an unknown type', () => {
    for (const bad of [
      { type: 'go_room', roomId: 'attic' },
      { type: 'go_room' },
      { type: 'open_chat', chatId: 'c9' },
      { type: 'move_chat', chatId: 'c1', roomId: 'attic' },
      { type: 'delete_chat' },
      { type: 'project_action', projectId: 'p1', action: 'explode' },
      { type: 'project_action', projectId: 'p9', action: 'done' },
      { type: 'reminder_respond', reminderId: 'r1' },
      { type: 'new_chat', roomId: 'attic', message: 'x' },
      { type: 'music', op: 'louderer' },
      { type: 'run_command', command: 'rm -rf ~' },
      null,
      'go_palace'
    ]) {
      expect(checkAction(bad, context)).toBeNull()
    }
  })
})

describe('checkReply', () => {
  it('keeps the good actions, drops the bad ones, and keeps their order', () => {
    const reply = checkReply(
      { language: 'es', say: ' Listo. ', actions: [{ type: 'go_room', roomId: 'music' }, { type: 'open_chat', chatId: 'nope' }, { type: 'music', op: 'play' }] },
      context
    )
    expect(reply).toEqual({ language: 'es', say: 'Listo.', actions: [{ type: 'go_room', roomId: 'music' }, { type: 'music', op: 'play' }] })
  })

  it('survives an answer of the wrong shape', () => {
    expect(checkReply(null, context)).toEqual({ language: 'en', say: '', actions: [] })
    expect(checkReply({ say: '¿Cuál chat?', actions: 'none' }, context)).toEqual({ language: 'es', say: '¿Cuál chat?', actions: [] })
  })
})

describe('what needs a yes', () => {
  it('is only what cannot be undone', () => {
    expect(needsConfirmation({ type: 'delete_chat', chatId: 'c1' })).toBe(true)
    expect(needsConfirmation({ type: 'project_action', projectId: 'p1', action: 'drop' })).toBe(true)
    expect(needsConfirmation({ type: 'project_action', projectId: 'p1', action: 'done' })).toBe(false)
    expect(needsConfirmation({ type: 'move_chat', chatId: 'c1', roomId: 'music' })).toBe(false)
  })

  it('splits a reply into what runs now and what is held', () => {
    const { now, held } = splitActions([{ type: 'go_room', roomId: 'coding' }, { type: 'delete_chat', chatId: 'c1' }, { type: 'music', op: 'pause' }])
    expect(now.map((a) => a.type)).toEqual(['go_room', 'music'])
    expect(held).toEqual([{ type: 'delete_chat', chatId: 'c1' }])
  })
})

describe('confirmationAnswer', () => {
  it('hears a plain yes or no in either language', () => {
    for (const yes of ['yes', 'Yes.', 'sí', 'Si', 'dale', 'go ahead', 'yes do it', 'sí, hazlo', 'Claro!']) expect(confirmationAnswer(yes)).toBe('yes')
    for (const no of ['no', 'No.', 'cancel', 'mejor no', 'no, don\'t', 'cancela', 'no lo hagas']) expect(confirmationAnswer(no)).toBe('no')
  })

  it('never takes a no for a yes', () => {
    expect(confirmationAnswer('no yes')).toBe('no')
    expect(confirmationAnswer('sí no')).toBe('no')
  })

  it('treats anything longer or unclear as a new order', () => {
    expect(confirmationAnswer('yes and also open the music studio please')).toBeNull()
    expect(confirmationAnswer('maybe')).toBeNull()
    expect(confirmationAnswer('')).toBeNull()
    expect(confirmationAnswer('yesterday')).toBeNull()
  })
})

describe('guessLanguage', () => {
  it('tells Spanish from English by its words and marks', () => {
    expect(guessLanguage('Abre el cuarto de música')).toBe('es')
    expect(guessLanguage('llevame al cuarto de codigo')).toBe('es')
    expect(guessLanguage('Open the music studio')).toBe('en')
    expect(guessLanguage('¿Listo?')).toBe('es')
    expect(guessLanguage('')).toBe('en')
  })
})

describe('spokenSummary', () => {
  it('reads plain words only: no markdown, no code', () => {
    expect(spokenSummary('## Plan\n\n- **First**, open `main.ts`.\n- Then see [the docs](https://example.com).\n\n```js\nconst a = 1\n```')).toBe('Plan First, open main.ts. Then see the docs.')
  })

  it('stops at the end of a sentence when the answer is long', () => {
    const long = `${'This is a sentence. '.repeat(30)}`
    const out = spokenSummary(long, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out.endsWith('.')).toBe(true)
  })
})
