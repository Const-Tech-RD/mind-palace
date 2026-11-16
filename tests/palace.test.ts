import { describe, expect, it } from 'vitest'
import {
  buildClassifierPrompt,
  dueForQuietCheck,
  interpretClassification,
  roomChange,
  type ClassifierMessage,
  type ClassifierRoom,
  type OpenProject,
  type RawClassification
} from '../src/shared/classify'
import { parseEvalLine, scoreEval, type EvalOutcome } from '../src/shared/evalMetrics'
import { ACTIONS_BY_STATE, applyProjectAction, type ProjectState, type ProjectSummary } from '../src/shared/projects'
import type { JsonAnswer } from '../src/main/chat/claude'
import { createClassifier } from '../src/main/palace/classifier'
import { createProjectService } from '../src/main/palace/projects'
import type { ChatClassificationRow, PalaceRepo } from '../src/main/palace/repo'
import { catalog } from './helpers'

const rooms: ClassifierRoom[] = Object.values(catalog.rooms).map(({ id, name, belongs, not_here, examples }) => ({
  id,
  name,
  belongs,
  not_here,
  examples
}))
const roomIds = rooms.map((r) => r.id)
const fallbackRoomId = catalog.rules.classification.fallback_room

const raw = (over: Partial<RawClassification> = {}): RawClassification => ({
  room_id: 'coding',
  confidence: 0.9,
  is_project: false,
  project_title: null,
  next_step: null,
  existing_project_id: null,
  ...over
})

describe('buildClassifierPrompt', () => {
  const prompt = buildClassifierPrompt({
    rooms,
    fallbackRoomId,
    messages: [
      { role: 'user', content: 'Why does my effect run twice?' },
      { role: 'assistant', content: 'Strict mode.' },
      { role: 'system', content: 'hidden' }
    ],
    openProjects: [{ id: 'p1', title: 'Pantry app', roomId: 'coding' }]
  })

  it('carries every room with its catalog text, so editing the catalog changes the classifier', () => {
    for (const room of rooms) {
      expect(prompt).toContain(`### ${room.id} — ${room.name}`)
      expect(prompt).toContain(room.belongs)
      for (const example of room.examples) expect(prompt).toContain(`- ${example}`)
    }
    expect(prompt).toContain(catalog.rooms['coding']!.not_here)
    // The Mail room has no "not here" text; no empty line is printed for it.
    expect(prompt).not.toContain('Not here: \n')
  })

  it('names the fallback room, lists open projects with ids, and shows the chat without system messages', () => {
    expect(prompt).toContain(`use "${fallbackRoomId}"`)
    expect(prompt).toContain('- id "p1" · room coding · Pantry app')
    expect(prompt).toContain('USER: Why does my effect run twice?')
    expect(prompt).toContain('ASSISTANT: Strict mode.')
    expect(prompt).not.toContain('hidden')
  })

  it('says "None." when there are no open projects and clips very long messages', () => {
    const long = buildClassifierPrompt({ rooms, fallbackRoomId, messages: [{ role: 'user', content: 'x'.repeat(5000) }], openProjects: [] })
    expect(long).toContain('## Open projects\n\nNone.')
    expect(long).toContain(`${'x'.repeat(2000)} […]`)
    expect(long).not.toContain('x'.repeat(2001))
  })
})

describe('interpretClassification', () => {
  const ctx = { roomIds, fallbackRoomId, openProjects: [{ id: 'p1', title: 'Pantry app', roomId: 'coding' }] as OpenProject[] }

  it('keeps a confident pick of a known room', () => {
    expect(interpretClassification(raw({ room_id: 'music', confidence: 0.6 }), ctx)).toMatchObject({ roomId: 'music', fellBack: false })
  })

  it('sends a pick below 0.6, or an unknown room, to the Mail room', () => {
    expect(interpretClassification(raw({ room_id: 'music', confidence: 0.59 }), ctx)).toMatchObject({ roomId: 'mailroom', fellBack: true })
    expect(interpretClassification(raw({ room_id: 'kitchen', confidence: 0.99 }), ctx)).toMatchObject({ roomId: 'mailroom', fellBack: true })
  })

  it('suggests a new project only with a title', () => {
    expect(interpretClassification(raw({ is_project: true, project_title: ' Pantry app ', next_step: ' Sketch the schema ' }), ctx).project).toEqual({
      kind: 'new',
      title: 'Pantry app',
      nextStep: 'Sketch the schema'
    })
    expect(interpretClassification(raw({ is_project: true, project_title: '  ' }), ctx).project).toEqual({ kind: 'none' })
    expect(interpretClassification(raw({ is_project: false, project_title: 'Ignored' }), ctx).project).toEqual({ kind: 'none' })
  })

  it('recognises an open project only when it exists and is in the chosen room', () => {
    expect(interpretClassification(raw({ is_project: true, project_title: 'Pantry', existing_project_id: 'p1' }), ctx).project).toEqual({
      kind: 'existing',
      projectId: 'p1'
    })
    // An invented id falls back to a new suggestion.
    expect(interpretClassification(raw({ is_project: true, project_title: 'Pantry', existing_project_id: 'nope' }), ctx).project).toMatchObject({ kind: 'new' })
    // A real project in another room is not reused.
    expect(
      interpretClassification(raw({ room_id: 'music', is_project: true, project_title: 'Pantry', existing_project_id: 'p1' }), ctx).project
    ).toMatchObject({ kind: 'new' })
  })
})

describe('roomChange', () => {
  const confident = interpretClassification(raw({ room_id: 'music' }), { roomIds, fallbackRoomId, openProjects: [] })
  const unsure = interpretClassification(raw({ room_id: 'music', confidence: 0.3 }), { roomIds, fallbackRoomId, openProjects: [] })

  it('places an unclassified chat, in the Mail room when unsure', () => {
    expect(roomChange({ roomId: null, roomSource: null }, confident)).toBe('music')
    expect(roomChange({ roomId: null, roomSource: null }, unsure)).toBe('mailroom')
  })

  it('moves a classified chat only on a confident, different answer', () => {
    expect(roomChange({ roomId: 'coding', roomSource: 'model' }, confident)).toBe('music')
    expect(roomChange({ roomId: 'music', roomSource: 'model' }, confident)).toBeNull()
    expect(roomChange({ roomId: 'coding', roomSource: 'model' }, unsure)).toBeNull()
  })

  it('never moves a chat the user placed', () => {
    expect(roomChange({ roomId: 'coding', roomSource: 'user' }, confident)).toBeNull()
  })
})

describe('dueForQuietCheck', () => {
  const now = new Date('2026-11-15T12:00:00.000Z')
  it.each([
    ['no messages', null, null, false],
    ['quiet 29 minutes', '2026-11-15T11:31:00.000Z', null, false],
    ['quiet 30 minutes, never classified', '2026-11-15T11:30:00.000Z', null, true],
    ['quiet, classified before the last message', '2026-11-15T10:00:00.000Z', '2026-11-15T09:00:00.000Z', true],
    ['quiet, already classified since', '2026-11-15T10:00:00.000Z', '2026-11-15T10:45:00.000Z', false]
  ])('%s', (_name, lastMessageAt, classifiedAt, expected) => {
    expect(dueForQuietCheck({ lastMessageAt, classifiedAt }, now)).toBe(expected)
  })
})

describe('applyProjectAction', () => {
  const now = new Date('2026-11-15T12:00:00.000Z')

  it('done closes the project and adds a completion', () => {
    expect(applyProjectAction('active', 'done', now)).toEqual({ state: 'done', closedAt: now.toISOString(), snoozedUntil: null, completion: 'add' })
  })

  it('snooze keeps it active for two weeks', () => {
    expect(applyProjectAction('active', 'snooze', now)).toEqual({ state: 'active', snoozedUntil: '2026-11-29T12:00:00.000Z', completion: 'none' })
  })

  it('reopen removes the completion only when the project was done', () => {
    expect(applyProjectAction('done', 'reopen', now)).toMatchObject({ state: 'active', closedAt: null, completion: 'remove' })
    expect(applyProjectAction('dropped', 'reopen', now)).toMatchObject({ state: 'active', closedAt: null, completion: 'none' })
    expect(applyProjectAction('paused', 'reopen', now)).toMatchObject({ state: 'active', completion: 'none' })
  })

  it('pause and drop', () => {
    expect(applyProjectAction('active', 'pause', now)).toMatchObject({ state: 'paused', completion: 'none' })
    expect(applyProjectAction('paused', 'drop', now)).toMatchObject({ state: 'dropped', closedAt: now.toISOString(), completion: 'none' })
  })

  it('refuses every action the state does not offer', () => {
    const all = ['done', 'snooze', 'pause', 'drop', 'reopen'] as const
    for (const state of Object.keys(ACTIONS_BY_STATE) as ProjectState[]) {
      for (const action of all) {
        if (ACTIONS_BY_STATE[state].includes(action)) expect(() => applyProjectAction(state, action, now)).not.toThrow()
        else expect(() => applyProjectAction(state, action, now)).toThrow()
      }
    }
  })
})

describe('eval scoring', () => {
  const outcome = (room: string, isProject: boolean, gotRoom: string | null, gotProject = false): EvalOutcome => ({
    file: 'eval/x.jsonl',
    line: 1,
    expected: { messages: ['m'], room_id: room, is_project: isProject },
    got: gotRoom === null ? null : { roomId: gotRoom, isProject: gotProject, confidence: 0.9 },
    ...(gotRoom === null ? { error: 'boom' } : {})
  })

  it('computes accuracy, precision and recall, and lists the misses', () => {
    const score = scoreEval([
      outcome('coding', true, 'coding', true), // right room, true positive
      outcome('coding', false, 'coding', true), // right room, false positive
      outcome('music', true, 'art', false), // wrong room, missed project
      outcome('art', false, 'art', false), // all right
      outcome('mailroom', false, null) // failed call
    ])
    expect(score.total).toBe(5)
    expect(score.failedCalls).toBe(1)
    expect(score.roomAccuracy).toBeCloseTo(3 / 5)
    expect(score.projectPrecision).toBeCloseTo(1 / 2)
    expect(score.projectRecall).toBeCloseTo(1 / 2)
    expect(score.wrongRoom).toHaveLength(2)
    expect(score.wrongProject).toHaveLength(2)
  })

  it('reports n/a (null) when nothing was flagged or nothing was a project', () => {
    const score = scoreEval([outcome('art', false, 'art', false)])
    expect(score.projectPrecision).toBeNull()
    expect(score.projectRecall).toBeNull()
    expect(scoreEval([]).roomAccuracy).toBe(0)
  })

  it('parses a line and rejects malformed ones', () => {
    expect(parseEvalLine('{"messages":["a","b"],"room_id":"coding","is_project":true}')).toEqual({
      messages: ['a', 'b'],
      room_id: 'coding',
      is_project: true
    })
    expect(() => parseEvalLine('{"messages":[],"room_id":"coding","is_project":true}')).toThrow('messages')
    expect(() => parseEvalLine('{"messages":["a"],"room_id":"coding","is_project":"yes"}')).toThrow('is_project')
    expect(() => parseEvalLine('{"messages":["a"],"is_project":true}')).toThrow('room_id')
  })
})

/** In-memory stand-in for the SQLite palace repo. */
function memoryPalace() {
  const chats = new Map<string, ChatClassificationRow>()
  const projects = new Map<string, ProjectSummary & { originChatId: string | null }>()
  const completions: Array<{ projectId: string; roomId: string; localDay: string }> = []
  let n = 0
  const repo: PalaceRepo = {
    chat: (id) => (chats.has(id) ? { ...chats.get(id)! } : undefined),
    chatsWithMessages: () => [...chats.values()].filter((c) => c.lastMessageAt !== null).map((c) => ({ ...c })),
    setRoom(id, roomId, source) {
      Object.assign(chats.get(id)!, { roomId, roomSource: source })
    },
    markClassified(id, at) {
      chats.get(id)!.classifiedAt = at
    },
    setSuggestion(id, projectId) {
      chats.get(id)!.suggestedProjectId = projectId
    },
    dismissSuggestion(id, at) {
      Object.assign(chats.get(id)!, { suggestedProjectId: null, projectDismissedAt: at })
    },
    hasTrackedProject: (chatId) => [...projects.values()].some((p) => p.state !== 'suggested' && p.chatIds.includes(chatId)),
    openProjects: () =>
      [...projects.values()].filter((p) => p.state === 'active' || p.state === 'paused').map(({ id, title, roomId }) => ({ id, title, roomId })),
    project: (id) => {
      const p = projects.get(id)
      if (!p) return undefined
      const { originChatId: _o, ...summary } = p
      return { ...summary, chatIds: [...summary.chatIds] }
    },
    projects: () => [...projects.values()].map(({ originChatId: _o, ...summary }) => summary),
    createSuggested(input) {
      const id = `project-${++n}`
      projects.set(id, {
        id,
        title: input.title,
        roomId: input.roomId,
        state: 'suggested',
        nextStep: input.nextStep,
        lastActivityAt: null,
        snoozedUntil: null,
        createdAt: input.at,
        closedAt: null,
        chatIds: [],
        originChatId: input.originChatId
      })
      return id
    },
    originChatOf: (id) => projects.get(id)?.originChatId ?? null,
    linkChat(projectId, chatId) {
      const p = projects.get(projectId)!
      if (!p.chatIds.includes(chatId)) p.chatIds.push(chatId)
    },
    updateProject(id, change) {
      Object.assign(projects.get(id)!, change)
    },
    deleteProject(id) {
      projects.delete(id)
    },
    touchProjectsOfChat(chatId, at) {
      const linked = [...projects.values()].filter((p) => p.chatIds.includes(chatId))
      for (const p of linked) p.lastActivityAt = at
      return linked.map((p) => p.id)
    },
    addCompletion(input) {
      completions.push({ ...input })
    },
    removeCompletions(projectId) {
      for (let i = completions.length - 1; i >= 0; i--) if (completions[i]!.projectId === projectId) completions.splice(i, 1)
    },
    transaction: (run) => run()
  }
  const addChat = (id: string, over: Partial<ChatClassificationRow> = {}): void => {
    chats.set(id, {
      id,
      roomId: null,
      roomSource: null,
      classifiedAt: null,
      lastMessageAt: '2026-11-15T11:00:00.000Z',
      suggestedProjectId: null,
      projectDismissedAt: null,
      ...over
    })
  }
  return { repo, chats, projects, completions, addChat }
}

function classifierHarness(answers: Array<Partial<RawClassification> | { fail: string }>) {
  const palace = memoryPalace()
  const transcripts = new Map<string, ClassifierMessage[]>()
  const prompts: string[] = []
  const changed: string[] = []
  let clock = new Date('2026-11-15T12:00:00.000Z')
  const classifier = createClassifier({
    repo: palace.repo,
    rooms: () => rooms,
    fallbackRoomId,
    messagesOf: (chatId) => transcripts.get(chatId) ?? [],
    askModel: async (prompt): Promise<JsonAnswer> => {
      prompts.push(prompt)
      const next = answers.shift()
      if (!next) throw new Error('no scripted answer left')
      if ('fail' in next) return { ok: false, error: next.fail }
      return { ok: true, value: raw(next), tokensIn: 10, tokensOut: 5 }
    },
    onChanged: (chatId) => changed.push(chatId),
    now: () => clock
  })
  const chat = (id: string, over: Partial<ChatClassificationRow> = {}, messages: string[] = ['one', 'two']): void => {
    palace.addChat(id, over)
    transcripts.set(id, messages.map((content) => ({ role: 'user' as const, content })))
  }
  return { ...palace, classifier, prompts, changed, chat, setNow: (iso: string) => (clock = new Date(iso)) }
}

describe('classifier', () => {
  it('places the chat, stamps it, and tells the renderer', async () => {
    const h = classifierHarness([{ room_id: 'music' }])
    h.chat('c1')
    expect(await h.classifier.classify('c1')).toBe('done')
    expect(h.chats.get('c1')).toMatchObject({ roomId: 'music', roomSource: 'model', classifiedAt: '2026-11-15T12:00:00.000Z' })
    expect(h.changed).toEqual(['c1'])
    expect(h.prompts[0]).toContain('USER: one')
  })

  it('runs for the first time after the second user message, and only then', async () => {
    const h = classifierHarness([{ room_id: 'art' }])
    h.chat('c1')
    h.classifier.afterUserMessage('c1', 1)
    h.classifier.afterUserMessage('c1', 3)
    await Promise.resolve()
    expect(h.prompts).toHaveLength(0)
    h.classifier.afterUserMessage('c1', 2)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.chats.get('c1')!.roomId).toBe('art')
  })

  it('an unsure first answer goes to the Mail room; an unsure later answer changes nothing', async () => {
    const h = classifierHarness([{ room_id: 'music', confidence: 0.4 }, { room_id: 'art', confidence: 0.4 }])
    h.chat('c1')
    await h.classifier.classify('c1')
    expect(h.chats.get('c1')!.roomId).toBe('mailroom')
    await h.classifier.classify('c1')
    expect(h.chats.get('c1')!.roomId).toBe('mailroom')
  })

  it('never moves a chat the user placed, but still stamps it', async () => {
    const h = classifierHarness([{ room_id: 'music' }])
    h.chat('c1', { roomId: 'coding', roomSource: 'user' })
    await h.classifier.classify('c1')
    expect(h.chats.get('c1')).toMatchObject({ roomId: 'coding', roomSource: 'user', classifiedAt: '2026-11-15T12:00:00.000Z' })
  })

  it('offers a new project in the chat room, once', async () => {
    const h = classifierHarness([
      { room_id: 'coding', is_project: true, project_title: 'Pantry app', next_step: 'Sketch the schema' },
      { room_id: 'coding', is_project: true, project_title: 'Pantry app again' }
    ])
    h.chat('c1')
    await h.classifier.classify('c1')
    const projectId = h.chats.get('c1')!.suggestedProjectId!
    expect(h.projects.get(projectId)).toMatchObject({ title: 'Pantry app', roomId: 'coding', state: 'suggested', nextStep: 'Sketch the schema', originChatId: 'c1' })
    await h.classifier.classify('c1')
    expect(h.projects.size).toBe(1)
  })

  it('offers an open project it recognises instead of making a duplicate, and is told about it', async () => {
    const h = classifierHarness([{ room_id: 'coding', is_project: true, project_title: 'Pantry', existing_project_id: 'p-open' }])
    h.projects.set('p-open', {
      id: 'p-open', title: 'Pantry app', roomId: 'coding', state: 'active', nextStep: null, lastActivityAt: null,
      snoozedUntil: null, createdAt: '2026-11-01T00:00:00.000Z', closedAt: null, chatIds: ['other'], originChatId: 'other'
    })
    h.chat('c1')
    await h.classifier.classify('c1')
    expect(h.prompts[0]).toContain('- id "p-open" · room coding · Pantry app')
    expect(h.chats.get('c1')!.suggestedProjectId).toBe('p-open')
    expect(h.projects.size).toBe(1)
  })

  it('offers nothing to a chat that said "Just a question" or is already in a project', async () => {
    const h = classifierHarness([
      { is_project: true, project_title: 'A' },
      { is_project: true, project_title: 'B' }
    ])
    h.chat('dismissed', { projectDismissedAt: '2026-11-10T00:00:00.000Z' })
    h.chat('tracked')
    h.projects.set('p1', {
      id: 'p1', title: 'Existing', roomId: 'coding', state: 'active', nextStep: null, lastActivityAt: null,
      snoozedUntil: null, createdAt: '2026-11-01T00:00:00.000Z', closedAt: null, chatIds: ['tracked'], originChatId: 'tracked'
    })
    await h.classifier.classify('dismissed')
    await h.classifier.classify('tracked')
    expect(h.chats.get('dismissed')!.suggestedProjectId).toBeNull()
    expect(h.chats.get('tracked')!.suggestedProjectId).toBeNull()
    expect(h.projects.size).toBe(1)
  })

  it('a failed call leaves the chat untouched and is not retried for 30 minutes', async () => {
    const h = classifierHarness([{ fail: 'rate limited' }, { room_id: 'music' }])
    h.chat('c1')
    expect(await h.classifier.runQuietChecks()).toBe(0)
    expect(h.chats.get('c1')).toMatchObject({ roomId: null, classifiedAt: null })
    h.setNow('2026-11-15T12:20:00.000Z')
    expect(await h.classifier.runQuietChecks()).toBe(0)
    expect(h.prompts).toHaveLength(1)
    h.setNow('2026-11-15T12:31:00.000Z')
    expect(await h.classifier.runQuietChecks()).toBe(1)
    expect(h.chats.get('c1')!.roomId).toBe('music')
  })

  it('the quiet check classifies each quiet chat once per quiet period', async () => {
    const h = classifierHarness([{ room_id: 'coding' }, { room_id: 'music' }, { room_id: 'art' }])
    h.chat('quiet', { lastMessageAt: '2026-11-15T11:00:00.000Z' })
    h.chat('busy', { lastMessageAt: '2026-11-15T11:50:00.000Z' })
    expect(await h.classifier.runQuietChecks()).toBe(1)
    expect(await h.classifier.runQuietChecks()).toBe(0)
    expect(h.chats.get('busy')!.roomId).toBeNull()
    // A new message later makes it due again, and the confident answer moves it.
    // By then the other chat has gone quiet too and gets its first classification.
    h.chats.get('quiet')!.lastMessageAt = '2026-11-15T13:00:00.000Z'
    h.setNow('2026-11-15T13:30:00.000Z')
    expect(await h.classifier.runQuietChecks()).toBe(2)
    expect(h.chats.get('quiet')!.roomId).toBe('music')
    expect(h.chats.get('busy')!.roomId).toBe('art')
  })

  it('skips a chat with no user message and one that no longer exists', async () => {
    const h = classifierHarness([])
    h.chat('empty', {}, [])
    expect(await h.classifier.classify('empty')).toBe('skipped')
    expect(await h.classifier.classify('gone')).toBe('skipped')
  })
})

describe('project service', () => {
  function harness(timeZone = 'America/Santo_Domingo') {
    const palace = memoryPalace()
    const changed: string[] = []
    let clock = new Date('2026-11-15T16:00:00.000Z')
    const service = createProjectService({
      repo: palace.repo,
      roomIds: () => roomIds,
      timeZone: () => timeZone,
      onChanged: (chatId) => changed.push(chatId),
      now: () => clock
    })
    const suggest = (chatId: string, title: string, roomId = 'coding'): string => {
      palace.addChat(chatId, { roomId, roomSource: 'model' })
      const id = palace.repo.createSuggested({ title, roomId, originChatId: chatId, nextStep: 'Start', at: clock.toISOString() })
      palace.repo.setSuggestion(chatId, id)
      return id
    }
    return { ...palace, service, changed, suggest, setNow: (iso: string) => (clock = new Date(iso)) }
  }

  it('Track turns the suggestion into an active project linked to the chat', () => {
    const h = harness()
    const id = h.suggest('c1', 'Pantry app')
    expect(h.service.list()).toEqual([])
    expect(h.service.track('c1')).toEqual({ projectId: id })
    expect(h.service.list()).toMatchObject([{ id, state: 'active', chatIds: ['c1'], lastActivityAt: '2026-11-15T11:00:00.000Z' }])
    expect(h.chats.get('c1')!.suggestedProjectId).toBeNull()
    expect(h.changed).toEqual(['c1'])
    expect(() => h.service.track('c1')).toThrow('no project suggestion')
  })

  it('Track on a recognised project adds the chat without changing its state', () => {
    const h = harness()
    const id = h.suggest('c1', 'Pantry app')
    h.service.track('c1')
    h.service.act(id, 'pause')
    h.addChat('c2', { roomId: 'coding', suggestedProjectId: id })
    h.service.track('c2')
    expect(h.projects.get(id)).toMatchObject({ state: 'paused', chatIds: ['c1', 'c2'] })
  })

  it('"Just a question" removes the suggested project and marks the chat', () => {
    const h = harness()
    h.suggest('c1', 'Pantry app')
    h.service.dismiss('c1')
    expect(h.projects.size).toBe(0)
    expect(h.chats.get('c1')).toMatchObject({ suggestedProjectId: null, projectDismissedAt: '2026-11-15T16:00:00.000Z' })
  })

  it('"Just a question" on a recognised project keeps that project', () => {
    const h = harness()
    const id = h.suggest('c1', 'Pantry app')
    h.service.track('c1')
    h.addChat('c2', { suggestedProjectId: id })
    h.service.dismiss('c2')
    expect(h.projects.has(id)).toBe(true)
    expect(h.chats.get('c2')!.projectDismissedAt).not.toBeNull()
  })

  it('deleting a chat takes its untracked suggestion with it, but not a tracked project', () => {
    const h = harness()
    h.suggest('c1', 'Maybe')
    h.service.forgetSuggestionOf('c1')
    expect(h.projects.size).toBe(0)
    const id = h.suggest('c2', 'Real')
    h.service.track('c2')
    h.service.forgetSuggestionOf('c2')
    expect(h.projects.has(id)).toBe(true)
  })

  it('Done writes a completion on the local day for every project, with no counted flag', () => {
    const h = harness()
    const a = h.suggest('c1', 'A')
    const b = h.suggest('c2', 'B')
    const other = h.suggest('c3', 'C', 'music')
    for (const chat of ['c1', 'c2', 'c3']) h.service.track(chat)
    // 03:30 UTC on the 16th is still the 15th in Santo Domingo (UTC-4).
    h.setNow('2026-11-16T03:30:00.000Z')
    expect(h.service.act(a, 'done')).toMatchObject({ state: 'done', closedAt: '2026-11-16T03:30:00.000Z' })
    h.service.act(b, 'done')
    h.service.act(other, 'done')
    expect(h.completions).toEqual([
      // Both Coding completions are kept; the engine counts that day once.
      { projectId: a, roomId: 'coding', localDay: '2026-11-15' },
      { projectId: b, roomId: 'coding', localDay: '2026-11-15' },
      { projectId: other, roomId: 'music', localDay: '2026-11-15' }
    ])
  })

  it('Reopen deletes the completion and makes the project active again', () => {
    const h = harness()
    const id = h.suggest('c1', 'A')
    h.service.track('c1')
    h.service.act(id, 'done')
    expect(h.service.act(id, 'reopen')).toMatchObject({ state: 'active', closedAt: null })
    expect(h.completions).toEqual([])
  })

  it('Snooze, Pause and Drop set what they should, and an invalid action is refused', () => {
    const h = harness()
    const id = h.suggest('c1', 'A')
    h.service.track('c1')
    expect(h.service.act(id, 'snooze')).toMatchObject({ state: 'active', snoozedUntil: '2026-11-29T16:00:00.000Z' })
    expect(h.service.act(id, 'pause')).toMatchObject({ state: 'paused', snoozedUntil: null })
    expect(() => h.service.act(id, 'snooze')).toThrow('paused')
    expect(h.service.act(id, 'drop')).toMatchObject({ state: 'dropped', closedAt: '2026-11-15T16:00:00.000Z' })
    expect(h.completions).toEqual([])
    expect(() => h.service.act('nope', 'done')).toThrow('no longer exists')
  })

  it('Move to room marks the chat as placed by the user, and rejects an unknown room', () => {
    const h = harness()
    h.addChat('c1', { roomId: 'coding', roomSource: 'model' })
    h.service.moveChat('c1', 'music')
    expect(h.chats.get('c1')).toMatchObject({ roomId: 'music', roomSource: 'user' })
    expect(() => h.service.moveChat('c1', 'kitchen')).toThrow('no room')
    expect(() => h.service.moveChat('gone', 'music')).toThrow('no longer exists')
  })

  it('a new message in a linked chat moves the project activity forward', () => {
    const h = harness()
    const id = h.suggest('c1', 'A')
    h.service.track('c1')
    h.setNow('2026-11-20T09:00:00.000Z')
    h.service.noteActivity('c1')
    h.service.noteActivity('unlinked')
    expect(h.projects.get(id)!.lastActivityAt).toBe('2026-11-20T09:00:00.000Z')
  })
})
