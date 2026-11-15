import { create } from 'zustand'
import type { AuthState, ChatEvent, ChatMessage, ChatSummary } from '@shared/chat'
import type { AppStatus } from '@shared/ipc'
import type { ProjectAction, ProjectSummary } from '@shared/projects'

interface Streaming {
  text: string
  /** The web search in progress, if any. */
  searching: string | null
}

interface State {
  status: AppStatus | null
  /** Null until the first check has come back. */
  auth: AuthState | null
  chats: ChatSummary[]
  projects: ProjectSummary[]
  /** Which main view is showing. */
  view: 'chat' | 'projects'
  /** Null means the "new chat" screen. */
  activeChatId: string | null
  messages: Record<string, ChatMessage[]>
  streaming: Record<string, Streaming>
  errors: Record<string, string>
  /** An error that belongs to no chat (start-up, sending a first message). */
  appError: string | null
  /** True between sending the first message of a new chat and learning its id. */
  startingChat: boolean

  init(): Promise<void>
  checkAuth(): Promise<void>
  refreshChats(): Promise<void>
  selectChat(chatId: string | null): Promise<void>
  send(text: string): Promise<void>
  stop(): Promise<void>
  deleteChat(chatId: string): Promise<void>
  showProjects(): Promise<void>
  refreshProjects(): Promise<void>
  moveChat(chatId: string, roomId: string): Promise<void>
  /** Answers the "Track it?" card. */
  answerSuggestion(chatId: string, track: boolean): Promise<void>
  projectAction(projectId: string, action: ProjectAction): Promise<void>
  handleEvent(event: ChatEvent): void
}

const describe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in an IPC handler; keep only the message.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const useStore = create<State>((set, get) => ({
  status: null,
  auth: null,
  chats: [],
  projects: [],
  view: 'chat',
  activeChatId: null,
  messages: {},
  streaming: {},
  errors: {},
  appError: null,
  startingChat: false,

  async init() {
    try {
      const [status, auth, chats] = await Promise.all([
        window.mindPalace.status(),
        window.mindPalace.invoke('auth:check'),
        window.mindPalace.invoke('chat:list')
      ])
      set({ status, auth, chats })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async checkAuth() {
    try {
      set({ auth: await window.mindPalace.invoke('auth:retry') })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async refreshChats() {
    try {
      set({ chats: await window.mindPalace.invoke('chat:list') })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async selectChat(chatId) {
    set({ activeChatId: chatId, appError: null, view: 'chat' })
    if (chatId === null || get().messages[chatId]) return
    try {
      const loaded = await window.mindPalace.invoke('chat:messages', { chatId })
      // Events may have added messages while this was loading; the database is the fuller record.
      set((s) => ({ messages: { ...s.messages, [chatId]: loaded } }))
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [chatId]: describe(error) } }))
    }
  },

  async send(text) {
    const chatId = get().activeChatId
    if (chatId !== null) set((s) => ({ errors: without(s.errors, chatId) }))
    set({ appError: null, startingChat: chatId === null })
    try {
      const sent = await window.mindPalace.invoke('chat:send', { chatId, text })
      if (get().activeChatId === null) set({ activeChatId: sent.chatId })
    } catch (error) {
      const message = describe(error)
      if (chatId === null) set({ appError: message })
      else set((s) => ({ errors: { ...s.errors, [chatId]: message } }))
      throw error
    } finally {
      set({ startingChat: false })
    }
  },

  async stop() {
    const chatId = get().activeChatId
    if (chatId === null) return
    await window.mindPalace.invoke('chat:stop', { chatId })
  },

  async deleteChat(chatId) {
    try {
      await window.mindPalace.invoke('chat:delete', { chatId })
    } catch (error) {
      set({ appError: describe(error) })
      return
    }
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
      messages: without(s.messages, chatId),
      streaming: without(s.streaming, chatId),
      errors: without(s.errors, chatId)
    }))
  },

  async showProjects() {
    set({ view: 'projects', appError: null })
    await get().refreshProjects()
  },

  async refreshProjects() {
    try {
      set({ projects: await window.mindPalace.invoke('project:list') })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async moveChat(chatId, roomId) {
    try {
      await window.mindPalace.invoke('chat:move', { chatId, roomId })
      await get().refreshChats()
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [chatId]: describe(error) } }))
    }
  },

  async answerSuggestion(chatId, track) {
    try {
      if (track) await window.mindPalace.invoke('project:track', { chatId })
      else await window.mindPalace.invoke('project:dismiss', { chatId })
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [chatId]: describe(error) } }))
    }
    await Promise.all([get().refreshChats(), get().refreshProjects()])
  },

  async projectAction(projectId, action) {
    try {
      await window.mindPalace.invoke('project:action', { projectId, action })
      set({ appError: null })
    } catch (error) {
      set({ appError: describe(error) })
    }
    await Promise.all([get().refreshProjects(), get().refreshChats()])
  },

  handleEvent(event) {
    const { chatId } = event
    switch (event.type) {
      case 'started':
        set((s) => ({
          // The first message of a new chat: this is the chat the user is waiting on.
          activeChatId: s.activeChatId === null && s.startingChat ? chatId : s.activeChatId,
          messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), event.userMessage] },
          streaming: { ...s.streaming, [chatId]: { text: '', searching: null } },
          errors: without(s.errors, chatId)
        }))
        void get().refreshChats()
        break
      case 'delta':
        set((s) => ({
          streaming: {
            ...s.streaming,
            [chatId]: { text: (s.streaming[chatId]?.text ?? '') + event.text, searching: null }
          }
        }))
        break
      case 'searching':
        set((s) => ({
          streaming: { ...s.streaming, [chatId]: { text: s.streaming[chatId]?.text ?? '', searching: event.query } }
        }))
        break
      case 'done':
        set((s) => ({
          streaming: without(s.streaming, chatId),
          // A stop before the first word carries an empty placeholder: nothing to add.
          messages: event.message.id
            ? { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), event.message] }
            : s.messages
        }))
        void get().refreshChats()
        break
      case 'error':
        set((s) => ({
          streaming: without(s.streaming, chatId),
          errors: { ...s.errors, [chatId]: event.message },
          auth: event.auth ?? s.auth
        }))
        break
      case 'updated':
        void get().refreshChats()
        if (get().view === 'projects') void get().refreshProjects()
        break
    }
  }
}))
