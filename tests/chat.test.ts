import { describe, expect, it } from 'vitest'
import {
  extractSources,
  groupChatsByRoom,
  splitSources,
  titleFromMessage,
  UNSORTED_GROUP,
  type AuthState,
  type ChatEvent,
  type ChatMessage,
  type ChatSummary
} from '../src/shared/chat'
import { describeAuthError, type AskParams, type ClaudeEvent } from '../src/main/chat/claude'
import type { ChatRepo, ChatRow } from '../src/main/chat/repo'
import { createChatService } from '../src/main/chat/service'

describe('titleFromMessage', () => {
  it.each([
    ['How do I shade a sphere?', 'How do I shade a sphere?'],
    ['  first line\nsecond line  ', 'first line'],
    ['', 'New chat'],
    ['   \n  ', 'New chat']
  ])('%j -> %j', (input, expected) => {
    expect(titleFromMessage(input)).toBe(expected)
  })

  it('cuts long text at a word and marks it', () => {
    const title = titleFromMessage('Explain sidechain compression like I am completely new to mixing and mastering audio')
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title).toBe('Explain sidechain compression like I am completely new to…')
  })
})

describe('extractSources', () => {
  it('reads markdown links in order, once per URL', () => {
    const text =
      'See [MDN on fetch](https://developer.mozilla.org/docs/Web/API/fetch) and [React docs](https://react.dev/learn).\n' +
      'Again: [fetch](https://developer.mozilla.org/docs/Web/API/fetch).'
    expect(extractSources(text)).toEqual([
      { title: 'MDN on fetch', url: 'https://developer.mozilla.org/docs/Web/API/fetch' },
      { title: 'React docs', url: 'https://react.dev/learn' }
    ])
  })

  it('reads bare URLs, titled by host, without trailing punctuation', () => {
    expect(extractSources('Source: https://www.example.com/a/b. Also http://test.org/x, done')).toEqual([
      { title: 'example.com', url: 'https://www.example.com/a/b' },
      { title: 'test.org', url: 'http://test.org/x' }
    ])
  })

  it('does not count the URL inside a markdown link twice', () => {
    expect(extractSources('[site](https://example.com/page)')).toHaveLength(1)
  })

  it('finds nothing in plain text, and ignores non-http links', () => {
    expect(extractSources('No links here. [mail](mailto:a@b.c) [x](javascript:alert(1))')).toEqual([])
  })
})

describe('splitSources', () => {
  const answer =
    'The latest LTS is **v26.13.1**, per the [download page](https://nodejs.org/en/download).\n\n' +
    'Sources:\n' +
    '- [Node.js — Download Node.js®](https://nodejs.org/en/download)\n' +
    '- [Node.js 26.13.1 (LTS)](https://nodejs.org/en/blog/release/v26.13.1)\n'

  it('removes a trailing Sources list and keeps its page titles, listed first', () => {
    expect(splitSources(answer)).toEqual({
      body: 'The latest LTS is **v26.13.1**, per the [download page](https://nodejs.org/en/download).',
      sources: [
        { title: 'Node.js — Download Node.js®', url: 'https://nodejs.org/en/download' },
        { title: 'Node.js 26.13.1 (LTS)', url: 'https://nodejs.org/en/blog/release/v26.13.1' }
      ]
    })
  })

  it.each(['**Sources:**', '## Sources', 'sources', 'Sources :'])('accepts the heading %j', (heading) => {
    const text = `Body.\n\n${heading}\n\n1. [A](https://a.example/x)\n2. https://b.example/y`
    expect(splitSources(text)).toEqual({
      body: 'Body.',
      sources: [
        { title: 'A', url: 'https://a.example/x' },
        { title: 'b.example', url: 'https://b.example/y' }
      ]
    })
  })

  it('leaves the text alone when there is no such trailing list', () => {
    const cases = [
      'Plain answer with a [link](https://a.example).',
      // A list of links with no heading is part of the answer.
      'Try these:\n- [A](https://a.example)\n- [B](https://b.example)',
      // A Sources heading followed by prose, not a list of links.
      'Sources:\nI used my own knowledge.',
      // A Sources list that is not at the end.
      'Sources:\n- [A](https://a.example)\n\nAnd one more thought.',
      // A list where one item is not a link.
      'Sources:\n- [A](https://a.example)\n- my memory'
    ]
    for (const text of cases) expect(splitSources(text).body).toBe(text)
    expect(splitSources(cases[0]!).sources).toEqual([{ title: 'link', url: 'https://a.example' }])
    expect(splitSources('').sources).toEqual([])
  })
})

describe('describeAuthError', () => {
  it('quotes Claude and explains an API-key login that is out of credit', () => {
    const text = describeAuthError('billing_error', 'Credit balance is too low', '/login managed key')
    expect(text).toContain('billing problem')
    expect(text).toContain('Claude said: "Credit balance is too low".')
    expect(text).toContain('API account billed per use')
  })

  it('does not blame an API key when the login is a subscription', () => {
    const text = describeAuthError('billing_error', 'Credit balance is too low', 'none')
    expect(text).not.toContain('API account')
  })

  it('handles a refusal with no text', () => {
    expect(describeAuthError('authentication_failed', '  ', null)).toBe('Claude did not accept the login on this machine.')
  })
})

describe('groupChatsByRoom', () => {
  const rooms = [
    { id: 'coding', name: 'Coding room', accent: '#5eead4' },
    { id: 'music', name: 'Music studio', accent: '#f0abfc' }
  ]
  const chat = (id: string, roomId: string | null, lastMessageAt: string | null): ChatSummary => ({
    id,
    title: id,
    roomId,
    roomSource: roomId === null ? null : 'model',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastMessageAt,
    project: null,
    suggestion: null
  })

  it('puts unsorted first, rooms in catalog order, newest chat first, and drops empty rooms', () => {
    const groups = groupChatsByRoom(
      [
        chat('old-code', 'coding', '2026-11-02T10:00:00.000Z'),
        chat('new-code', 'coding', '2026-11-05T10:00:00.000Z'),
        chat('fresh', null, null),
        chat('gone-room', 'cooking', '2026-11-03T10:00:00.000Z')
      ],
      rooms
    )
    expect(groups.map((g) => [g.id, g.chats.map((c) => c.id)])).toEqual([
      [UNSORTED_GROUP, ['gone-room', 'fresh']],
      ['coding', ['new-code', 'old-code']]
    ])
  })

  it('returns no groups for no chats', () => {
    expect(groupChatsByRoom([], rooms)).toEqual([])
  })
})

/** An in-memory stand-in for the SQLite repo (better-sqlite3 is built for Electron and cannot load here). */
function memoryRepo(): ChatRepo & { rows: Map<string, ChatRow>; stored: Array<ChatMessage & { tokensIn?: number; tokensOut?: number }> } {
  const rows = new Map<string, ChatRow>()
  const stored: Array<ChatMessage & { tokensIn?: number; tokensOut?: number }> = []
  let n = 0
  const stamp = (): string => new Date(Date.UTC(2026, 10, 15, 12, 0, n++)).toISOString()
  return {
    rows,
    stored,
    list: () => [...rows.values()].map(({ sdkSessionId: _s, ...summary }) => summary),
    get: (id) => rows.get(id),
    create(title) {
      const row: ChatRow = {
        id: `chat-${rows.size + 1}`,
        title,
        roomId: null,
        roomSource: null,
        createdAt: stamp(),
        lastMessageAt: null,
        project: null,
        suggestion: null,
        sdkSessionId: null
      }
      rows.set(row.id, row)
      return row
    },
    messages: (chatId) => stored.filter((m) => m.chatId === chatId).map(({ tokensIn: _i, tokensOut: _o, ...m }) => m),
    addMessage(input) {
      const createdAt = stamp()
      const message = {
        id: `msg-${stored.length + 1}`,
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        createdAt,
        sources: input.role === 'assistant' ? splitSources(input.content).sources : [],
        ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
        ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {})
      }
      stored.push(message)
      rows.get(input.chatId)!.lastMessageAt = createdAt
      const { tokensIn: _i, tokensOut: _o, ...plain } = message
      return plain
    },
    setSession(chatId, sdkSessionId) {
      rows.get(chatId)!.sdkSessionId = sdkSessionId
    },
    fillMissingLocalDays: () => 0,
    delete: (chatId) => rows.delete(chatId)
  }
}

type Script = (params: AskParams) => AsyncGenerator<ClaudeEvent>

function harness(script: Script, login: AuthState = { status: 'ok' }) {
  const repo = memoryRepo()
  const events: ChatEvent[] = []
  const calls: AskParams[] = []
  let settle: () => void = () => {}
  const service = createChatService({
    repo,
    emit: (event) => {
      events.push(event)
      if (event.type === 'done' || event.type === 'error') settle()
    },
    sessionsDir: '/tmp/sessions',
    model: () => 'test-model',
    appVersion: '0.0.0',
    askClaude: (params) => {
      calls.push(params)
      return script(params)
    },
    findLogin: async () => login
  })
  /** Resolves on the next `done` or `error` event. */
  const finished = (): Promise<void> => new Promise((resolve) => (settle = resolve))
  return { service, repo, events, calls, finished }
}

const reply = (...chunks: string[]): Script =>
  async function* () {
    yield { type: 'session', sessionId: 'session-1' }
    for (const text of chunks) yield { type: 'delta', text }
    yield { type: 'result', ok: true, tokensIn: 120, tokensOut: 30 }
  }

describe('chat service', () => {
  it('stores the question and the answer, streams deltas, and keeps the session id', async () => {
    const h = harness(reply('Hello', ' there'))
    const done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: '  What is a ii-V-I?  ' })
    await done

    expect(h.events.map((e) => e.type)).toEqual(['started', 'delta', 'delta', 'done'])
    expect(h.repo.rows.get(chatId)).toMatchObject({ title: 'What is a ii-V-I?', sdkSessionId: 'session-1' })
    expect(h.repo.stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'What is a ii-V-I?'],
      ['assistant', 'Hello there']
    ])
    expect(h.repo.stored[1]).toMatchObject({ tokensIn: 120, tokensOut: 30 })
    expect(h.calls[0]).toMatchObject({ prompt: 'What is a ii-V-I?', model: 'test-model', cwd: '/tmp/sessions' })
    expect(h.calls[0]!.resume).toBeUndefined()
    const last = h.events.at(-1)
    expect(last).toMatchObject({ type: 'done', stopped: false })
  })

  it('resumes the SDK session on the next message of the same chat', async () => {
    const h = harness(reply('one'))
    let done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: 'first' })
    await done
    done = h.finished()
    h.service.send({ chatId, text: 'second' })
    await done

    expect(h.calls[1]).toMatchObject({ prompt: 'second', resume: 'session-1' })
    expect(h.service.messages(chatId).map((m) => m.content)).toEqual(['first', 'one', 'second', 'one'])
  })

  it('reports a web search and exposes the cited sources on the stored answer', async () => {
    const h = harness(async function* () {
      yield { type: 'session', sessionId: 's' }
      yield { type: 'searching', query: 'robot vacuum comparison' }
      yield { type: 'delta', text: 'The [Wirecutter guide](https://www.nytimes.com/wirecutter/reviews/robot-vacuum/) says so.' }
      yield { type: 'result', ok: true, tokensIn: 1, tokensOut: 1 }
    })
    const done = h.finished()
    h.service.send({ chatId: null, text: 'Compare two robot vacuums' })
    await done

    expect(h.events.find((e) => e.type === 'searching')).toMatchObject({ query: 'robot vacuum comparison' })
    const last = h.events.at(-1)
    expect(last?.type === 'done' && last.message.sources).toEqual([
      { title: 'Wirecutter guide', url: 'https://www.nytimes.com/wirecutter/reviews/robot-vacuum/' }
    ])
  })

  it('stop keeps what was written so far and marks the answer as stopped', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = harness(async function* (params) {
      yield { type: 'session', sessionId: 's' }
      yield { type: 'delta', text: 'Partial answer' }
      await gate
      if (params.abortController.signal.aborted) return
      yield { type: 'delta', text: ' never sent' }
      yield { type: 'result', ok: true, tokensIn: 1, tokensOut: 1 }
    })
    const done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: 'long question' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.service.stop(chatId)).toEqual({ stopped: true })
    release()
    await done

    expect(h.events.at(-1)).toMatchObject({ type: 'done', stopped: true })
    expect(h.repo.stored.at(-1)).toMatchObject({ role: 'assistant', content: 'Partial answer' })
    expect(h.repo.stored.at(-1)).not.toHaveProperty('tokensIn')
    expect(h.service.stop(chatId)).toEqual({ stopped: false })
  })

  it('a stop before any text stores no answer', async () => {
    const h = harness(async function* (params) {
      yield { type: 'session', sessionId: 's' }
      params.abortController.abort()
    })
    const done = h.finished()
    h.service.send({ chatId: null, text: 'q' })
    await done
    expect(h.events.at(-1)).toMatchObject({ type: 'done', stopped: true })
    expect(h.repo.stored.map((m) => m.role)).toEqual(['user'])
  })

  it('a refused login is reported, stores no answer, and shows in auth() until an answer succeeds', async () => {
    let refuse = true
    const h = harness(async function* (params) {
      if (refuse) {
        yield { type: 'auth_error', detail: 'Claude did not accept the login on this machine.' }
        return
      }
      yield* reply('ok')(params)
    })
    let done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: 'q' })
    await done

    const rejected = { status: 'rejected', detail: 'Claude did not accept the login on this machine.' }
    expect(h.events.at(-1)).toMatchObject({ type: 'error', auth: rejected })
    expect(h.repo.stored.map((m) => m.role)).toEqual(['user'])
    expect(await h.service.auth()).toEqual(rejected)

    refuse = false
    done = h.finished()
    h.service.send({ chatId, text: 'again' })
    await done
    expect(await h.service.auth()).toEqual({ status: 'ok' })
  })

  it('auth({ retry }) forgets a remembered refusal so the chat can be used again', async () => {
    const h = harness(async function* () {
      yield { type: 'auth_error', detail: 'refused' }
    })
    const done = h.finished()
    h.service.send({ chatId: null, text: 'q' })
    await done
    expect(await h.service.auth()).toEqual({ status: 'rejected', detail: 'refused' })
    expect(await h.service.auth({ retry: true })).toEqual({ status: 'ok' })
    expect(await h.service.auth()).toEqual({ status: 'ok' })
  })

  it('reports a missing login from auth()', async () => {
    const h = harness(reply('x'), { status: 'missing' })
    expect(await h.service.auth()).toEqual({ status: 'missing' })
  })

  it('when a session cannot be resumed, starts a new one and replays the chat', async () => {
    let turn = 0
    const h = harness(async function* (params) {
      turn++
      if (turn === 1) return yield* reply('first answer')(params)
      if (params.resume) {
        yield { type: 'result', ok: false, error: 'error_during_execution' }
        return
      }
      yield { type: 'session', sessionId: 'session-2' }
      yield { type: 'delta', text: 'recovered' }
      yield { type: 'result', ok: true, tokensIn: 1, tokensOut: 1 }
    })
    let done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: 'first question' })
    await done
    done = h.finished()
    h.service.send({ chatId, text: 'second question' })
    await done

    expect(h.calls).toHaveLength(3)
    expect(h.calls[1]!.resume).toBe('session-1')
    expect(h.calls[2]!.resume).toBeUndefined()
    expect(h.calls[2]!.prompt).toContain('User: first question')
    expect(h.calls[2]!.prompt).toContain('Assistant: first answer')
    expect(h.calls[2]!.prompt.endsWith('second question')).toBe(true)
    expect(h.repo.rows.get(chatId)!.sdkSessionId).toBe('session-2')
    expect(h.repo.stored.at(-1)).toMatchObject({ content: 'recovered' })
    expect(h.events.filter((e) => e.type === 'error')).toEqual([])
  })

  it('a failure with no text is an error; a failure after some text keeps the text and still reports', async () => {
    const empty = harness(async function* () {
      yield { type: 'result', ok: false, error: 'error_max_turns' }
    })
    let done = empty.finished()
    empty.service.send({ chatId: null, text: 'q' })
    await done
    expect(empty.events.at(-1)).toMatchObject({ type: 'error', message: 'error_max_turns' })
    expect(empty.repo.stored.map((m) => m.role)).toEqual(['user'])

    const partial = harness(async function* () {
      yield { type: 'delta', text: 'half' }
      throw new Error('connection lost')
    })
    done = partial.finished()
    partial.service.send({ chatId: null, text: 'q' })
    await done
    await new Promise((r) => setTimeout(r, 0))
    expect(partial.events.map((e) => e.type)).toEqual(['started', 'delta', 'done', 'error'])
    expect(partial.events.at(-1)).toMatchObject({ message: 'connection lost' })
    expect(partial.repo.stored.at(-1)).toMatchObject({ role: 'assistant', content: 'half' })
  })

  it('rejects an empty message, an unknown chat, and a second message while answering', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = harness(async function* (params) {
      await gate
      yield* reply('done')(params)
    })
    expect(() => h.service.send({ chatId: null, text: '   ' })).toThrow('empty')
    expect(() => h.service.send({ chatId: 'nope', text: 'hi' })).toThrow('no longer exists')
    expect(h.repo.rows.size).toBe(0)

    const done = h.finished()
    const { chatId } = h.service.send({ chatId: null, text: 'first' })
    expect(() => h.service.send({ chatId, text: 'second' })).toThrow('still answering')
    release()
    await done
    expect(h.repo.stored.map((m) => m.content)).toEqual(['first', 'done'])
  })

  it('delete stops the answer in progress and removes the chat', async () => {
    let aborted = false
    const h = harness(async function* (params) {
      yield { type: 'delta', text: 'x' }
      await new Promise<void>((resolve) => params.abortController.signal.addEventListener('abort', () => resolve()))
      aborted = true
    })
    const { chatId } = h.service.send({ chatId: null, text: 'q' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.service.delete(chatId)).toEqual({ deleted: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(aborted).toBe(true)
    expect(h.service.list()).toEqual([])
    // Nothing is reported for a chat that no longer exists.
    expect(h.events.map((e) => e.type)).toEqual(['started', 'delta'])
  })
})
