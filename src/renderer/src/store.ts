import { create } from 'zustand'
import { addActivity, chatChanges, SORTING_ROOM, type ActivityItem, type ActivityKind } from '@shared/agents'
import { titleFromMessage, type AuthState, type ChatEvent, type ChatMessage, type ChatSummary } from '@shared/chat'
import type { AppEvent, AppStatus } from '@shared/ipc'
import type { PalaceView } from '@shared/palace'
import type { GitInfo, MilestoneEdit, ProjectProgress, SweepCandidate } from '@shared/milestones'
import type { PlacementChange } from '@shared/placements'
import type { ProjectAction, ProjectSummary } from '@shared/projects'
import type { ReminderItem, ReminderResponse } from '@shared/reminders'

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
  /** Each opened project's progress, by project id. */
  progress: Record<string, ProjectProgress>
  /** The sweep's proposed chats waiting for "Link these", by project id. */
  sweeps: Record<string, SweepCandidate[]>
  /** A sweep or link running, by project id (the build itself shows as `running`). */
  progressBusy: Record<string, boolean>
  progressErrors: Record<string, string>
  /** Each project folder's git info, by project id (null: no repo). */
  gitInfo: Record<string, GitInfo | null>
  /** Reminders waiting for a reaction. */
  reminders: ReminderItem[]
  /** Whether system notifications are shown for reminders. */
  notificationsOn: boolean
  /** Null until the palace has been loaded once. */
  palace: PalaceView | null
  /** The room showing in the palace view; null is the palace itself, with every room. */
  palaceRoomId: string | null
  /** The room a chat started from inside the palace will be filed in. */
  newChatRoomId: string | null
  /** Rooms looked at since the palace was last loaded: their news no longer counts for the sidebar badge. */
  seenRooms: string[]
  /**
   * Which main view is showing. The palace is home; `chat` is the palace with
   * the chat panel open beside it.
   */
  view: 'chat' | 'projects' | 'project' | 'reminders' | 'palace'
  /** The project the project page shows. */
  projectPageId: string | null
  /** Text a new chat's message box starts with (taken once by the chat view). */
  composerDraft: string | null
  /** The chat panel takes the whole width, hiding the palace. */
  chatWide: boolean
  /** The side rail is expanded to show the list of chats. */
  railOpen: boolean
  /** The command bar (Cmd+K) is showing. */
  commandOpen: boolean
  /** Null means the "new chat" screen. */
  activeChatId: string | null
  messages: Record<string, ChatMessage[]>
  streaming: Record<string, Streaming>
  errors: Record<string, string>
  /** An error that belongs to no chat (start-up, sending a first message). */
  appError: string | null
  /** True between sending the first message of a new chat and learning its id. */
  startingChat: boolean
  /** What just happened, newest first. Kept only while the app is open. */
  activity: ActivityItem[]
  /** Room -> the chat whose answer just ended there; cleared a few seconds later. */
  finished: Record<string, string>
  /** Chats on their way from the sorting room to the room they were filed in. */
  transfers: Array<{ id: number; to: string }>
  endTransfer(id: number): void

  init(): Promise<void>
  checkAuth(): Promise<void>
  refreshChats(): Promise<void>
  selectChat(chatId: string | null): Promise<void>
  /** Closes the chat panel and leaves the palace showing. */
  closeChat(): void
  toggleChatWide(): void
  toggleRail(): void
  setCommandOpen(open: boolean): void
  send(text: string): Promise<void>
  stop(): Promise<void>
  deleteChat(chatId: string): Promise<void>
  showProjects(): Promise<void>
  /** Opens one project's page. */
  showProject(projectId: string): Promise<void>
  /** Hands the composer's starting text to the chat view, once. */
  takeComposerDraft(): string | null
  refreshProjects(): Promise<void>
  moveChat(chatId: string, roomId: string): Promise<void>
  /** Answers the "Track it?" card. */
  answerSuggestion(chatId: string, track: boolean): Promise<void>
  projectAction(projectId: string, action: ProjectAction): Promise<void>
  loadProgress(projectId: string): Promise<void>
  loadGitInfo(projectId: string): Promise<void>
  /** First run and "Find more chats": the sweep, then "Link these" (or straight to building when it finds none). */
  sweepProject(projectId: string): Promise<void>
  linkChats(projectId: string, accept: string[], dismiss: string[]): Promise<void>
  buildProgress(projectId: string): Promise<void>
  refreshProgress(projectId: string): Promise<void>
  editMilestone(projectId: string, edit: MilestoneEdit): Promise<void>
  answerProposal(projectId: string, proposalId: string, accept: boolean): Promise<void>
  /** A path, `'pick'` for the folder dialog, or null to clear. */
  setProjectFolder(projectId: string, folder: string | null): Promise<void>
  /** Opens the palace: on a room when given one, otherwise on the whole palace. */
  showPalace(roomId?: string | null): Promise<void>
  /** Starts a new chat that will be filed in this room. */
  /** Starts a new chat filed in this room, optionally with text waiting in the message box. */
  startChatIn(roomId: string, draft?: string): void
  refreshPalace(): Promise<void>
  /** Moves, re-skins or hides an item in a room (the room editor). */
  place(change: PlacementChange): Promise<void>
  /** Puts an item back where the catalog puts it. */
  resetPlacement(roomId: string, instance: string): Promise<void>
  /** Makes the room for a suggested area and opens it. Resolves to an error message, or null. */
  materializeRoom(area: string, name?: string): Promise<string | null>
  /** "Not now" on a suggested room. */
  dismissArea(area: string): Promise<void>
  renameRoom(roomId: string, name: string): Promise<string | null>
  /** "Find my rooms": tags the Mail room's chats with areas. Resolves to a line to show. */
  findRooms(): Promise<string>
  /** Marks the room as looked at; what is highlighted as new stays on screen until the next refresh. */
  markRoomSeen(roomId: string): Promise<void>
  showReminders(): Promise<void>
  refreshReminders(): Promise<void>
  respondToReminder(reminderId: string, response: ReminderResponse): Promise<void>
  setNotifications(enabled: boolean): Promise<void>
  handleEvent(event: ChatEvent): void
  handleAppEvent(event: AppEvent): void
}

const describe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in an IPC handler; keep only the message.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** How long a helper keeps saying "Done" after an answer ends. */
const DONE_MS = 5000
let transferId = 0

const RAIL_KEY = 'mind-palace.rail-open'
const WIDE_KEY = 'mind-palace.chat-wide'
const remembered = (key: string): boolean => {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const remember = (key: string, on: boolean): void => {
  try {
    window.localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // Only a convenience; the app works without it.
  }
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record
  return rest
}

/**
 * Runs a progress call and stores the answer, or the error, for that project.
 * Resolves to whether it worked. Bound to the store below.
 */
let progressCall: (projectId: string, call: () => Promise<ProjectProgress>) => Promise<boolean> = async () => false

export const useStore = create<State>((set, get) => ({
  status: null,
  auth: null,
  chats: [],
  projects: [],
  progress: {},
  sweeps: {},
  progressBusy: {},
  progressErrors: {},
  gitInfo: {},
  reminders: [],
  notificationsOn: true,
  palace: null,
  palaceRoomId: null,
  newChatRoomId: null,
  seenRooms: [],
  view: 'palace',
  projectPageId: null,
  composerDraft: null,
  chatWide: remembered(WIDE_KEY),
  railOpen: remembered(RAIL_KEY),
  commandOpen: false,
  activeChatId: null,
  messages: {},
  streaming: {},
  errors: {},
  appError: null,
  startingChat: false,
  activity: [],
  finished: {},
  transfers: [],

  endTransfer(id) {
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) }))
  },

  async init() {
    try {
      const [status, auth, chats, reminders, notifications] = await Promise.all([
        window.mindPalace.status(),
        window.mindPalace.invoke('auth:check'),
        window.mindPalace.invoke('chat:list'),
        window.mindPalace.invoke('reminder:list'),
        window.mindPalace.invoke('reminder:notifications', {})
      ])
      set({ status, auth, chats, reminders, notificationsOn: notifications.enabled })
      // The palace is the first screen, and it shows projects too.
      void get().refreshPalace()
      void get().refreshProjects()
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
    // The palace behind the panel shows the room the chat lives in.
    const roomId = get().chats.find((c) => c.id === chatId)?.roomId ?? null
    const known = roomId !== null && (get().palace?.rooms.some((r) => r.id === roomId) ?? false)
    set((s) => ({
      activeChatId: chatId,
      appError: null,
      view: 'chat',
      newChatRoomId: null,
      commandOpen: false,
      palaceRoomId: known ? roomId : s.palaceRoomId
    }))
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
      const room = get().newChatRoomId
      if (chatId === null && room !== null) {
        // Started from inside a room: file it there, as the person's own choice.
        set({ newChatRoomId: null })
        await get().moveChat(sent.chatId, room)
      }
    } catch (error) {
      const message = describe(error)
      if (chatId === null) set({ appError: message })
      else set((s) => ({ errors: { ...s.errors, [chatId]: message } }))
      throw error
    } finally {
      set({ startingChat: false })
    }
  },

  closeChat() {
    set({ view: 'palace', appError: null })
  },

  toggleChatWide() {
    const chatWide = !get().chatWide
    remember(WIDE_KEY, chatWide)
    set({ chatWide })
  },

  toggleRail() {
    const railOpen = !get().railOpen
    remember(RAIL_KEY, railOpen)
    set({ railOpen })
  },

  setCommandOpen(open) {
    set({ commandOpen: open })
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
    set({ view: 'projects', appError: null, commandOpen: false })
    await get().refreshProjects()
  },

  async showProject(projectId) {
    set({ view: 'project', projectPageId: projectId, appError: null, commandOpen: false })
    await Promise.all([get().refreshProjects(), get().refreshChats(), get().refreshPalace(), get().loadProgress(projectId)])
  },

  takeComposerDraft() {
    const draft = get().composerDraft
    if (draft !== null) set({ composerDraft: null })
    return draft
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
      await Promise.all([get().refreshChats(), get().refreshPalace()])
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
    await Promise.all([get().refreshProjects(), get().refreshChats(), get().refreshReminders(), get().refreshPalace()])
  },

  async loadProgress(projectId) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:get', { projectId }))
  },

  async loadGitInfo(projectId) {
    try {
      const info = await window.mindPalace.invoke('progress:git', { projectId })
      set((s) => ({ gitInfo: { ...s.gitInfo, [projectId]: info } }))
    } catch {
      // Git info is a nicety; the page works without it.
    }
  },

  async sweepProject(projectId) {
    set((s) => ({ progressBusy: { ...s.progressBusy, [projectId]: true }, progressErrors: without(s.progressErrors, projectId) }))
    try {
      const { candidates } = await window.mindPalace.invoke('progress:sweep', { projectId })
      set((s) => ({ sweeps: { ...s.sweeps, [projectId]: candidates } }))
      // Nothing new to confirm: the first run goes straight on to the draft.
      if (candidates.length === 0 && (get().progress[projectId]?.milestones.length ?? 0) === 0) await get().buildProgress(projectId)
    } catch (error) {
      set((s) => ({ progressErrors: { ...s.progressErrors, [projectId]: describe(error) } }))
    } finally {
      set((s) => ({ progressBusy: without(s.progressBusy, projectId) }))
    }
  },

  async linkChats(projectId, accept, dismiss) {
    set((s) => ({ sweeps: without(s.sweeps, projectId) }))
    const linked = await progressCall(projectId, () => window.mindPalace.invoke('progress:link', { projectId, accept, dismiss }))
    if (!linked) return
    await Promise.all([get().refreshProjects(), get().refreshChats()])
    await get().buildProgress(projectId)
  },

  async buildProgress(projectId) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:build', { projectId }))
  },

  async refreshProgress(projectId) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:refresh', { projectId }))
  },

  async editMilestone(projectId, edit) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:edit', { projectId, edit }))
  },

  async answerProposal(projectId, proposalId, accept) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:answer', { projectId, proposalId, accept }))
  },

  async setProjectFolder(projectId, folder) {
    await progressCall(projectId, () => window.mindPalace.invoke('progress:folder', { projectId, folder }))
  },

  async showPalace(roomId) {
    set({ view: 'palace', appError: null, palaceRoomId: roomId ?? null, commandOpen: false })
    // The palace is a dashboard: it shows projects and reminders too.
    await Promise.all([get().refreshPalace(), get().refreshProjects(), get().refreshReminders(), get().refreshChats()])
  },

  startChatIn(roomId, draft) {
    const known = get().palace?.rooms.some((r) => r.id === roomId) ?? false
    set((s) => ({
      view: 'chat',
      activeChatId: null,
      appError: null,
      newChatRoomId: roomId,
      composerDraft: draft ?? null,
      commandOpen: false,
      palaceRoomId: known ? roomId : s.palaceRoomId
    }))
  },

  async refreshPalace() {
    try {
      set({ palace: await window.mindPalace.invoke('palace:view', { focus: get().palaceRoomId }), seenRooms: [] })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async place(change) {
    try {
      set({ palace: await window.mindPalace.invoke('palace:place', change), appError: null })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async resetPlacement(roomId, instance) {
    try {
      set({ palace: await window.mindPalace.invoke('palace:reset', { roomId, instance }), appError: null })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async materializeRoom(area, name) {
    try {
      const palace = await window.mindPalace.invoke('rooms:materialize', { area, ...(name ? { name } : {}) })
      const made = palace.rooms.find((r) => r.state && !get().palace?.rooms.some((old) => old.id === r.id))
      set({ palace, appError: null, palaceRoomId: made?.id ?? get().palaceRoomId })
      return null
    } catch (error) {
      return describe(error)
    }
  },

  async dismissArea(area) {
    try {
      set({ palace: await window.mindPalace.invoke('rooms:dismiss', { area }), appError: null })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async renameRoom(roomId, name) {
    try {
      set({ palace: await window.mindPalace.invoke('rooms:rename', { roomId, name }), appError: null })
      return null
    } catch (error) {
      return describe(error)
    }
  },

  async findRooms() {
    try {
      const { tagged, view } = await window.mindPalace.invoke('rooms:find')
      set({ palace: view, appError: null })
      return tagged === 0 ? 'No areas found yet.' : `Sorted ${tagged} chat${tagged === 1 ? '' : 's'} into areas.`
    } catch (error) {
      return describe(error)
    }
  },

  async markRoomSeen(roomId) {
    try {
      await window.mindPalace.invoke('palace:seen', { roomId })
      set((s) => (s.seenRooms.includes(roomId) ? {} : { seenRooms: [...s.seenRooms, roomId] }))
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async showReminders() {
    set({ view: 'reminders', appError: null, commandOpen: false })
    await get().refreshReminders()
  },

  async refreshReminders() {
    try {
      set({ reminders: await window.mindPalace.invoke('reminder:list') })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  async respondToReminder(reminderId, response) {
    try {
      const target = await window.mindPalace.invoke('reminder:respond', { reminderId, response })
      set({ appError: null })
      if (response === 'open') {
        if (target.chatId) await get().selectChat(target.chatId)
        else await get().showProjects()
      }
    } catch (error) {
      set({ appError: describe(error) })
    }
    await Promise.all([get().refreshReminders(), get().refreshProjects(), get().refreshPalace()])
  },

  async setNotifications(enabled) {
    try {
      const result = await window.mindPalace.invoke('reminder:notifications', { enabled })
      set({ notificationsOn: result.enabled })
    } catch (error) {
      set({ appError: describe(error) })
    }
  },

  handleAppEvent(event) {
    switch (event.type) {
      case 'reminders_changed':
        void get().refreshReminders()
        if (get().view === 'projects') void get().refreshProjects()
        break
      case 'rooms_changed':
        void window.mindPalace.status().then((status) => set({ status }))
        void get().refreshChats()
        void get().refreshPalace()
        if (get().view === 'projects') void get().refreshProjects()
        break
      case 'progress_changed':
        if (get().progress[event.projectId]) void get().loadProgress(event.projectId)
        break
      case 'open_project':
        void get().refreshReminders()
        if (event.chatId) void get().refreshChats().then(() => get().selectChat(event.chatId!))
        else void get().showProjects()
        break
    }
  },

  handleEvent(event) {
    const { chatId } = event
    /** The room a chat's helper works in: its own, or the sorting room until it has one. */
    const roomOf = (): string => {
      const roomId = get().chats.find((c) => c.id === chatId)?.roomId ?? null
      return roomId !== null && (get().palace?.rooms.some((r) => r.id === roomId) ?? false) ? roomId : SORTING_ROOM
    }
    const log = (kind: ActivityKind, text: string, roomId: string | null = roomOf()): void =>
      set((s) => ({ activity: addActivity(s.activity, { at: new Date().toISOString(), kind, text, chatId, roomId }) }))
    const titleOf = (): string => get().chats.find((c) => c.id === chatId)?.title || 'New chat'
    switch (event.type) {
      case 'started':
        set((s) => ({
          // The first message of a new chat: this is the chat the user is waiting on.
          activeChatId: s.activeChatId === null && s.startingChat ? chatId : s.activeChatId,
          messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), event.userMessage] },
          streaming: { ...s.streaming, [chatId]: { text: '', searching: null } },
          errors: without(s.errors, chatId),
          finished: without(s.finished, roomOf())
        }))
        log('asked', `You asked: “${titleFromMessage(event.userMessage.content, 48)}”`)
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
        log('searching', `Searching the web: ${event.query}`)
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
        {
          const roomId = roomOf()
          log(event.stopped ? 'stopped' : 'answered', event.stopped ? `You stopped the answer in “${titleOf()}”` : `Claude answered in “${titleOf()}”`)
          if (!event.stopped) {
            set((s) => ({ finished: { ...s.finished, [roomId]: chatId } }))
            window.setTimeout(
              () => set((s) => (s.finished[roomId] === chatId ? { finished: without(s.finished, roomId) } : {})),
              DONE_MS
            )
          }
        }
        void get().refreshChats()
        void get().refreshPalace()
        break
      case 'error':
        set((s) => ({
          streaming: without(s.streaming, chatId),
          errors: { ...s.errors, [chatId]: event.message },
          auth: event.auth ?? s.auth
        }))
        log('error', `The answer in “${titleOf()}” failed`)
        break
      case 'updated': {
        const before = get().chats.find((c) => c.id === chatId)
        void get()
          .refreshChats()
          .then(() => {
            const after = get().chats.find((c) => c.id === chatId)
            const rooms = get().status?.rooms ?? []
            for (const change of chatChanges(before, after, (id) => rooms.find((r) => r.id === id)?.name)) {
              log(change.kind, change.text, after?.roomId ?? null)
              // A scroll travels from the sorting room to the chat's new room.
              const to = change.movedTo
              if (to && to !== SORTING_ROOM) set((s) => ({ transfers: [...s.transfers, { id: ++transferId, to }] }))
            }
            // The open chat was filed or moved: the palace behind it follows.
            const s = get()
            const roomId = s.chats.find((c) => c.id === chatId)?.roomId ?? null
            if (s.view === 'chat' && s.activeChatId === chatId && roomId && s.palace?.rooms.some((r) => r.id === roomId)) {
              set({ palaceRoomId: roomId })
            }
          })
        void get().refreshPalace()
        if (get().view === 'projects') void get().refreshProjects()
        break
      }
    }
  }
}))

progressCall = async (projectId, call) => {
  try {
    const progress = await call()
    useStore.setState((s) => ({ progress: { ...s.progress, [projectId]: progress }, progressErrors: without(s.progressErrors, projectId) }))
    return true
  } catch (error) {
    useStore.setState((s) => ({ progressErrors: { ...s.progressErrors, [projectId]: describe(error) } }))
    return false
  }
}
