import { titleFromMessage, type AuthState, type ChatEvent, type ChatMessage, type ChatSummary } from '@shared/chat'
import { findClaudeLogin } from './auth'
import { ask, type ClaudeEvent } from './claude'
import type { ChatRepo } from './repo'

export interface ChatServiceDeps {
  repo: ChatRepo
  /** Delivers an event to the renderer. */
  emit: (event: ChatEvent) => void
  /** Folder the SDK keeps session transcripts under. */
  sessionsDir: string
  model: () => string
  appVersion: string
  /** Called after each user message is stored, with how many the chat now has. */
  afterUserMessage?: (chatId: string, userMessageCount: number) => void
  /** Swappable for tests; defaults to the real Claude module. */
  askClaude?: typeof ask
  findLogin?: () => Promise<AuthState>
}

const MAX_MESSAGE_LENGTH = 100_000
/** How many earlier messages are replayed when an SDK session can no longer be resumed. */
const REPLAY_LIMIT = 30

/** Earlier turns as plain text, for a chat whose SDK session is gone. */
function replayPrompt(history: ChatMessage[], text: string): string {
  const earlier = history.slice(-REPLAY_LIMIT)
  if (earlier.length === 0) return text
  const transcript = earlier
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')
  return `This conversation is being continued. Earlier messages:\n\n${transcript}\n\nThe user's new message:\n\n${text}`
}

export function createChatService(deps: ChatServiceDeps) {
  const { repo, emit } = deps
  const askClaude = deps.askClaude ?? ask
  const findLogin = deps.findLogin ?? findClaudeLogin
  const running = new Map<string, AbortController>()
  /** Set when Claude refuses the login; cleared by the next answer that succeeds. */
  let rejected: AuthState | null = null

  type Outcome =
    | { kind: 'ok'; text: string; tokensIn: number; tokensOut: number }
    | { kind: 'stopped'; text: string }
    | { kind: 'auth'; detail: string }
    | { kind: 'failed'; text: string; error: string }

  async function runTurn(chatId: string, prompt: string, resume: string | undefined, abort: AbortController): Promise<Outcome> {
    let text = ''
    try {
      const events: AsyncIterable<ClaudeEvent> = askClaude({
        prompt,
        model: deps.model(),
        cwd: deps.sessionsDir,
        abortController: abort,
        appVersion: deps.appVersion,
        ...(resume ? { resume } : {})
      })
      for await (const event of events) {
        switch (event.type) {
          case 'session':
            if (event.sessionId !== resume) repo.setSession(chatId, event.sessionId)
            break
          case 'delta':
            text += event.text
            emit({ type: 'delta', chatId, text: event.text })
            break
          case 'searching':
            emit({ type: 'searching', chatId, query: event.query })
            break
          case 'auth_error':
            return { kind: 'auth', detail: event.detail }
          case 'result':
            return event.ok
              ? { kind: 'ok', text, tokensIn: event.tokensIn, tokensOut: event.tokensOut }
              : { kind: 'failed', text, error: event.error }
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return { kind: 'stopped', text }
      return { kind: 'failed', text, error: error instanceof Error ? error.message : String(error) }
    }
    // The stream ended without a result: either stopped, or the process went away.
    return abort.signal.aborted
      ? { kind: 'stopped', text }
      : { kind: 'failed', text, error: 'Claude stopped answering before it finished.' }
  }

  async function answer(chatId: string, text: string, history: ChatMessage[], resume: string | undefined): Promise<void> {
    const abort = new AbortController()
    running.set(chatId, abort)
    try {
      let outcome = await runTurn(chatId, text, resume, abort)

      // A session that cannot be resumed (transcript deleted, another machine)
      // fails before writing anything. Start a new session and replay the chat.
      if (outcome.kind === 'failed' && resume && outcome.text === '') {
        repo.setSession(chatId, null)
        outcome = await runTurn(chatId, replayPrompt(history, text), undefined, abort)
      }

      // The chat was deleted while it was answering: there is nowhere to put the answer.
      if (!repo.get(chatId)) return

      if (outcome.kind === 'auth') {
        rejected = { status: 'rejected', detail: outcome.detail }
        emit({ type: 'error', chatId, message: outcome.detail, auth: rejected })
        return
      }

      const written = outcome.text.trim()
      if (outcome.kind === 'failed' && written === '') {
        emit({ type: 'error', chatId, message: outcome.error })
        return
      }
      if (written === '') {
        // Stopped before a single word: nothing to keep.
        emit({ type: 'done', chatId, stopped: true, message: emptyMessage(chatId) })
        return
      }

      const message = repo.addMessage({
        chatId,
        role: 'assistant',
        content: written,
        ...(outcome.kind === 'ok' ? { tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut } : {})
      })
      if (outcome.kind === 'ok') rejected = null
      emit({ type: 'done', chatId, message, stopped: outcome.kind !== 'ok' })
      // A partial answer is kept; the failure is still reported.
      if (outcome.kind === 'failed') emit({ type: 'error', chatId, message: outcome.error })
    } finally {
      running.delete(chatId)
    }
  }

  const emptyMessage = (chatId: string): ChatMessage => ({
    id: '',
    chatId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    sources: []
  })

  return {
    list: (): ChatSummary[] => repo.list(),

    messages(chatId: string): ChatMessage[] {
      return repo.messages(chatId)
    },

    /** Stores the message, tells the renderer, and starts the answer without waiting for it. */
    send(request: { chatId: string | null; text: string }): { chatId: string } {
      const text = request.text.trim()
      if (text === '') throw new Error('The message is empty.')
      if (text.length > MAX_MESSAGE_LENGTH) throw new Error('The message is too long.')

      const chat = request.chatId === null ? repo.create(titleFromMessage(text)) : repo.get(request.chatId)
      if (!chat) throw new Error('That chat no longer exists.')
      if (running.has(chat.id)) throw new Error('This chat is still answering. Stop it first.')

      const history = repo.messages(chat.id)
      const userMessage = repo.addMessage({ chatId: chat.id, role: 'user', content: text })
      emit({ type: 'started', chatId: chat.id, userMessage })
      deps.afterUserMessage?.(chat.id, history.filter((m) => m.role === 'user').length + 1)

      void answer(chat.id, text, history, chat.sdkSessionId ?? undefined).catch((error: unknown) => {
        emit({ type: 'error', chatId: chat.id, message: error instanceof Error ? error.message : String(error) })
      })
      return { chatId: chat.id }
    },

    stop(chatId: string): { stopped: boolean } {
      const abort = running.get(chatId)
      if (!abort) return { stopped: false }
      abort.abort()
      return { stopped: true }
    },

    delete(chatId: string): { deleted: boolean } {
      running.get(chatId)?.abort()
      return { deleted: repo.delete(chatId) }
    },

    /** Stops every answer in progress; called when the app quits. */
    stopAll(): void {
      for (const abort of running.values()) abort.abort()
    },

    /**
     * `retry: true` is the user saying "I fixed it": the remembered refusal is
     * dropped, so the chat is usable again and the next message is the real test.
     */
    async auth(options: { retry?: boolean } = {}): Promise<AuthState> {
      const login = await findLogin()
      if (login.status !== 'ok' || options.retry) rejected = null
      return login.status === 'ok' ? (rejected ?? login) : login
    }
  }
}

export type ChatService = ReturnType<typeof createChatService>
